import { performance } from 'node:perf_hooks';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RenderChunk } from '@scenewirejs/renderer-core';
import type { WebRendererSession } from '../session/session';
import { runEncoder } from './encoder';
export async function renderSilentRange(
  session: WebRendererSession,
  chunk: RenderChunk,
  output: string,
  signal: AbortSignal,
  onFrame: (frame: number, source: Buffer) => Promise<void>,
) {
  const project = session.options.project;
  const start = performance.now();
  let encoderBackpressureMs = 0;
  let inputEnd = start;
  await runEncoder(
    [
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      '-framerate',
      String(project.fps),
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      project.canvas.width % 2 || project.canvas.height % 2
        ? 'yuv444p'
        : 'yuv420p',
      '-frames:v',
      String(chunk.endFrame - chunk.startFrame),
      '-y',
      output,
    ],
    signal,
    async (child) => {
      for (let frame = chunk.startFrame; frame < chunk.endFrame; frame++) {
        if (signal.aborted) throw Error('Render cancelled');
        const rendered = await session.renderFrame(session.contextAt(frame));
        if (child.stdin!.destroyed) throw Error('Chunk encoder input closed');
        if (!child.stdin!.write(rendered.source)) {
          const waitStart = performance.now();
          await once(child.stdin!, 'drain', { signal });
          encoderBackpressureMs += performance.now() - waitStart;
        }
        await onFrame(frame, rendered.source);
      }
      inputEnd = performance.now();
    },
  );
  return {
    chunkEncodeMs: performance.now() - start,
    encoderTailMs: performance.now() - inputEnd,
    encoderBackpressureMs,
  };
}
export async function concatSilentChunks(
  files: string[],
  directory: string,
  signal: AbortSignal,
) {
  if (files.length === 1) return { video: files[0]!, concatMs: 0 };
  const start = performance.now();
  const list = join(directory, 'chunks.txt');
  // Generated basenames only; no project/user path enters concat syntax.
  await writeFile(
    list,
    files.map((_, i) => `file 'chunk-${i}.mp4'`).join('\n') + '\n',
  );
  const video = join(directory, 'joined.mp4');
  await runEncoder(
    [
      '-f',
      'concat',
      '-safe',
      '1',
      '-i',
      list,
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      '-an',
      '-y',
      video,
    ],
    signal,
  );
  return { video, concatMs: performance.now() - start };
}
