import type { CaptureBackendId } from '../capture';
import type { WebRenderOptions, CompositionBuild } from '../contracts';
import type { ResourceHost } from '../resources';
export interface SessionMetrics {
  bundleMs: number;
  prepareMs: number;
  capturesMs: number[];
  seekMs: number[];
  mediaDecodeMs: number[];
  paintFlushMs: number[];
  captureMs: number[];
  browserLaunchMs: number;
  totalMs: number;
}
export function sessionReport(
  metrics: SessionMetrics,
  captureBackend: { id: CaptureBackendId },
  options: WebRenderOptions,
  browserVersion: string,
  builds: CompositionBuild[],
  engineFrames: Map<string, number[]>,
  mediaSequence: {
    sequentialSamples: number;
    randomSamples: number;
    maxRequestedBatchFrames: number;
  },
  decodeTimes: number[],
  resourceHost: ResourceHost,
) {
  const samples = [...metrics.capturesMs].sort((a, b) => a - b);
  return {
    version: 2,
    frames: samples.length,
    workers: 1,
    captureBackend: captureBackend.id,
    captureOptions: {
      optimizeForSpeed: options.optimizeForSpeed ?? true,
      captureBeyondViewport: options.captureBeyondViewport ?? false,
    },
    browserVersion: browserVersion,
    browserLaunchMs: metrics.browserLaunchMs,
    seekMs: metrics.seekMs.reduce((a, b) => a + b, 0),
    mediaDecodeMs: metrics.mediaDecodeMs.reduce((a, b) => a + b, 0),
    paintFlushMs: metrics.paintFlushMs.reduce((a, b) => a + b, 0),
    captureMs: metrics.captureMs.reduce((a, b) => a + b, 0),
    builds: builds,
    profile: options.profile ?? 'deterministic-export',
    perEngine: [...engineFrames].map(([engine, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        engine,
        frames: values.length,
        meanFrameMs: values.reduce((a, b) => a + b, 0) / values.length,
        p95FrameMs: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!,
        totalFrameMs: values.reduce((a, b) => a + b, 0),
      };
    }),
    bundleMs: metrics.bundleMs,
    prepareMs: metrics.prepareMs,
    averageCaptureMs:
      samples.reduce((a, b) => a + b, 0) / (samples.length || 1),
    p50CaptureMs: samples[Math.floor((samples.length - 1) * 0.5)] ?? 0,
    p95CaptureMs:
      samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? 0,
    totalMs: metrics.totalMs,
    mediaDecode: {
      mode: options.mediaDecodeMode ?? 'random-seek',
      ...mediaSequence,
      samples: decodeTimes.length,
      meanMs:
        decodeTimes.reduce((a, b) => a + b, 0) / (decodeTimes.length || 1),
      p95Ms:
        [...decodeTimes].sort((a, b) => a - b)[
          Math.max(0, Math.ceil(decodeTimes.length * 0.95) - 1)
        ] ?? 0,
    },
    mediaIO: {
      resources: [...resourceHost.mediaMetrics].map(([resource, metrics]) => ({
        resource,
        ...metrics,
      })),
      cacheLimitBytesPerSource: 64 * 2 ** 20,
      nodeFileStreamBufferBytes: 64 * 1024,
    },
    peakMemoryBytes: null,
  };
}
