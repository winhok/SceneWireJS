import { type MediaProbe } from '@scenewirejs/reference-core';
import { type ShotCandidate } from '@scenewirejs/reference-core';
import { type InspectOptions } from './contracts';
import { type MotionProfile } from '@scenewirejs/reference-core';
import { bounded } from './limits';
import { MediaError } from './process';
import { run } from './process';
import { ff } from './limits';
import { input } from './limits';
export async function motion(
  path: string,
  p: MediaProbe,
  shots: ShotCandidate[],
  options: InspectOptions = {},
): Promise<MotionProfile> {
  bounded(p, options);
  const fps = options.motionFps ?? 4;
  if (!Number.isFinite(fps) || fps < 0.1 || fps > 30)
    throw new MediaError(
      'media.sampling',
      'Motion sampling must be 0.1..30 fps',
    );
  const { stdout } = await run(
    'ffmpeg',
    [
      ...ff,
      ...input(path),
      '-an',
      '-vf',
      `fps=${fps},scale=64:36,format=gray`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'pipe:1',
    ],
    options,
  );
  return motionFromGray(stdout, p.durationMs, shots, fps);
}
export function motionFromGray(
  stdout: Buffer,
  durationMs: number,
  shots: ShotCandidate[],
  fps: number,
): MotionProfile {
  const size = 64 * 36;
  const samples: MotionProfile['samples'] = [];
  for (let offset = size; offset + size <= stdout.length; offset += size) {
    let sum = 0;
    for (let j = 0; j < size; j++)
      sum += Math.abs(stdout[offset + j]! - stdout[offset - size + j]!);
    const timeMs = ((offset / size) * 1000) / fps;
    if (timeMs < durationMs) samples.push({ timeMs, energy: sum / size / 255 });
  }
  const peak = Math.max(0, ...samples.map((s) => s.energy));
  if (peak) for (const s of samples) s.energy /= peak;
  return {
    normalization: 'reference-max',
    samples,
    shots: shots.map((s) => {
      const v = samples
        .filter((x) => x.timeMs >= s.startMs && x.timeMs < s.endMs)
        .map((x) => x.energy);
      return {
        shotId: s.id,
        mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0,
        peak: Math.max(0, ...v),
        entry: v[0] ?? 0,
        exit: v[v.length - 1] ?? 0,
      };
    }),
  };
}
