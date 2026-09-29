import { encodeMixedAudio } from './audio-encoding';
import {
  EncodedAudioPacketSource,
  BufferTarget,
  Mp4OutputFormat,
  WebMOutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSource,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import { evaluateAtFrame, type CompiledProject } from '@scenewirejs/runtime';
import { createCanvasRenderer } from '@scenewirejs/renderer-canvas';
import { isAudioTrack } from '@scenewirejs/schema';
import { mixProjectAudio, type AssetResolver } from '@scenewirejs/audio';
export interface ExportFormat {
  container: 'mp4' | 'webm';
  video: 'avc' | 'vp9';
  audio: 'aac' | 'opus';
  mime: string;
}
export const exportFormats: readonly ExportFormat[] = [
  { container: 'mp4', video: 'avc', audio: 'aac', mime: 'video/mp4' },
  { container: 'webm', video: 'vp9', audio: 'opus', mime: 'video/webm' },
];
export async function chooseExportFormat(
  probe: (format: ExportFormat) => Promise<boolean>,
): Promise<ExportFormat> {
  for (const format of exportFormats) if (await probe(format)) return format;
  throw new Error(
    'No supported native MP4 or WebM video/audio encoder combination',
  );
}
export function frameTimestamp(frame: number, fps: number): number {
  return Math.round((frame * 1_000_000) / fps);
}
export interface ExportReport {
  container: string;
  frameCount: number;
  fps: number;
  videoDurationMs: number;
  audioDurationMs: number | null;
  encoderDelayMs: number;
  timelineDriftMs: number;
  firstTimestampUs: number;
  lastTimestampUs: number;
}
export async function exportVideo({
  compiled,
  resolver,
  signal,
  onProgress,
}: {
  compiled: CompiledProject;
  resolver: AssetResolver;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}): Promise<{ blob: Blob; report: ExportReport }> {
  if (
    compiled.clips.some(
      (clip) =>
        clip.component === 'ForeignComposition' || clip.component === 'Video',
    )
  )
    throw new Error(
      'Web compositions require the headless browser provider: scenewire render <project.json> --output video.mp4',
    );
  if (typeof VideoFrame === 'undefined' || typeof VideoEncoder === 'undefined')
    throw new Error('WebCodecs video encoding is unavailable');
  const project = compiled.project,
    hasAudio = project.tracks
      .filter(isAudioTrack)
      .some((t) => !t.muted && t.clips.length);
  const sampleRate = 48000;
  const format = await chooseExportFormat(async (f) => {
    if (
      !(await canEncodeVideo(f.video, {
        width: project.canvas.width,
        height: project.canvas.height,
        frameRate: project.fps,
        quality: new Quality({ bitrate: 4_000_000 }),
      }))
    )
      return false;
    return (
      !hasAudio ||
      (typeof AudioEncoder !== 'undefined' &&
        typeof AudioDecoder !== 'undefined' &&
        (await canEncodeAudio(f.audio, {
          numberOfChannels: 2,
          sampleRate,
          quality: new Quality({ bitrate: 128_000 }),
        })))
    );
  });
  const surface = document.createElement('canvas');
  surface.width = project.canvas.width;
  surface.height = project.canvas.height;
  const renderer = createCanvasRenderer(surface),
    target = new BufferTarget();
  const output = new Output({
    format:
      format.container === 'mp4'
        ? new Mp4OutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat(),
    target,
  });
  const video = new VideoSampleSource({
    codec: format.video,
    quality: new Quality({ bitrate: 4_000_000 }),
  });
  output.addVideoTrack(video, { frameRate: project.fps });
  const audio = hasAudio
    ? new EncodedAudioPacketSource(format.audio)
    : undefined;
  if (audio) output.addAudioTrack(audio);
  let audioDurationMs: number | null = null;
  let encoderDelayMs = 0;
  try {
    signal?.throwIfAborted();
    const mixed = hasAudio
      ? await mixProjectAudio(project, resolver, sampleRate)
      : undefined;
    signal?.throwIfAborted();
    await output.start();
    // Supply the full zero-origin audio mix; WebCodecs/Mediabunny performs chunking/backpressure.
    if (audio && mixed) {
      const encoded = await encodeMixedAudio(mixed, format.audio, signal);
      for (const { packet, meta } of encoded.packets)
        await audio.add(packet, meta);
      audio.close();
      audioDurationMs = encoded.endSeconds * 1000;
      encoderDelayMs = encoded.delaySeconds * 1000;
    }
    for (let frame = 0; frame < compiled.durationFrames; frame++) {
      signal?.throwIfAborted();
      renderer.render(evaluateAtFrame(compiled, frame));
      const nativeFrame = new VideoFrame(surface, {
        timestamp: frameTimestamp(frame, project.fps),
        duration:
          frameTimestamp(frame + 1, project.fps) -
          frameTimestamp(frame, project.fps),
      });
      const sample = new VideoSample(nativeFrame);
      try {
        await video.add(sample, { keyFrame: frame % project.fps === 0 });
      } finally {
        sample.close();
        nativeFrame.close();
      }
      onProgress?.((frame + 1) / compiled.durationFrames);
    }
    video.close();
    await output.finalize();
    if (!target.buffer) throw new Error('Export produced no media');
    const videoDurationMs = (compiled.durationFrames * 1000) / project.fps;
    const report: ExportReport = {
      container: format.container,
      frameCount: compiled.durationFrames,
      fps: project.fps,
      videoDurationMs,
      audioDurationMs,
      encoderDelayMs,
      timelineDriftMs:
        audioDurationMs === null
          ? 0
          : Math.abs(audioDurationMs - videoDurationMs),
      firstTimestampUs: 0,
      lastTimestampUs: frameTimestamp(compiled.durationFrames - 1, project.fps),
    };
    if (report.timelineDriftMs > 1000 / project.fps)
      throw new Error('Mixed audio/video timeline drift exceeds one frame');
    return { blob: new Blob([target.buffer], { type: format.mime }), report };
  } catch (error) {
    await output.cancel();
    throw error;
  }
}
