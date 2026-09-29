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
  const hashes = new Map<number, string>(),
    firstFrames = new Map<number, Buffer>(),
    reports = [],
    comparisons: unknown[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const session = new WebRendererSession(options);
    try {
      await session.prepare();
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
    tolerance: sameEnvironmentTolerance,
    comparisons,
    performance: reports,
  };
}
