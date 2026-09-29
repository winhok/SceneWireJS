import { writeFile } from 'node:fs/promises';
import { type InspectOptions } from './contracts';
import { type ReferenceEvidence } from '@scenewirejs/reference-core';
import { performance } from 'node:perf_hooks';
import { probe } from './probe';
import { bounded } from './limits';
import { run } from './process';
import { mkdir } from 'node:fs/promises';
import { FFmpegSceneDetector } from './shots';
import { coarseTimes } from './frames';
import { grab } from './frames';
import { resolve } from 'node:path';
import { motion } from './motion';
import { waveform } from './waveform';
import { filmstrip } from './filmstrip';
import { waveformSvg } from './waveform';
import { relative } from 'node:path';
import { realpath } from 'node:fs/promises';
import { hashFile } from './probe';
import { MediaError } from './process';
import { validateReferenceEvidence } from '@scenewirejs/reference-core';
import { dirname } from 'node:path';
export async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export async function initReference(
  path: string,
  output: string,
  options: InspectOptions = {},
): Promise<ReferenceEvidence> {
  const start = performance.now(),
    timingsMs: Record<string, number> = {};
  const measure = async <T>(name: string, fn: () => Promise<T>) => {
    const t = performance.now(),
      v = await fn();
    timingsMs[name] = performance.now() - t;
    return v;
  };
  const p = await measure('probe', () => probe(path, options));
  bounded(p, options);
  const ffmpegVersion = (await run('ffmpeg', ['-version'], options)).stdout
      .toString()
      .split('\n')[0]!,
    ffprobeVersion = (await run('ffprobe', ['-version'], options)).stdout
      .toString()
      .split('\n')[0]!;
  await mkdir(output);
  const shotCandidates = await measure('shots', () =>
    new FFmpegSceneDetector().detect({ path, probe: p }, options),
  );
  const max = options.maxFrames ?? 60,
    coarse = coarseTimes(p, Math.min(12, max));
  const times = [
    ...new Set([
      ...coarse,
      ...shotCandidates.flatMap((s) => s.representativeTimesMs),
    ]),
  ].sort((a, b) => a - b);
  // Retain coarse coverage then spend remaining budget on representatives.
  const selected =
    times.length <= max
      ? times
      : [
          ...new Set([
            ...coarse,
            ...times
              .filter((t) => !coarse.includes(t))
              .slice(0, max - coarse.length),
          ]),
        ].sort((a, b) => a - b);
  const frames = await measure('frames', () =>
    grab(path, selected, resolve(output, 'frames'), 'accurate', options, p),
  );
  for (const f of frames) {
    f.path = `frames/${f.path}`;
    f.shotId = shotCandidates.find(
      (s) => f.timeMs >= s.startMs && f.timeMs < s.endMs,
    )?.id;
  }
  const m = await measure('motion', () =>
      motion(path, p, shotCandidates, options),
    ),
    audio = await measure('audio', () => waveform(path, p, options));
  await filmstrip(frames, output, resolve(output, 'filmstrip.svg'), p);
  await waveformSvg(
    audio,
    resolve(output, 'waveform.svg'),
    p.durationMs,
    p.sha256,
  );
  // Source location is relative to evidence, not a machine-specific absolute path.
  const source = {
    path: relative(resolve(output), await realpath(path)),
    sha256: p.sha256,
  };
  p.path = source.path;
  timingsMs.total = performance.now() - start;
  const evidence: ReferenceEvidence = {
    version: 1,
    id: `reference-${p.sha256.slice(0, 12)}`,
    source,
    media: p,
    shotCandidates,
    frames,
    motion: m,
    audio,
    extraction: {
      ffmpegVersion,
      ffprobeVersion,
      config: {
        detector: 'ffmpeg-scene',
        threshold: options.threshold ?? 0.3,
        motionFps: options.motionFps ?? 4,
        motionWidth: 64,
        motionHeight: 36,
        audioSampleRate: 8000,
        audioWindowMs: 100,
        silenceRms: 0.01,
        silenceMinMs: 300,
        maxFrames: max,
        maxShots: options.maxShots ?? 100,
        maxDurationSeconds: options.maxDurationSeconds ?? 600,
        seekMode: 'accurate',
        framesOmitted: times.length - selected.length,
      },
      timingsMs,
    },
  };
  if ((await hashFile(path, options.signal)) !== p.sha256)
    throw new MediaError('media.stale', 'Source changed during extraction');
  const checked = validateReferenceEvidence(evidence);
  if (!checked.valid)
    throw new MediaError('media.evidence', checked.errors.join('; '));
  for (const [name, value] of Object.entries({
    source,
    probe: p,
    shots: { sourceSha256: p.sha256, shotCandidates },
    motion: { sourceSha256: p.sha256, ...m },
    audio: { sourceSha256: p.sha256, ...audio },
    evidence,
  }))
    await writeJson(resolve(output, `${name}.json`), value);
  return evidence;
}
export async function verifyEvidence(
  e: ReferenceEvidence,
  evidenceFile: string,
  sourceOverride?: string,
  signal?: AbortSignal,
) {
  const source =
    sourceOverride ?? resolve(dirname(evidenceFile), e.source.path);
  if ((await hashFile(source, signal)) !== e.source.sha256)
    throw new MediaError(
      'reference.stale',
      'Source SHA-256 differs from retained evidence',
    );
  for (const f of e.frames) {
    const target = resolve(dirname(evidenceFile), f.path),
      rel = relative(dirname(resolve(evidenceFile)), target);
    if (rel.startsWith('../') || rel === '..')
      throw new MediaError(
        'reference.path',
        'Frame path escapes evidence directory',
      );
    if ((await hashFile(target, signal)) !== f.sha256)
      throw new MediaError(
        'reference.frame',
        'Frame digest differs from retained evidence',
      );
  }
  return source;
}
