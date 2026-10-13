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
/** Decode exact frame indices in one bounded pass, preserving requested order. */
export async function frameBytesBatch(
  path: string,
  indices: readonly number[],
  options: RunOptions & { nativeSize?: boolean } = {},
): Promise<Buffer[]> {
  if (
    !indices.length ||
    indices.length > 120 ||
    new Set(indices).size !== indices.length ||
    indices.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 18000)
  )
    throw new MediaError(
      'media.time',
      'Unique frame indices must be 0..18000, count 1..120',
    );
  const sorted = [...indices].sort((a, b) => a - b);
  // A flat sum reaches FFmpeg's expression recursion limit at large batches.
  const selection = (values: number[]): string => {
    if (values.length === 1) return `eq(n\\,${values[0]})`;
    const middle = Math.floor(values.length / 2);
    return `(${selection(values.slice(0, middle))}+${selection(values.slice(middle))})`;
  };
  const filters = [
    `select=${selection(sorted)}`,
    ...(options.nativeSize
      ? []
      : ['scale=960:540:force_original_aspect_ratio=decrease']),
  ];
  const { stdout } = await run(
    'ffmpeg',
    [
      ...ff,
      ...input(path),
      '-map',
      '0:v:0',
      '-vf',
      filters.join(','),
      '-fps_mode',
      'passthrough',
      '-frames:v',
      String(sorted.length),
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      'pipe:1',
    ],
    options,
  );
  const frames: Buffer[] = [];
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 0;
  while (offset < stdout.length) {
    const start = offset;
    if (!stdout.subarray(offset, offset + 8).equals(signature))
      throw new MediaError('media.frame', 'Invalid decoded PNG stream');
    offset += 8;
    let complete = false;
    while (offset + 12 <= stdout.length) {
      const length = stdout.readUInt32BE(offset);
      const kind = stdout.toString('ascii', offset + 4, offset + 8);
      if (length > stdout.length - offset - 12) break;
      offset += length + 12;
      if (kind === 'IEND') {
        if (length !== 0) break;
        complete = true;
        break;
      }
    }
    if (!complete || frames.length >= sorted.length)
      throw new MediaError('media.frame', 'Incomplete or extra decoded PNG');
    frames.push(stdout.subarray(start, offset));
  }
  if (frames.length !== sorted.length)
    throw new MediaError(
      'media.frame',
      'Missing decoded frame at requested index',
    );
  return indices.map((n) => frames[sorted.indexOf(n)]!);
}
export async function frameBytes(
  path: string,
  timeMs: number,
  mode: 'fast' | 'accurate' = 'accurate',
  options: RunOptions & { nativeSize?: boolean; frameIndex?: number } = {},
) {
  if (!Number.isFinite(timeMs) || timeMs < 0)
    throw new MediaError('media.time', 'Invalid timestamp');
  if (
    options.frameIndex !== undefined &&
    (!Number.isSafeInteger(options.frameIndex) ||
      options.frameIndex < 0 ||
      options.frameIndex > 18000)
  )
    throw new MediaError('media.time', 'Invalid frame index');
  const seek = ['-ss', String(timeMs / 1000)];
  const filters = [
    ...(options.frameIndex === undefined
      ? []
      : [`select=eq(n\\,${options.frameIndex})`]),
    ...(options.nativeSize
      ? []
      : ['scale=960:540:force_original_aspect_ratio=decrease']),
  ];
  return (
    await run(
      'ffmpeg',
      [
        ...ff,
        ...(options.frameIndex !== undefined
          ? input(path)
          : mode === 'accurate'
            ? [...input(path), ...seek]
            : [...seek, ...input(path)]),
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        ...(filters.length ? ['-vf', filters.join(',')] : []),
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
