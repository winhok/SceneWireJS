import { readFile } from 'node:fs/promises';
import { MediaError } from '@scenewirejs/media-inspect';
import { type InspectOptions } from '@scenewirejs/media-inspect';
import { lstat } from 'node:fs/promises';
export const json = async (path: string) =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;
export const flags = (args: string[], allowed: string[]) => {
  const out = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i]!,
      v = args[i + 1];
    if (!allowed.includes(k) || v === undefined || out.has(k))
      throw new MediaError('reference.arguments', `Invalid flag ${k}`);
    out.set(k, v);
  }
  return out;
};
export const required = (f: Map<string, string>, key: string) => {
  const v = f.get(key);
  if (!v) throw new MediaError('reference.arguments', `${key} is required`);
  return v;
};
export const limits = [
  '--max-duration-seconds',
  '--motion-fps',
  '--threshold',
  '--max-frames',
  '--max-shots',
  '--timeout-ms',
];
export function options(
  f: Map<string, string>,
  signal: AbortSignal,
): InspectOptions {
  const out: InspectOptions = { signal };
  for (const [flag, key] of [
    ['--max-duration-seconds', 'maxDurationSeconds'],
    ['--motion-fps', 'motionFps'],
    ['--threshold', 'threshold'],
    ['--max-frames', 'maxFrames'],
    ['--max-shots', 'maxShots'],
    ['--timeout-ms', 'timeoutMs'],
  ] as const) {
    if (f.has(flag)) {
      const n = Number(f.get(flag));
      if (!Number.isFinite(n) || n <= 0)
        throw new MediaError('reference.arguments', `Invalid ${flag}`);
      out[key] = n;
    }
  }
  if (out.maxFrames && (!Number.isInteger(out.maxFrames) || out.maxFrames > 60))
    throw new MediaError('reference.arguments', 'max-frames must be 1..60');
  if (out.maxShots && !Number.isInteger(out.maxShots))
    throw new MediaError('reference.arguments', 'max-shots must be an integer');
  return out;
}
export async function absent(path: string) {
  try {
    await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  throw new MediaError('reference.output', `Output already exists: ${path}`);
}
