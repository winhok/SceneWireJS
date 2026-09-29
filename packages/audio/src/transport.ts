import {
  isAudioTrack,
  projectSchema,
  type AudioClip,
  type VideoProject,
} from '@scenewirejs/schema';
import { assetBytes, type AssetResolver } from './assets';
export interface PlaybackTransport {
  play(projectTimeMs: number): Promise<void>;
  pause(): void;
  seek(projectTimeMs: number): void;
  currentTimeMs(): number;
  readonly playing: boolean;
}
export class WallClockTransport implements PlaybackTransport {
  private time = 0;
  private origin = 0;
  playing = false;
  constructor(private readonly now = () => performance.now()) {}
  async play(time: number): Promise<void> {
    this.seek(time);
    this.origin = this.now();
    this.playing = true;
  }
  pause(): void {
    this.time = this.currentTimeMs();
    this.playing = false;
  }
  seek(time: number): void {
    if (!Number.isFinite(time) || time < 0)
      throw new Error('Invalid project time');
    this.time = time;
    this.origin = this.now();
  }
  currentTimeMs(): number {
    return this.time + (this.playing ? this.now() - this.origin : 0);
  }
}
export function audioGainAt(
  clip: AudioClip,
  localSeconds: number,
  fps: number,
): number {
  const duration = clip.durationFrames / fps;
  if (localSeconds < 0 || localSeconds >= duration) return 0;
  const fadeIn = clip.fadeInFrames / fps,
    fadeOut = clip.fadeOutFrames / fps;
  return (
    clip.gain *
    Math.min(
      1,
      fadeIn ? localSeconds / fadeIn : 1,
      fadeOut ? (duration - localSeconds) / fadeOut : 1,
    )
  );
}
// Shared schedule for real-time preview and offline export. Sources are always new.
export function scheduleAudio(
  context: BaseAudioContext,
  project: VideoProject,
  buffers: ReadonlyMap<string, AudioBuffer>,
  projectSeconds: number,
  contextSeconds: number,
  muted: ReadonlySet<string> = new Set(),
): AudioBufferSourceNode[] {
  const sources: AudioBufferSourceNode[] = [];
  try {
    for (const track of project.tracks.filter(isAudioTrack)) {
      if (track.muted || muted.has(track.id)) continue;
      for (const clip of track.clips) {
        const start = clip.startFrame / project.fps,
          end = start + clip.durationFrames / project.fps;
        if (end <= projectSeconds) continue;
        const buffer = buffers.get(clip.assetId);
        if (!buffer) throw new Error(`Audio not decoded: ${clip.assetId}`);
        const elapsed = Math.max(0, projectSeconds - start),
          remaining = end - Math.max(start, projectSeconds);
        if (
          clip.sourceOffsetMs / 1000 + clip.durationFrames / project.fps >
          buffer.duration + 1 / buffer.sampleRate
        )
          throw new Error(`Decoded audio is shorter than clip ${clip.id}`);
        const source = context.createBufferSource(),
          gain = context.createGain();
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(context.destination);
        const when = contextSeconds + Math.max(0, start - projectSeconds);
        gain.gain.setValueAtTime(audioGainAt(clip, elapsed, project.fps), when);
        // Piecewise-linear envelope including crossing fades; do not introduce a second automation model.
        const knots = [
          elapsed,
          clip.fadeInFrames / project.fps,
          clip.durationFrames / project.fps - clip.fadeOutFrames / project.fps,
          clip.durationFrames / project.fps,
        ];
        const fi = clip.fadeInFrames / project.fps,
          fo = clip.fadeOutFrames / project.fps,
          d = clip.durationFrames / project.fps;
        if (fi + fo > d && fi && fo) knots.push((d * fi) / (fi + fo));
        for (const t of [...new Set(knots)]
          .filter((t) => t > elapsed && t <= d)
          .sort((a, b) => a - b))
          gain.gain.linearRampToValueAtTime(
            t === d && !fo ? clip.gain : audioGainAt(clip, t, project.fps),
            when + t - elapsed,
          );
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
        };
        source.start(when, clip.sourceOffsetMs / 1000 + elapsed, remaining);
        sources.push(source);
      }
    }
    return sources;
  } catch (error) {
    for (const source of sources) {
      source.stop();
      source.disconnect();
    }
    throw error;
  }
}
export async function decodeProjectAudio(
  context: BaseAudioContext,
  project: VideoProject,
  resolver: AssetResolver,
): Promise<ReadonlyMap<string, AudioBuffer>> {
  const ids = new Set(
    project.tracks
      .filter(isAudioTrack)
      .flatMap((t) => t.clips.map((c) => c.assetId)),
  );
  const entries = await Promise.all(
    [...ids].map(
      async (id) =>
        [
          id,
          await context.decodeAudioData(await assetBytes(resolver, id)),
        ] as const,
    ),
  );
  return new Map(entries);
}
export class AudioTransport implements PlaybackTransport {
  private project: VideoProject;
  private buffers: ReadonlyMap<string, AudioBuffer> = new Map();
  private sources: AudioBufferSourceNode[] = [];
  private time = 0;
  private origin = 0;
  private generation = 0;
  private muted = new Set<string>();
  playing = false;
  constructor(
    project: VideoProject,
    private readonly resolver: AssetResolver,
    readonly context: AudioContext = new AudioContext(),
  ) {
    this.project = projectSchema.parse(project);
  }
  async load(): Promise<void> {
    this.buffers = await decodeProjectAudio(
      this.context,
      this.project,
      this.resolver,
    );
  }
  async play(time: number): Promise<void> {
    this.pause();
    this.seek(time);
    const generation = ++this.generation;
    await this.context.resume();
    if (!this.buffers.size) await this.load();
    if (generation !== this.generation) return;
    this.origin = this.context.currentTime;
    this.sources = scheduleAudio(
      this.context,
      this.project,
      this.buffers,
      this.time / 1000,
      this.origin,
      this.muted,
    );
    this.playing = true;
  }
  pause(): void {
    this.time = this.currentTimeMs();
    this.playing = false;
    ++this.generation;
    this.stop();
  }
  private stop(): void {
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    this.sources = [];
  }
  seek(time: number): void {
    const duration =
      (Math.max(
        ...this.project.scenes.map((s) => s.startFrame + s.durationFrames),
      ) *
        1000) /
      this.project.fps;
    if (!Number.isFinite(time) || time < 0 || time > duration)
      throw new Error('Invalid project time');
    this.stop();
    this.time = time;
    this.origin = this.context.currentTime;
    if (this.playing)
      this.sources = scheduleAudio(
        this.context,
        this.project,
        this.buffers,
        time / 1000,
        this.origin,
        this.muted,
      );
  }
  currentTimeMs(): number {
    return (
      this.time +
      (this.playing ? (this.context.currentTime - this.origin) * 1000 : 0)
    );
  }
  setTrackMuted(id: string, muted: boolean): void {
    if (!this.project.tracks.some((t) => t.id === id && isAudioTrack(t)))
      throw new Error('Unknown audio track');
    if (muted) this.muted.add(id);
    else this.muted.delete(id);
    this.seek(this.currentTimeMs());
  }
  async dispose(): Promise<void> {
    this.pause();
    await this.context.close();
  }
}
export async function mixProjectAudio(
  project: VideoProject,
  resolver: AssetResolver,
  sampleRate = 48000,
): Promise<AudioBuffer> {
  const seconds =
    Math.max(...project.scenes.map((s) => s.startFrame + s.durationFrames)) /
    project.fps;
  const context = new OfflineAudioContext(
    2,
    Math.round(seconds * sampleRate),
    sampleRate,
  );
  const buffers = await decodeProjectAudio(context, project, resolver);
  scheduleAudio(context, project, buffers, 0, 0);
  return context.startRendering();
}
