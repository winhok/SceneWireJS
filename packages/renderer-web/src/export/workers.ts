import type { RenderPlan } from '@scenewirejs/renderer-core';
import { WebRendererSession } from '../session/session';
import { RenderError } from '../contracts';
import { renderSilentRange } from './chunk';
import type { ChunkTelemetry } from './telemetry';
export async function renderChunks({
  sessions,
  plan,
  files,
  signal,
  mediaDecodeMode,
  onActive,
  onProgress,
  onChunk,
  onFrame,
  onFailure,
}: {
  sessions: WebRendererSession[];
  plan: RenderPlan;
  files: string[];
  signal: AbortSignal;
  mediaDecodeMode: 'random-seek' | 'sequential-export';
  onActive: (delta: number) => void;
  onProgress: () => void;
  onChunk: (chunk: ChunkTelemetry) => void;
  onFrame: (
    frame: number,
    source: Buffer,
    worker: number,
    chunk: string,
  ) => Promise<void>;
  onFailure: (error: unknown) => void;
}) {
  let next = 0;
  const rendering = await Promise.allSettled(
    sessions.map(async (session, index) => {
      const worker = index + 1;
      while (!signal.aborted && next < plan.chunks.length) {
        const chunkIndex = next++,
          chunk = plan.chunks[chunkIndex]!;
        const offset = session.metrics.capturesMs.length;
        onActive(1);
        try {
          onProgress();
          if (mediaDecodeMode === 'sequential-export')
            await session.beginMediaRange(chunk);
          const timing = await renderSilentRange(
            session,
            chunk,
            files[chunkIndex]!,
            signal,
            async (frame, source) => {
              await onFrame(frame, source, worker, chunk.id);
            },
          );
          onChunk({
            ...chunk,
            worker,
            ...timing,
            frameMs: session.metrics.capturesMs.slice(offset),
            ...(Object.fromEntries(
              (
                [
                  'seekMs',
                  'mediaDecodeMs',
                  'paintFlushMs',
                  'captureMs',
                ] as const
              ).map((key) => [
                key,
                session.metrics[key].slice(offset).reduce((a, b) => a + b, 0),
              ]),
            ) as {
              seekMs: number;
              mediaDecodeMs: number;
              paintFlushMs: number;
              captureMs: number;
            }),
          });
          if (mediaDecodeMode === 'sequential-export')
            await session.beginMediaRange(null);
        } catch (error) {
          const diagnostic = session.failureDiagnostic(error, 'encode');
          const belongsToChunk =
            diagnostic.frame !== null &&
            diagnostic.frame >= chunk.startFrame &&
            diagnostic.frame < chunk.endFrame;
          onFailure(
            new RenderError({
              ...diagnostic,
              frame: belongsToChunk ? diagnostic.frame : null,
              engine: belongsToChunk ? diagnostic.engine : 'project',
              worker,
              chunk: chunk.id,
            }),
          );
        } finally {
          onActive(-1);
          onProgress();
        }
      }
    }),
  );
  for (const result of rendering)
    if (result.status === 'rejected') onFailure(result.reason);
}
