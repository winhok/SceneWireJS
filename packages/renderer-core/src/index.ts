export interface FrameContext {
  readonly frame: number;
  readonly fps: number;
  readonly timeSeconds: number;
  readonly timeMs: number;
  readonly projectProgress: number;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
}
export function frameContext(state: {
  frame: number;
  fps: number;
  durationFrames: number;
  width: number;
  height: number;
  seed: number;
}): FrameContext {
  const { frame, fps, durationFrames, width, height, seed } = state;
  if (
    ![frame, fps, durationFrames, width, height, seed].every(Number.isFinite) ||
    !Number.isInteger(frame) ||
    frame < 0 ||
    frame >= durationFrames ||
    !Number.isInteger(durationFrames) ||
    fps <= 0 ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(seed)
  )
    throw new Error('Invalid canonical frame state');
  return Object.freeze({
    frame,
    fps,
    timeSeconds: frame / fps,
    timeMs: (frame * 1000) / fps,
    projectProgress: durationFrames === 1 ? 0 : frame / (durationFrames - 1),
    width,
    height,
    seed,
  });
}
export interface RendererCapabilities {
  videoMedia?: boolean;
  dimensions: readonly ('2d' | '2.5d' | '3d')[];
  vector: boolean;
  dom: boolean;
  gpu: boolean;
  textLayout: 'basic' | 'advanced';
  shaders: boolean;
  particles: boolean;
  filters: boolean;
  masks: boolean;
  arbitraryCode: boolean;
  deterministicSeek: boolean;
  transparentOutput: boolean;
  browserRequired: boolean;
}
export interface FrameAdapter {
  prepare?(): void | Promise<void>;
  seek(context: FrameContext): void | Promise<void>;
  flush?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
export interface RenderedFrame {
  frame: number;
  width: number;
  height: number;
  source: unknown;
}
export interface RendererSession {
  prepare(): Promise<void>;
  renderFrame(context: FrameContext): Promise<RenderedFrame>;
  dispose(): Promise<void>;
}
export interface RendererEnvironment {
  width: number;
  height: number;
  signal?: AbortSignal;
}
export interface RendererDefinition<
  E extends RendererEnvironment = RendererEnvironment,
> {
  id: string;
  capabilities: RendererCapabilities;
  createSession(environment: E): Promise<RendererSession>;
}
export class RendererRegistry<
  E extends RendererEnvironment = RendererEnvironment,
> {
  private definitions = new Map<string, RendererDefinition<E>>();
  register(definition: RendererDefinition<E>): void {
    if (!definition.id || this.definitions.has(definition.id))
      throw new Error(`Duplicate or empty renderer: ${definition.id}`);
    if (!definition.capabilities.deterministicSeek)
      throw new Error('Renderer must support deterministic seek');
    this.definitions.set(definition.id, definition);
  }
  get(id: string): RendererDefinition<E> {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown renderer: ${id}`);
    return definition;
  }
  list(): readonly RendererDefinition<E>[] {
    return [...this.definitions.values()];
  }
}

/** Half-open range: startFrame inclusive, endFrame exclusive. */
export interface RenderRange {
  startFrame: number;
  endFrame: number;
}
export interface RenderProgress {
  framesCompleted: number;
  framesTotal: number;
  phase: 'prepare' | 'render' | 'encode' | 'concat' | 'audio' | 'finalize';
  activeWorkers?: number;
  chunksCompleted?: number;
  chunksTotal?: number;
}
export function validateRenderRange(
  range: RenderRange,
  durationFrames: number,
): RenderRange {
  if (
    !Number.isSafeInteger(range.startFrame) ||
    !Number.isSafeInteger(range.endFrame) ||
    range.startFrame < 0 ||
    range.endFrame > durationFrames ||
    range.startFrame >= range.endFrame
  )
    throw new Error('Invalid render range');
  return { ...range };
}

/** Runtime execution configuration; never persisted in VideoProject. */
export interface RenderChunk extends RenderRange {
  id: string;
}
export interface RenderPlan {
  version: 1;
  range: RenderRange;
  workers: number;
  chunks: RenderChunk[];
}
export function createRenderPlan(
  range: RenderRange,
  workers: number,
  chunkFrames?: number,
): RenderPlan {
  validateRenderRange(range, range.endFrame);
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 16)
    throw Error('Invalid render workers (1–16)');
  if (
    chunkFrames !== undefined &&
    (!Number.isSafeInteger(chunkFrames) || chunkFrames < 1)
  )
    throw Error('Invalid chunk frames');
  // Keep encoder/GOP boundaries identical when only worker assignment changes.
  const size = chunkFrames ?? 120;
  const chunks: RenderChunk[] = [];
  for (
    let startFrame = range.startFrame;
    startFrame < range.endFrame;
    startFrame += size
  ) {
    chunks.push({
      id: `chunk-${String(chunks.length + 1).padStart(4, '0')}`,
      startFrame,
      endFrame: Math.min(range.endFrame, startFrame + size),
    });
  }
  return {
    version: 1,
    range: { ...range },
    workers: Math.min(workers, chunks.length),
    chunks,
  };
}

export interface ChunkPerformance extends RenderChunk {
  worker: number;
  seekMs: number;
  mediaDecodeMs: number;
  paintFlushMs: number;
  captureMs: number;
  chunkEncodeMs: number;
  encoderBackpressureMs: number;
}
export interface WorkerPerformance {
  worker: number;
  chunks: string[];
  performance: {
    prepareMs: number;
    totalMs: number;
    captureMs: number;
    seekMs: number;
    mediaDecodeMs: number;
    paintFlushMs: number;
  };
}
export interface RenderPerformanceReport {
  version: 2;
  profile: string;
  workers: number;
  captureBackend: string;
  frames: number;
  prepareMs: number;
  bundleMs: number;
  seekMs: number;
  mediaDecodeMs: number;
  paintFlushMs: number;
  captureMs: number;
  encoderBackpressureMs: number;
  chunkEncodeMs: number;
  encodeMs: number;
  concatMs: number;
  audioMuxMs: number;
  totalMs: number;
  chunks: ChunkPerformance[];
  workersReport: WorkerPerformance[];
}

/** Compare canonical semantics, independent of property insertion order. */
export function assertCanonicalFrameContext(
  actual: FrameContext,
  expected: FrameContext,
): void {
  for (const field of [
    'frame',
    'fps',
    'timeSeconds',
    'timeMs',
    'projectProgress',
    'width',
    'height',
    'seed',
  ] as const) {
    if (actual[field] !== expected[field])
      throw Error(`Frame context must match canonical project state: ${field}`);
  }
}
