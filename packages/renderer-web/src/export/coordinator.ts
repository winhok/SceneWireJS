import { renderChunks } from './workers';
import { exportReport } from './report';
import type { ChunkTelemetry } from './telemetry';
import { calibrateWorkers } from '../calibration';
import {
  validateRenderRange,
  createRenderPlan,
  type RenderProgress,
} from '@scenewirejs/renderer-core';
import { mkdtemp, rm, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir, freemem } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { projectSchema } from '@scenewirejs/schema';
import { WebRendererSession } from '../session/session';
import { RenderError } from '../contracts';
import type { ExportOptions } from './options';
import { EncoderError } from './encoder';
import { mixAndMuxProjectAudio } from './audio';
import { concatSilentChunks } from './chunk';
import { validateSilentPicture } from './validation';
export async function renderVideo(options: ExportOptions) {
  const started = performance.now();
  const project = projectSchema.parse(options.project);
  const total = Math.max(
    ...project.scenes.map((s) => s.startFrame + s.durationFrames),
  );
  const range = validateRenderRange(
    options.range ?? { startFrame: 0, endFrame: total },
    total,
  );
  const requestedWorkers = options.workers ?? 1;
  let plan = createRenderPlan(
    range,
    requestedWorkers === 'auto' ? 1 : requestedWorkers,
    options.chunkFrames,
  );
  let calibration: Awaited<ReturnType<typeof calibrateWorkers>> | undefined;
  const frameCount = range.endFrame - range.startFrame;
  if (
    await access(options.output).then(
      () => true,
      () => false,
    )
  )
    throw Error('Output already exists');
  const directory = await mkdtemp(join(tmpdir(), 'scenewire-export-'));
  const controller = new AbortController(),
    abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, options.renderTimeoutMs ?? 600000);
  let peakNodeRss = process.memoryUsage().rss,
    freeMemoryFloor = freemem();
  const memoryTimer = setInterval(() => {
    peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss);
    freeMemoryFloor = Math.min(freeMemoryFloor, freemem());
  }, 200);
  const captureBackend =
    options.captureBackend ??
    (requestedWorkers === 1 ? 'playwright-element' : 'cdp-page');
  const mediaDecodeMode =
    options.mediaDecodeMode ??
    (requestedWorkers === 1 ? 'random-seek' : 'sequential-export');
  const sessions = Array.from(
    { length: plan.workers },
    () =>
      new WebRendererSession({
        ...options,
        project,
        captureBackend,
        mediaDecodeMode,
        signal: controller.signal,
      }),
  );
  const chunks: ChunkTelemetry[] = [];
  const files = plan.chunks.map((_, i) => join(directory, `chunk-${i}.mp4`));
  let phase: RenderProgress['phase'] = 'prepare',
    completed = 0,
    activeWorkers = 0,
    chunksCompleted = 0;
  const progress = () =>
    options.onRenderProgress?.({
      phase,
      framesCompleted: completed,
      framesTotal: frameCount,
      activeWorkers,
      chunksCompleted,
      chunksTotal: plan.chunks.length,
    });
  let failure: unknown;
  let validatedPicture: string | undefined;
  let retainPicture = false;
  const fail = (error: unknown) => {
    failure ??= error;
    controller.abort();
  };
  try {
    progress();
    const prepareStart = performance.now();
    // First prepare primes immutable composition bundles before the remaining workers start.
    try {
      await sessions[0]!.prepare();
    } catch (error) {
      if (error instanceof RenderError)
        throw new RenderError({ ...error.diagnostic, worker: 1 });
      throw error;
    }
    if (requestedWorkers === 'auto') {
      calibration = await calibrateWorkers(sessions[0]!, range);
      plan = createRenderPlan(
        range,
        calibration.selectedWorkers,
        options.chunkFrames,
      );
      for (let i = 1; i < plan.workers; i++)
        sessions.push(
          new WebRendererSession({
            ...options,
            project,
            captureBackend,
            mediaDecodeMode,
            signal: controller.signal,
          }),
        );
      files.splice(
        0,
        files.length,
        ...plan.chunks.map((_, i) => join(directory, `chunk-${i}.mp4`)),
      );
    }
    const preparation = await Promise.allSettled(
      sessions.slice(1).map(async (session, index) => {
        try {
          await session.prepare();
        } catch (error) {
          const diagnostic = session.failureDiagnostic(error, 'prepare');
          fail(new RenderError({ ...diagnostic, worker: index + 2 }));
        }
      }),
    );
    for (const result of preparation)
      if (result.status === 'rejected') fail(result.reason);
    if (failure) throw failure;
    const prepareMs = performance.now() - prepareStart;
    phase = 'render';
    await renderChunks({
      sessions,
      plan,
      files,
      signal: controller.signal,
      mediaDecodeMode,
      onActive: (delta) => {
        activeWorkers += delta;
      },
      onProgress: progress,
      onChunk: (chunk) => {
        chunks.push(chunk);
        chunksCompleted++;
      },
      onFrame: async (frame, source, worker, chunk) => {
        await options.onFrame?.(frame, source, worker, chunk);
        completed++;
        options.onProgress?.(completed, frameCount);
        progress();
      },
      onFailure: fail,
    });
    if (failure) throw failure;
    if (controller.signal.aborted) throw Error('Render cancelled');
    phase = 'concat';
    progress();
    const { video, concatMs } = await concatSilentChunks(
      files,
      directory,
      controller.signal,
    );
    const pictureValidation = await validateSilentPicture(
      video,
      project,
      frameCount,
      controller.signal,
    );
    validatedPicture = video;
    clearTimeout(timer); // Audio is bounded by progress-aware inactivity instead.
    phase = 'audio';
    progress();
    const audioStart = performance.now();
    const final = await mixAndMuxProjectAudio(
      project,
      options.projectRoot,
      range,
      video,
      join(directory, 'final.mp4'),
      controller.signal,
      {
        stallTimeoutMs: options.audioStallTimeoutMs,
        onProgress: options.onAudioProgress,
      },
    );
    const audioMuxMs = performance.now() - audioStart;
    phase = 'finalize';
    progress();
    await Promise.all(sessions.map((s) => s.dispose()));
    if (controller.signal.aborted) throw Error('Render cancelled');
    await copyFile(final, resolve(options.output), constants.COPYFILE_EXCL);
    progress();
    return exportReport({
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
    });
  } catch (error) {
    controller.abort();
    retainPicture = phase === 'audio' && validatedPicture !== undefined;
    if (error instanceof RenderError) throw error;
    throw new RenderError({
      renderer: 'web',
      engine: 'project',
      composition: 'project',
      frame: null,
      phase,
      ...(retainPicture ? { retainedPicture: validatedPicture } : {}),
      ...(error instanceof EncoderError ? { encoder: error.diagnostic } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
    clearInterval(memoryTimer);
    options.signal?.removeEventListener('abort', abort);
    await Promise.all(sessions.map((s) => s.dispose()));
    if (retainPicture) {
      await Promise.all(
        [...files, join(directory, 'final.mp4'), join(directory, 'chunks.txt')]
          .filter((file) => file !== validatedPicture)
          .map((file) => rm(file, { force: true })),
      );
    } else await rm(directory, { recursive: true, force: true });
  }
}
