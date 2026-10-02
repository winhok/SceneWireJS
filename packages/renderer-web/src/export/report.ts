import { aggregateFrameDiagnostics } from '../frame-diagnostics';
import { performance } from 'node:perf_hooks';
import type { VideoProject } from '@scenewirejs/schema';
import type { RenderRange, RenderPlan } from '@scenewirejs/renderer-core';
import type { WebRendererSession } from '../session/session';
import type { calibrateWorkers } from '../calibration';
import type { CaptureBackendId } from '../capture';
import type { validateSilentPicture } from './validation';
import type { ExportOptions } from './options';
import type { ChunkTelemetry } from './telemetry';
export function exportReport({
  sessions,
  chunks,
  options,
  frameCount,
  range,
  project,
  plan,
  captureBackend,
  mediaDecodeMode,
  prepareMs,
  concatMs,
  audioMuxMs,
  started,
  calibration,
  pictureValidation,
  peakNodeRss,
  freeMemoryFloor,
}: {
  sessions: WebRendererSession[];
  chunks: ChunkTelemetry[];
  options: ExportOptions;
  frameCount: number;
  range: RenderRange;
  project: VideoProject;
  plan: RenderPlan;
  captureBackend: CaptureBackendId;
  mediaDecodeMode: 'random-seek' | 'sequential-export';
  prepareMs: number;
  concatMs: number;
  audioMuxMs: number;
  started: number;
  calibration: Awaited<ReturnType<typeof calibrateWorkers>> | undefined;
  pictureValidation: Awaited<ReturnType<typeof validateSilentPicture>>;
  peakNodeRss: number;
  freeMemoryFloor: number;
}) {
  const workersReport = sessions.map((session, index) => ({
    worker: index + 1,
    chunks: chunks.filter((c) => c.worker === index + 1).map((c) => c.id),
    performance: session.performanceReport(),
  }));
  const reports = workersReport.map((w) => w.performance);
  const samples = chunks.flatMap((c) => c.frameMs).sort((a, b) => a - b);
  const sum = (
    key:
      | 'seekMs'
      | 'mediaDecodeMs'
      | 'paintFlushMs'
      | 'captureMs'
      | 'bundleMs'
      | 'browserLaunchMs',
  ) => reports.reduce((sum, p) => sum + p[key], 0);
  return {
    output: options.output,
    frames: frameCount,
    frameDiagnostics: aggregateFrameDiagnostics(
      sessions.flatMap((s) => s.frameDiagnostics),
    ),
    range,
    fps: project.fps,
    durationSeconds: frameCount / project.fps,
    renderer: 'web',
    workers: plan.workers,
    chunks: plan.chunks.length,
    captureBackend,
    mediaDecodeMode,
    performance: {
      version: 2,
      profile: options.profile ?? 'deterministic-export',
      workers: plan.workers,
      captureBackend,
      frames: frameCount,
      frameDiagnostics: aggregateFrameDiagnostics(
        sessions.flatMap((s) => s.frameDiagnostics),
      ),
      prepareMs,
      bundleMs: sum('bundleMs'),
      browserLaunchMs: sum('browserLaunchMs'),
      seekMs: sum('seekMs'),
      mediaDecodeMs: sum('mediaDecodeMs'),
      paintFlushMs: sum('paintFlushMs'),
      captureMs: sum('captureMs'),
      encoderBackpressureMs: chunks.reduce(
        (s, c) => s + c.encoderBackpressureMs,
        0,
      ),
      chunkEncodeMs: chunks.reduce((s, c) => s + c.chunkEncodeMs, 0),
      encodeMs: chunks.reduce((s, c) => s + c.chunkEncodeMs, 0),
      concatMs,
      audioMuxMs,
      totalMs: performance.now() - started,
      averageCaptureMs:
        samples.reduce((s, v) => s + v, 0) / (samples.length || 1),
      p50CaptureMs: samples[Math.floor((samples.length - 1) * 0.5)] ?? 0,
      p95CaptureMs:
        samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? 0,
      builds: reports.flatMap((p) => p.builds),
      perEngine: reports.flatMap((p) => p.perEngine),
      mediaDecode: reports.map((p) => p.mediaDecode),
      mediaIO: reports.map((p) => p.mediaIO),
      workersReport,
      calibration,
      chunks: chunks.sort((a, b) => a.startFrame - b.startFrame),
      plan,
      pictureValidation,
      memory: {
        nodePeakRss: peakNodeRss,
        systemFreeMemoryFloor: freeMemoryFloor,
        browserProcessPeak: null,
      },
    },
  };
}
