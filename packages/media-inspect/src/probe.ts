import { realpath } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { MediaError } from './process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { type RunOptions } from './process';
import { type MediaProbe } from '@scenewirejs/reference-core';
import { run } from './process';
import { mediaProbeSchema } from '@scenewirejs/reference-core';
import { relative } from 'node:path';
import { basename } from 'node:path';
export async function hashFile(path: string, signal?: AbortSignal) {
  const file = await realpath(path);
  if (!(await stat(file)).isFile())
    throw new MediaError('media.input', 'Local regular file required');
  if (signal?.aborted)
    throw new MediaError('media.cancelled', 'Hash cancelled');
  const hash = createHash('sha256'),
    stream = createReadStream(file, { signal });
  for await (const bytes of stream) hash.update(bytes);
  return hash.digest('hex');
}
export const fraction = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const [a, b] = value.split('/').map(Number);
  const v = b ? a! / b : a;
  return v && Number.isFinite(v) && v > 0 ? v : undefined;
};
export async function probe(
  path: string,
  options: RunOptions = {},
): Promise<MediaProbe> {
  const file = await realpath(path),
    sha256 = await hashFile(file, options.signal);
  const { stdout } = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file,pipe',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      file,
    ],
    options,
  );
  const data = JSON.parse(stdout.toString()),
    v = data.streams?.find(
      (s: { codec_type: string }) => s.codec_type === 'video',
    ),
    a = data.streams?.find(
      (s: { codec_type: string }) => s.codec_type === 'audio',
    );
  if (!v) throw new MediaError('media.video', 'No video stream found');
  const avg = fraction(v.avg_frame_rate),
    nom = fraction(v.r_frame_rate);
  return mediaProbeSchema.parse({
    path: relative(process.cwd(), file) || basename(file),
    sha256,
    durationMs: Number(v.duration ?? data.format?.duration) * 1000,
    width: v.width,
    height: v.height,
    averageFrameRate: avg,
    videoCodec: v.codec_name,
    audio: a
      ? {
          codec: a.codec_name,
          sampleRate: a.sample_rate ? Number(a.sample_rate) : undefined,
          channels: a.channels,
        }
      : undefined,
    variableFrameRate: avg && nom ? Math.abs(avg - nom) > 0.01 : undefined,
  });
}
