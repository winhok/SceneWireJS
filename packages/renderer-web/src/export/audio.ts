import { isAudioTrack, type VideoProject } from '@scenewirejs/schema';
import type { RenderRange } from '@scenewirejs/renderer-core';
import { localPath } from '../sandbox/paths';
import { type EncoderObservation, runEncoder } from './encoder';
async function audioInputs(
  project: VideoProject,
  projectRoot: string,
  range: RenderRange,
  inputOffset: number,
) {
  const clips = project.tracks
    .filter(isAudioTrack)
    .filter((track) => !track.muted)
    .flatMap((track) => track.clips)
    .filter(
      (clip) =>
        clip.startFrame < range.endFrame &&
        clip.startFrame + clip.durationFrames > range.startFrame,
    );
  const args: string[] = [],
    filters: string[] = [];
  for (const [index, clip] of clips.entries()) {
    const asset = project.assets.find((asset) => asset.id === clip.assetId)!;
    args.push('-i', await localPath(projectRoot, asset.src));
    const d = clip.durationFrames / project.fps,
      fi = clip.fadeInFrames / project.fps,
      fo = clip.fadeOutFrames / project.fps;
    // Matches audioGainAt, including crossing fades, source offsets and canonical placement.
    const envelope = `${clip.gain}*min(1,min(${fi ? `t/${fi}` : '1'},${fo ? `(${d}-t)/${fo}` : '1'}))`;
    const expression = `val(0)*(${envelope})|val(1)*(${envelope})`;
    filters.push(
      `[${index + inputOffset}:a]atrim=start=${clip.sourceOffsetMs / 1000}:duration=${d},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,aeval='${expression}':channel_layout=stereo,adelay=${(clip.startFrame * 1000) / project.fps}:all=1[a${index}]`,
    );
  }
  if (clips.length) {
    filters.push(
      `${clips.map((_, index) => `[a${index}]`).join('')}amix=inputs=${clips.length}:normalize=0,apad,atrim=start=${range.startFrame / project.fps}:end=${range.endFrame / project.fps},asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo[audio]`,
    );
  }
  return { args, filters, hasClips: clips.length > 0 };
}

export async function mixAndMuxProjectAudio(
  project: VideoProject,
  projectRoot: string,
  range: RenderRange,
  video: string,
  final: string,
  signal: AbortSignal,
  observation?: Omit<EncoderObservation, 'phase' | 'durationMs'>,
) {
  const duration = (range.endFrame - range.startFrame) / project.fps;
  const {
    args: audioArgs,
    filters,
    hasClips,
  } = await audioInputs(project, projectRoot, range, 1);
  const args = ['-i', video, ...audioArgs];
  if (hasClips) {
    args.push(
      '-filter_complex',
      filters.join(';'),
      '-map',
      '0:v',
      '-map',
      '[audio]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-t',
      String(duration),
      '-movflags',
      '+faststart',
      '-y',
      final,
    );
    await runEncoder(args, signal, undefined, {
      ...observation,
      phase: 'audio-mux',
      durationMs: duration * 1000,
    });
  }
  return hasClips ? final : video;
}

/** Independent deterministic audio artifact for production builds, including silence. */
export async function mixProjectAudio(
  project: VideoProject,
  projectRoot: string,
  range: RenderRange,
  output: string,
  signal: AbortSignal,
  observation?: Omit<EncoderObservation, 'phase' | 'durationMs'>,
): Promise<string> {
  const duration = (range.endFrame - range.startFrame) / project.fps;
  if (!(duration > 0))
    throw Error('Audio mix requires a nonempty render range');
  const { args, filters, hasClips } = await audioInputs(
    project,
    projectRoot,
    range,
    0,
  );
  if (hasClips) {
    args.push('-filter_complex', filters.join(';'), '-map', '[audio]');
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:a');
  }
  args.push(
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-t',
    String(duration),
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-f',
    'wav',
    '-y',
    output,
  );
  await runEncoder(args, signal, undefined, {
    ...observation,
    phase: 'audio-mix',
    durationMs: duration * 1000,
  });
  return output;
}
