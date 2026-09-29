import type { FrameContext, RenderRange } from '@scenewirejs/renderer-core';
export interface MediaSequenceMetrics {
  sequentialSamples: number;
  randomSamples: number;
  maxRequestedBatchFrames: number;
}
export interface SceneWireHostBridge {
  sceneWireReady(): boolean;
  sceneWireSeek(
    context: FrameContext,
  ): Promise<{ mediaDecodeMs: number; paintFlushMs: number }>;
  sceneWireBeginMediaRange(range: RenderRange | null): Promise<void>;
  sceneWireDispose(): Promise<void>;
  sceneWireMediaMetrics(): number[];
  sceneWireMediaSequenceMetrics(): MediaSequenceMetrics;
}
/** Browser RPC boundary: host installs this surface before the readiness gate. */
declare global {
  // Declaration merging installs the single RPC contract on the browser boundary.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Window extends SceneWireHostBridge {}
}
