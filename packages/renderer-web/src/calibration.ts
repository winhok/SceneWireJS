import { availableParallelism, freemem, totalmem, platform } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RenderRange } from '@scenewirejs/renderer-core';
import type { WebRendererSession } from './index';
const exec = promisify(execFile);
export function statistics(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
  };
}
export function selectWorkers(input: {
  frames: number;
  parallelism: number;
  availableMemory: number;
  gpu: boolean;
  captureP95: number;
  decodeP95: number;
}) {
  const cpuCap = Math.max(1, Math.min(4, Math.floor(input.parallelism / 2)));
  // Reserve half a GiB and budget a GiB per browser+decoder+encoder. Estimate, not a measured browser peak.
  const memoryCap = Math.max(
    1,
    Math.floor((input.availableMemory - 512 * 2 ** 20) / 2 ** 30),
  );
  const workloadCap =
    input.frames < 240 || input.gpu
      ? 1
      : input.captureP95 > 300 || input.decodeP95 > 250
        ? 2
        : 4;
  const candidates = [1, 2, 4].filter(
    (n) => n <= cpuCap && n <= memoryCap && n <= workloadCap,
  );
  return {
    candidates: [...new Set([1, ...candidates])],
    selectedWorkers: Math.max(1, ...candidates),
    reason: input.gpu
      ? 'GPU engine present: avoid compositor/SwiftShader contention'
      : input.frames < 240
        ? 'Short range: avoid worker preparation overhead'
        : `CPU cap ${cpuCap}; memory cap ${memoryCap}; measured capture/decode cost cap ${workloadCap}`,
  };
}
async function memoryBudget() {
  const free = freemem();
  let available = free,
    method = 'os.freemem';
  if (platform() === 'darwin') {
    try {
      const { stdout } = await exec('vm_stat', [], {
        timeout: 1000,
        maxBuffer: 16000,
      });
      const pageSize = Number(stdout.match(/page size of (\d+) bytes/)?.[1]);
      const pages = (name: string) =>
        Number(stdout.match(new RegExp(`${name}:\\s+(\\d+)`))?.[1] ?? 0);
      if (pageSize > 0) {
        available = Math.min(
          totalmem(),
          (pages('Pages free') +
            pages('Pages inactive') +
            pages('Pages speculative')) *
            pageSize,
        );
        method =
          'macOS free + inactive + speculative pages (reclaimable estimate)';
      }
    } catch {
      /* Conservative free-only fallback when platform telemetry is unavailable. */
    }
  }
  return {
    freeMemoryBytes: free,
    availableMemoryEstimateBytes: available,
    totalMemoryBytes: totalmem(),
    method,
  };
}
export async function calibrateWorkers(
  session: WebRendererSession,
  range: RenderRange,
) {
  const count = range.endFrame - range.startFrame;
  const frames = [
    ...new Set(
      [0, 0.25, 0.5, 0.75, 1].map(
        (p) => range.startFrame + Math.floor((count - 1) * p),
      ),
    ),
  ];
  const samples = [];
  for (const frame of frames) {
    await session.renderFrame(session.contextAt(frame));
    samples.push({
      frame,
      captureMs: session.metrics.captureMs.at(-1)!,
      mediaDecodeMs: session.metrics.mediaDecodeMs.at(-1)!,
      frameMs: session.metrics.capturesMs.at(-1)!,
    });
  }
  const capture = statistics(samples.map((s) => s.captureMs)),
    decode = statistics(samples.map((s) => s.mediaDecodeMs));
  const gpu = session.builds.some((b) =>
    ['web-pixi', 'web-three'].includes(b.engine),
  );
  const memory = await memoryBudget(),
    parallelism = availableParallelism();
  const selection = selectWorkers({
    frames: count,
    parallelism,
    availableMemory: memory.availableMemoryEstimateBytes,
    gpu,
    captureP95: capture.p95,
    decodeP95: decode.p95,
  });
  session.resetFrameMetrics();
  return {
    sampledFrames: frames,
    samples,
    capture,
    mediaDecode: decode,
    gpuRequired: gpu,
    availableParallelism: parallelism,
    memory,
    ...selection,
  };
}
