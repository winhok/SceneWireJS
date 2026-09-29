import type { RenderChunk } from '@scenewirejs/renderer-core';
export type ChunkTelemetry = RenderChunk & {
  worker: number;
  chunkEncodeMs: number;
  encoderTailMs: number;
  encoderBackpressureMs: number;
  frameMs: number[];
  seekMs: number;
  mediaDecodeMs: number;
  paintFlushMs: number;
  captureMs: number;
};
