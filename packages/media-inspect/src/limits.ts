import { type MediaProbe } from '@scenewirejs/reference-core';
import { type InspectOptions } from './contracts';
import { MediaError } from './process';
import { resolve } from 'node:path';
export function bounded(p: MediaProbe, o: InspectOptions) {
  const max = o.maxDurationSeconds ?? 600;
  if (!Number.isFinite(max) || max <= 0 || p.durationMs > max * 1000)
    throw new MediaError(
      'media.duration',
      'Reference exceeds analysis duration limit; pass an explicit larger --max-duration-seconds',
    );
}
export const input = (path: string) => [
  '-protocol_whitelist',
  'file,pipe',
  '-i',
  resolve(path),
];
export const ff = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-nostdin',
  '-threads',
  '1',
  '-filter_threads',
  '1',
];
