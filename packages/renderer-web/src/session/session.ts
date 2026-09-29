import type {} from '../host-bridge';
import { sessionReport } from './report';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Browser, Page } from 'playwright';
import { projectSchema, isVisualTrack } from '@scenewirejs/schema';
import {
  frameContext,
  assertCanonicalFrameContext,
  type FrameContext,
  type RendererSession,
} from '@scenewirejs/renderer-core';
import { ResourceHost, ResourceStore } from '../resources';
import { createCaptureBackend } from '../capture';
import {
  RenderError,
  type RenderDiagnostic,
  type WebRenderOptions,
  type CompositionBuild,
} from '../contracts';
import { mime } from '../sandbox/mime';
import { prepareBrowser } from '../sandbox/browser';
import { prepareResources } from './prepare';
export class WebRendererSession implements RendererSession {
  readonly diagnostics: RenderDiagnostic[] = [];
  readonly builds: CompositionBuild[] = [];
  readonly metrics = {
    bundleMs: 0,
    prepareMs: 0,
    capturesMs: [] as number[],
    seekMs: [] as number[],
    mediaDecodeMs: [] as number[],
    paintFlushMs: [] as number[],
    captureMs: [] as number[],
    browserLaunchMs: 0,
    totalMs: 0,
  };
  private readonly durationFrames: number;
  private readonly foreignClips;
  private readonly compositionAssetByClipId: Map<string, string>;
  private captureBackend;
  private browserVersion = '';
  private engines = new Map<string, string>();
  private engineFrames = new Map<string, number[]>();
  private browser?: Browser;
  private page?: Page;
  private resources = new ResourceStore();
  private resourceHost = new ResourceHost(
    this.resources,
    (path) => mime[extname(path)] ?? 'text/html',
  );
  get resourceOrigin() {
    return this.resourceHost.origin;
  }
  private currentFrame: number | null = null;
  private phase = 'prepare';
  private disposed = false;
  private prepared = false;
  private started = performance.now();
  private readonly abort = () => {
    void this.dispose();
  };
  constructor(readonly options: WebRenderOptions) {
    this.captureBackend = createCaptureBackend(
      options.captureBackend ?? 'playwright-element',
      {
        timeoutMs: options.captureTimeoutMs,
        optimizeForSpeed: options.optimizeForSpeed,
        captureBeyondViewport: options.captureBeyondViewport,
      },
    );
    this.options = {
      ...options,
      project: projectSchema.parse(options.project),
    };
    const project = this.options.project;
    this.durationFrames = Math.max(
      ...project.scenes.map((s) => s.startFrame + s.durationFrames),
    );
    const foreignClips = project.tracks
      .filter(isVisualTrack)
      .flatMap((t) => t.clips)
      .filter((c) => c.component === 'ForeignComposition');
    this.compositionAssetByClipId = new Map(
      foreignClips.map((c) => [c.id, c.props.assetId]),
    );
    const enabled = new Set(
      project.tracks
        .filter(isVisualTrack)
        .filter((t) => !t.muted)
        .flatMap((t) => t.clips.map((c) => c.id)),
    );
    this.foreignClips = foreignClips.filter((c) => enabled.has(c.id));
    options.signal?.addEventListener('abort', this.abort, { once: true });
  }
  private diagnostic(error: unknown, composition = this.activeComposition()) {
    return new RenderError({
      renderer: 'web',
      engine:
        this.engines.get(composition) ??
        (this.currentFrame === null ? 'project' : 'structured'),
      composition,
      frame: this.currentFrame,
      phase: this.phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  /** Error-only context; successful frame production does not execute this path. */
  failureDiagnostic(error: unknown, phase: string): RenderDiagnostic {
    if (error instanceof RenderError) return error.diagnostic;
    return { ...this.diagnostic(error).diagnostic, phase };
  }
  private async bounded<T>(
    phase: string,
    timeout: number,
    action: () => Promise<T>,
  ): Promise<T> {
    this.phase = phase;
    if (this.disposed || this.options.signal?.aborted)
      throw this.diagnostic('Render cancelled or disposed');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              this.diagnostics.length
                ? new RenderError(this.diagnostics[0]!)
                : this.diagnostic(`${phase} timeout after ${timeout}ms`),
            );
            void this.dispose();
          }, timeout);
        }),
      ]);
    } catch (error) {
      if (error instanceof RenderError) throw error;
      throw this.diagnostic(error);
    } finally {
      clearTimeout(timer);
    }
  }
  async prepare() {
    if (this.prepared) return;
    const start = performance.now();
    await this.bounded(
      'prepare',
      this.options.prepareTimeoutMs ?? 30000,
      async () => {
        const prepared = await prepareResources(
          this.options,
          this.resourceHost,
          this.resources,
          this.engines,
          this.builds,
          (error, composition) => this.diagnostic(error, composition),
        );
        this.metrics.bundleMs = prepared.bundleMs;
        const browser = await prepareBrowser(
          this.options,
          prepared.gpuRequired,
          this.resources,
          this.resourceHost,
          this.diagnostics,
          (error, composition) => this.diagnostic(error, composition),
          (url) => this.compositionFor(url),
          () => this.disposed,
          (browser) => {
            this.browser = browser;
          },
          (page) => {
            this.page = page;
          },
        );
        this.metrics.browserLaunchMs = browser.browserLaunchMs;
        this.browserVersion = browser.browserVersion;
        await this.captureBackend.prepare(browser.page);
        this.prepared = true;
      },
    );
    this.metrics.prepareMs = performance.now() - start;
  }
  private activeComposition() {
    const clips = this.foreignClips.filter(
      (c) =>
        this.currentFrame === null ||
        (this.currentFrame >= c.startFrame &&
          this.currentFrame < c.startFrame + c.durationFrames),
    );
    return clips.length === 1 ? clips[0]!.props.assetId : 'project';
  }
  async previewResources() {
    // Explicit portable preview embeds bytes; deterministic export never calls this.
    return new Map(
      await Promise.all(
        [...this.resources].map(
          async ([path, resource]) =>
            [
              path,
              resource.kind === 'memory'
                ? resource.bytes
                : await readFile(resource.path),
            ] as const,
        ),
      ),
    );
  }
  private compositionFor(url: string) {
    const id = decodeURIComponent(
      url.match(/\/composition\/([^/]+)/)?.[1] ?? this.activeComposition(),
    );
    return this.compositionAssetByClipId.get(id) ?? id;
  }
  async renderFrame(context: FrameContext) {
    if (!this.prepared) throw this.diagnostic('Prepare session first');
    this.currentFrame = context.frame;
    try {
      assertCanonicalFrameContext(context, this.contextAt(context.frame));
    } catch (error) {
      throw this.diagnostic(error);
    }
    const start = performance.now();
    const host = await this.bounded(
      'seek',
      this.options.seekTimeoutMs ?? 5000,
      async () => {
        const timing = await this.page!.evaluate(async (context) => {
          return await window.sceneWireSeek(context);
        }, context);
        if (this.diagnostics.length)
          throw new RenderError(this.diagnostics[0]!);
        return timing;
      },
    );
    const seekElapsed = performance.now() - start;
    const captureStart = performance.now();
    const source = await this.bounded(
      'capture',
      this.options.captureTimeoutMs ?? 5000,
      () =>
        this.captureBackend.capture(this.page!, context.width, context.height),
    );
    this.metrics.seekMs.push(
      Math.max(0, seekElapsed - host.mediaDecodeMs - host.paintFlushMs),
    );
    this.metrics.mediaDecodeMs.push(host.mediaDecodeMs);
    this.metrics.paintFlushMs.push(host.paintFlushMs);
    this.metrics.captureMs.push(performance.now() - captureStart);
    const elapsed = performance.now() - start;
    this.metrics.capturesMs.push(elapsed);
    const engine = this.engines.get(this.activeComposition()) ?? 'structured';
    const engineSamples = this.engineFrames.get(engine) ?? [];
    engineSamples.push(elapsed);
    this.engineFrames.set(engine, engineSamples);
    return {
      frame: context.frame,
      width: context.width,
      height: context.height,
      source,
    };
  }
  async beginMediaRange(
    range: { startFrame: number; endFrame: number } | null,
  ) {
    await this.bounded('media-plan', this.options.seekTimeoutMs ?? 5000, () =>
      this.page!.evaluate(async (range) => {
        await window.sceneWireBeginMediaRange(range);
      }, range),
    );
  }
  contextAt(frame: number) {
    const { project } = this.options;
    return frameContext({
      frame,
      fps: project.fps,
      durationFrames: this.durationFrames,
      width: project.canvas.width,
      height: project.canvas.height,
      seed: project.seed ?? 0,
    });
  }
  resetFrameMetrics() {
    for (const key of [
      'capturesMs',
      'seekMs',
      'mediaDecodeMs',
      'paintFlushMs',
      'captureMs',
    ] as const)
      this.metrics[key].length = 0;
    this.engineFrames.clear();
  }
  private disposePromise?: Promise<void>;
  dispose(): Promise<void> {
    return (this.disposePromise ??= this.cleanup());
  }
  private decodeTimes: number[] = [];
  private mediaSequence = {
    sequentialSamples: 0,
    randomSamples: 0,
    maxRequestedBatchFrames: 0,
  };
  private async cleanup() {
    if (this.disposed) return;
    this.disposed = true;
    this.options.signal?.removeEventListener('abort', this.abort);
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.page?.evaluate(async () => {
          await window.sceneWireDispose?.();
        }),
        new Promise<void>((resolve) => {
          cleanupTimer = setTimeout(resolve, 200);
        }),
      ]);
    } catch {
      /* Process cleanup still owns the failure boundary. */
    } finally {
      clearTimeout(cleanupTimer);
    }
    // Telemetry must never delay resource ownership cleanup on an unresponsive
    // renderer (for example a synchronous infinite mount loop).
    let metricsTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const snapshot = await Promise.race([
        this.page?.evaluate(() => ({
          decodeTimes: window.sceneWireMediaMetrics?.() ?? [],
          mediaSequence: window.sceneWireMediaSequenceMetrics?.(),
        })),
        new Promise<undefined>((resolve) => {
          metricsTimer = setTimeout(() => resolve(undefined), 200);
        }),
      ]);
      if (snapshot) {
        this.decodeTimes = snapshot.decodeTimes;
        this.mediaSequence = snapshot.mediaSequence ?? this.mediaSequence;
      }
    } catch {
      /* Missing telemetry cannot prevent browser and resource host shutdown. */
    } finally {
      clearTimeout(metricsTimer);
    }
    await this.captureBackend.dispose?.();
    await this.browser?.close().catch(() => {});
    await this.resourceHost.dispose();
    this.resources.clear();
    this.metrics.totalMs = performance.now() - this.started;
  }
  performanceReport() {
    return sessionReport(
      this.metrics,
      this.captureBackend,
      this.options,
      this.browserVersion,
      this.builds,
      this.engineFrames,
      this.mediaSequence,
      this.decodeTimes,
      this.resourceHost,
    );
  }
}
