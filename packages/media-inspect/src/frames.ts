import { type MediaProbe } from '@scenewirejs/reference-core';
import { MediaError } from './process';
import { type RunOptions } from './process';
import { run } from './process';
import { ff } from './limits';
import { input } from './limits';
import { type InspectOptions } from './contracts';
import { probe } from './probe';
import { mkdir } from 'node:fs/promises';
import { type FrameEvidence } from '@scenewirejs/reference-core';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { writeJson } from './evidence';
export function tailTime(p: MediaProbe) {
  return Math.max(
    0,
    p.durationMs - Math.max(50, 1000 / (p.averageFrameRate ?? 20)),
  );
}
export function coarseTimes(p: MediaProbe, count = 12) {
  if (!Number.isInteger(count) || count < 1 || count > 60)
    throw new MediaError('media.frames', 'Frame count must be 1..60');
  return Array.from({ length: count }, (_, i) =>
    count === 1 ? p.durationMs / 2 : (i * tailTime(p)) / (count - 1),
  );
}
export async function frameBytes(
  path: string,
  timeMs: number,
  mode: 'fast' | 'accurate' = 'accurate',
  options: RunOptions = {},
) {
  if (!Number.isFinite(timeMs) || timeMs < 0)
    throw new MediaError('media.time', 'Invalid timestamp');
  const seek = ['-ss', String(timeMs / 1000)];
  return (
    await run(
      'ffmpeg',
      [
        ...ff,
        ...(mode === 'accurate'
          ? [...input(path), ...seek]
          : [...seek, ...input(path)]),
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-vf',
        'scale=960:540:force_original_aspect_ratio=decrease',
        '-f',
        'image2pipe',
        '-c:v',
        'png',
        'pipe:1',
      ],
      options,
    )
  ).stdout;
}
export async function grab(
  path: string,
  timesMs: number[],
  output: string,
  mode: 'fast' | 'accurate' = 'accurate',
  options: InspectOptions = {},
  known?: MediaProbe,
) {
  const p = known ?? (await probe(path, options));
  if (
    !timesMs.length ||
    timesMs.length > (options.maxFrames ?? 60) ||
    timesMs.some((t) => !Number.isFinite(t) || t < 0 || t >= p.durationMs) ||
    new Set(timesMs).size !== timesMs.length
  )
    throw new MediaError(
      'media.time',
      'Unique timestamps must be inside duration and frame limit',
    );
  await mkdir(output);
  const frames: FrameEvidence[] = [];
  for (const [i, timeMs] of timesMs.entries()) {
    const bytes = await frameBytes(path, timeMs, mode, options);
    if (!bytes.length)
      throw new MediaError('media.frame', 'No decoded frame at requested time');
    const name = `frame-${String(i).padStart(3, '0')}.png`;
    await writeFile(resolve(output, name), bytes, { flag: 'wx' });
    frames.push({
      id: `frame-${i}`,
      timeMs,
      path: name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sourceSha256: p.sha256,
      seekMode: mode,
    });
  }
  await writeJson(resolve(output, 'manifest.json'), {
    sourceSha256: p.sha256,
    frames,
  });
  return frames;
}
