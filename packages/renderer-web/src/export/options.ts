import type { WebRenderOptions } from '../contracts';
import type { RenderRange, RenderProgress } from '@scenewirejs/renderer-core';
export interface ExportOptions extends WebRenderOptions {
  output: string;
  range?: RenderRange;
  workers?: number | 'auto';
  chunkFrames?: number;
  onRenderProgress?(progress: RenderProgress): void;
  onProgress?(frame: number, total: number): void;
  /** Optional bounded consumer, awaited before the frame buffer is released. */
  onFrame?(
    frame: number,
    source: Buffer,
    worker: number,
    chunk: string,
  ): Promise<void> | void;
  renderTimeoutMs?: number;
}
