import { isAudioTrack, type VideoProject } from '@scenewirejs/schema';
import type { RenderRange } from '@scenewirejs/renderer-core';
import { localPath } from '../sandbox/paths';
import { runEncoder } from './encoder';
export async function mixAndMuxProjectAudio(
  project: VideoProject,
  projectRoot: string,
  range: RenderRange,
  video: string,
  final: string,
  signal: AbortSignal,
) {
  const duration = (range.endFrame - range.startFrame) / project.fps;
  const clips = project.tracks
    .filter(isAudioTrack)
    .filter((track) => !track.muted)
    .flatMap((track) => track.clips)
    .filter(
      (clip) =>
        clip.startFrame < range.endFrame &&
        clip.startFrame + clip.durationFrames > range.startFrame,
    );
  const args = ['-i', video],
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
      `[${index + 1}:a]atrim=start=${clip.sourceOffsetMs / 1000}:duration=${d},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,aeval='${expression}':channel_layout=stereo,adelay=${(clip.startFrame * 1000) / project.fps}:all=1[a${index}]`,
    );
  }
  if (clips.length) {
    filters.push(
      `${clips.map((_, index) => `[a${index}]`).join('')}amix=inputs=${clips.length}:normalize=0,apad,atrim=start=${range.startFrame / project.fps}:end=${range.endFrame / project.fps},asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo[audio]`,
    );
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
    await runEncoder(args, signal);
  }
  return clips.length ? final : video;
}
