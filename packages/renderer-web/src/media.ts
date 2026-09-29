import {
  Input,
  ALL_FORMATS,
  UrlSource,
  VideoSampleSink,
  type VideoSample,
} from 'mediabunny';
import {
  isVisualTrack,
  videoSourceTimeMs,
  videoSourceOutMs,
  type VideoProject,
} from '@scenewirejs/schema';
import type { RenderGraph } from '@scenewirejs/runtime';
import { applyCameraTransform } from '@scenewirejs/renderer-canvas';

export interface MediaRequest {
  clipId: string;
  assetId: string;
  frame: number;
  sourceTimeMs: number;
}
import { TimingSamples } from './timing-samples';
const BATCH_FRAMES = 4;
/** Trusted host media adapter. Random seeks remain independent; export batches are bounded. */
export class MediaFrameResolver {
  private assets = new Map<
    string,
    { input: Input; sink: VideoSampleSink; first: number; durationMs: number }
  >();
  totalDecodeMs = 0;
  private readonly timingSamples = new TimingSamples();
  get decodeMs(): number[] {
    return this.timingSamples.values();
  }
  private sequences = new Map<
    string,
    {
      assetId: string;
      requests: MediaRequest[];
      cursor: number;
      iterator?: AsyncGenerator<VideoSample | null, void, unknown>;
    }
  >();
  sequentialSamples = 0;
  randomSamples = 0;
  maxRequestedBatchFrames = 0;
  async endRange() {
    const sequences = [...this.sequences.values()];
    this.sequences.clear();
    await Promise.all(sequences.map((s) => s.iterator?.return()));
  }
  async beginRange(requests: MediaRequest[]) {
    await this.endRange();
    for (const request of requests) {
      const key = request.clipId;
      const sequence = this.sequences.get(key) ?? {
        assetId: request.assetId,
        requests: [],
        cursor: 0,
      };
      if (sequence.assetId !== request.assetId)
        throw Error(`video.sequence.asset: ${key}`);
      sequence.requests.push(request);
      this.sequences.set(key, sequence);
    }
  }
  async prepare(project: VideoProject, urls: Record<string, string>) {
    const clips = project.tracks
      .filter(isVisualTrack)
      .filter((t) => !t.muted)
      .flatMap((t) => t.clips)
      .filter((c) => c.component === 'Video');
    try {
      for (const assetId of new Set(clips.map((c) => c.props.assetId))) {
        const input = new Input({
          formats: ALL_FORMATS,
          source: new UrlSource(urls[assetId]!),
        });
        try {
          if (!(await input.canRead()))
            throw Error('video.container.unreadable');
          const track = await input.getPrimaryVideoTrack();
          if (!track) throw Error('video.track.missing');
          if (!(await track.canDecode()))
            throw Error('video.track.undecodable');
          const first = await track.getFirstTimestamp();
          const durationMs = ((await track.computeDuration()) - first) * 1000;
          this.assets.set(assetId, {
            input,
            sink: new VideoSampleSink(track),
            first,
            durationMs,
          });
        } catch (error) {
          input.dispose();
          throw error;
        }
      }
      for (const clip of clips) {
        const asset = this.assets.get(clip.props.assetId)!;
        if (videoSourceOutMs(clip, project.fps) > asset.durationMs + 1e-6)
          throw Error(`video.source.range.actual: ${clip.id}`);
        for (const frame of [
          clip.startFrame,
          clip.startFrame + clip.durationFrames - 1,
        ]) {
          const sample = await this.resolve(
            clip.props.assetId,
            videoSourceTimeMs(clip, frame, project.fps),
          );
          sample.close();
        }
      }
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }
  private async resolve(
    assetId: string,
    sourceTimeMs: number,
    clipId?: string,
    frame?: number,
  ) {
    const asset = this.assets.get(assetId);
    if (!asset || sourceTimeMs < 0 || sourceTimeMs >= asset.durationMs)
      throw Error(`video.source.range: ${assetId}`);
    const start = performance.now();
    const sequence =
      clipId === undefined ? undefined : this.sequences.get(clipId);
    if (sequence && sequence.assetId !== assetId)
      throw Error(`video.sequence.asset: ${clipId}`);
    const planned = sequence?.requests[sequence.cursor];
    let sample: VideoSample | null;
    if (
      sequence &&
      planned &&
      planned.frame === frame &&
      planned.sourceTimeMs === sourceTimeMs
    ) {
      if (sequence.cursor % BATCH_FRAMES === 0) {
        await sequence.iterator?.return();
        const batch = sequence.requests.slice(
          sequence.cursor,
          sequence.cursor + BATCH_FRAMES,
        );
        this.maxRequestedBatchFrames = Math.max(
          this.maxRequestedBatchFrames,
          batch.length,
        );
        sequence.iterator = asset.sink.samplesAtTimestamps(
          batch.map((r) => asset.first + r.sourceTimeMs / 1000),
        );
      }
      const next = await sequence.iterator!.next();
      sample = next.done ? null : next.value;
      sequence.cursor++;
      this.sequentialSamples++;
    } else {
      // An arbitrary seek must never consume a mismatching planned sample.
      if (this.sequences.size) await this.endRange();
      sample = await asset.sink.getSample(asset.first + sourceTimeMs / 1000);
      this.randomSamples++;
    }
    const elapsed = performance.now() - start;
    this.timingSamples.push(elapsed);
    this.totalDecodeMs += elapsed;
    if (!sample)
      throw Error(`video.sample.missing: ${assetId} at ${sourceTimeMs}`);
    return sample;
  }
  async draw(graph: RenderGraph, surfaces: Map<string, HTMLCanvasElement>) {
    const active = new Set((graph.media ?? []).map((m) => m.id));
    for (const [id, surface] of surfaces) {
      surface.style.display = 'none';
      if (!active.has(id)) surface.width = surface.height = 1;
    }
    for (const element of graph.media ?? []) {
      const canvas = surfaces.get(element.id)!;
      canvas.style.display = 'block';
      if (canvas.width !== graph.canvas.width)
        canvas.width = graph.canvas.width;
      if (canvas.height !== graph.canvas.height)
        canvas.height = graph.canvas.height;
      canvas.parentElement!.appendChild(canvas); // evaluated order within each supported plane
      const sample = await this.resolve(
        element.assetId,
        element.sourceTimeMs,
        element.id,
        graph.frame,
      );
      const ctx = canvas.getContext('2d')!;
      let surface: OffscreenCanvas | undefined;
      try {
        ctx.resetTransform();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        applyCameraTransform(ctx, graph);
        const t = element.transform;
        ctx.translate(t.x + t.width / 2, t.y + t.height / 2);
        ctx.rotate((t.rotation * Math.PI) / 180);
        ctx.scale(t.scaleX, t.scaleY);
        ctx.translate(-t.width / 2, -t.height / 2);
        ctx.globalAlpha = t.opacity;
        ctx.filter = element.effects?.blurPx
          ? `blur(${element.effects.blurPx}px)`
          : 'none';
        // Mediabunny owns display rotation/flip, normalized crop conversion, and fit.
        surface = new OffscreenCanvas(
          Math.max(1, Math.round(t.width)),
          Math.max(1, Math.round(t.height)),
        );
        const crop = element.crop;
        const left = crop ? Math.floor(crop.x * sample.displayWidth) : 0;
        const top = crop ? Math.floor(crop.y * sample.displayHeight) : 0;
        sample.drawWithFit(surface.getContext('2d')!, {
          fit: element.fit,
          ...(crop
            ? {
                crop: {
                  left,
                  top,
                  width: Math.max(
                    1,
                    Math.min(
                      sample.displayWidth,
                      Math.ceil((crop.x + crop.width) * sample.displayWidth),
                    ) - left,
                  ),
                  height: Math.max(
                    1,
                    Math.min(
                      sample.displayHeight,
                      Math.ceil((crop.y + crop.height) * sample.displayHeight),
                    ) - top,
                  ),
                },
              }
            : {}),
        });
        ctx.drawImage(surface, 0, 0, t.width, t.height);
        surface.width = surface.height = 1;
      } finally {
        ctx.restore();
        sample.close();
        if (surface) surface.width = surface.height = 1;
      }
    }
  }
  async dispose() {
    try {
      await this.endRange();
    } finally {
      for (const asset of this.assets.values()) asset.input.dispose();
      this.assets.clear();
    }
  }
}
