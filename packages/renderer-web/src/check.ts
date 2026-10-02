import type { ResolvedFrameDiagnostic } from '@scenewirejs/renderer-core';
import {
  stableDiagnosticValue,
  aggregateFrameDiagnostics,
} from './frame-diagnostics';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VideoProject } from '@scenewirejs/schema';
import { comparePixels, sameEnvironmentTolerance } from './png';
import { RenderError, type WebRenderOptions } from './contracts';
import { WebRendererSession } from './session/session';
export function representativeFrames(project: VideoProject) {
  const duration = Math.max(
    ...project.scenes.map((s) => s.startFrame + s.durationFrames),
  );
  return [
    ...new Set([
      0,
      ...[0.2, 0.4, 0.6, 0.8].map((p) => Math.floor((duration - 1) * p)),
      duration - 1,
    ]),
  ];
}
export async function renderCheck(
  options: WebRenderOptions,
  frames = representativeFrames(options.project),
) {
  const duration = Math.max(
    ...options.project.scenes.map((s) => s.startFrame + s.durationFrames),
  );
  if (
    !frames.length ||
    frames.some(
      (frame) => !Number.isSafeInteger(frame) || frame < 0 || frame >= duration,
    )
  )
    throw Error(
      'render-check requires a nonempty set of integer frames within project duration',
    );
  frames = [...new Set(frames)];
  const diagnosticFacts: ResolvedFrameDiagnostic[] = [];
  const diagnosticHashes = new Map<number, string>();
  let diagnosticFramesChecked = 0;
  let diagnosticCapability: boolean | undefined;
  const hashes = new Map<number, string>(),
    firstFrames = new Map<number, Buffer>(),
    reports = [],
    comparisons: unknown[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const session = new WebRendererSession(options);
    try {
      await session.prepare();
      if (pass === 0) diagnosticCapability = session.hasFrameDiagnostics;
      else if (diagnosticCapability !== session.hasFrameDiagnostics)
        throw new RenderError({
          renderer: 'web',
          composition: 'project',
          frame: null,
          phase: 'diagnostic-determinism',
          error: 'Frame diagnostic capability changed between fresh sessions',
        });
      if (session.hasFrameDiagnostics) {
        const sweep = Array.from({ length: duration }, (_, frame) => frame);
        for (const frame of pass === 0 ? sweep : sweep.reverse()) {
          const { diagnostics } = await session.seekFrame(
            session.contextAt(frame),
            false,
          );
          const identity = stableDiagnosticValue(
            diagnostics
              .map((d) =>
                Object.fromEntries(
                  Object.entries(d).filter(([, v]) => v !== undefined),
                ),
              )
              .sort((a, b) =>
                stableDiagnosticValue(a).localeCompare(
                  stableDiagnosticValue(b),
                ),
              ),
          );
          if (pass === 0) {
            diagnosticHashes.set(frame, identity);
            diagnosticFacts.push(...diagnostics);
            diagnosticFramesChecked++;
          } else if (diagnosticHashes.get(frame) !== identity)
            throw new RenderError({
              renderer: 'web',
              composition: 'project',
              frame,
              phase: 'diagnostic-determinism',
              error: `Frame diagnostics differ at frame ${frame}`,
            });
        }
        if (pass === 1 && diagnosticFacts.some((d) => d.severity === 'error'))
          throw new RenderError({
            renderer: 'web',
            composition: 'project',
            frame: diagnosticFacts.find((d) => d.severity === 'error')!.frame,
            phase: 'frame-validation',
            error: 'Frame quality violation',
            frameDiagnostics: diagnosticFacts,
          });
      }

      if (pass === 0 && diagnosticFacts.some((d) => d.severity === 'error'))
        continue;
      for (const frame of pass === 0
        ? [...frames, ...[...frames].reverse()]
        : frames) {
        const result = await session.renderFrame(session.contextAt(frame));
        const hash = createHash('sha256').update(result.source).digest('hex');
        if (hashes.has(frame)) {
          const comparison =
            hashes.get(frame) === hash
              ? {
                  matched: true,
                  changedPixels: 0,
                  changedPixelFraction: 0,
                  maxChannelDelta: 0,
                }
              : comparePixels(firstFrames.get(frame)!, result.source);
          comparisons.push({ frame, session: pass + 1, ...comparison });
          if (!comparison.matched) {
            if (process.env.SCENEWIRE_MISMATCH_DIR) {
              await writeFile(
                join(process.env.SCENEWIRE_MISMATCH_DIR, `before-${frame}.png`),
                firstFrames.get(frame)!,
              );
              await writeFile(
                join(process.env.SCENEWIRE_MISMATCH_DIR, `after-${frame}.png`),
                result.source,
              );
            }
            throw new RenderError({
              renderer: 'web',
              composition: 'project',
              frame,
              phase: 'determinism',
              error: `Same-environment pixels differ at frame ${frame}, session ${pass + 1}`,
            });
          }
        }
        if (!hashes.has(frame)) hashes.set(frame, hash);
        if (!firstFrames.has(frame)) firstFrames.set(frame, result.source);
      }
    } finally {
      await session.dispose();
      reports.push(session.performanceReport());
    }
  }
  return {
    valid: true,
    frames: [...hashes].map(([frame, sha256]) => ({ frame, sha256 })),
    freshSessions: 2,
    diagnosticFramesChecked,
    frameDiagnostics: aggregateFrameDiagnostics(diagnosticFacts),
    tolerance: sameEnvironmentTolerance,
    comparisons,
    performance: reports,
  };
}
