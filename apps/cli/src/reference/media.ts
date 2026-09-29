import { MediaError } from '@scenewirejs/media-inspect';
import { flags } from './options';
import { ingestMedia } from '@scenewirejs/media-inspect';
import { required } from './options';
import { options } from './options';
import { limits } from './options';
import { probe } from '@scenewirejs/media-inspect';
import { absent } from './options';
import { FFmpegSceneDetector } from '@scenewirejs/media-inspect';
import { writeJson } from '@scenewirejs/media-inspect';
import { waveform } from '@scenewirejs/media-inspect';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { waveformSvg } from '@scenewirejs/media-inspect';
import { coarseTimes } from '@scenewirejs/media-inspect';
import { grab } from '@scenewirejs/media-inspect';
import { filmstrip } from '@scenewirejs/media-inspect';
export async function mediaCommand(
  sub: string | undefined,
  file: string,
  rest: string[],
  signal: AbortSignal,
) {
  if (
    !['probe', 'grab', 'filmstrip', 'shots', 'waveform', 'ingest'].includes(
      sub ?? '',
    )
  )
    throw new MediaError('media.command', 'Unknown media command');
  if (sub === 'ingest') {
    const f = flags(rest, ['--output', '--timeout-ms']);
    return ingestMedia(file, required(f, '--output'), options(f, signal));
  }
  const allowed =
    sub === 'probe'
      ? limits
      : sub === 'grab'
        ? ['--at', '--output', '--seek', ...limits]
        : sub === 'filmstrip'
          ? ['--at', '--frames', '--every-seconds', '--output', ...limits]
          : ['--output', ...limits];
  const f = flags(rest, allowed),
    o = options(f, signal),
    p = await probe(file, o);
  if (sub === 'probe') return p;
  const output = required(f, '--output');
  await absent(output);
  if (sub === 'shots') {
    const shotCandidates = await new FFmpegSceneDetector().detect(
      { path: file, probe: p },
      o,
    );
    await writeJson(output, { sourceSha256: p.sha256, shotCandidates });
    return { sourceSha256: p.sha256, output, shotCandidates };
  }
  if (sub === 'waveform') {
    const audio = await waveform(file, p, o);
    await mkdir(output);
    await writeJson(resolve(output, 'waveform.json'), {
      sourceSha256: p.sha256,
      ...audio,
    });
    await waveformSvg(
      audio,
      resolve(output, 'waveform.svg'),
      p.durationMs,
      p.sha256,
    );
    return { sourceSha256: p.sha256, output, available: audio.available };
  }
  if (sub === 'grab' && !f.has('--at'))
    throw new MediaError('media.arguments', '--at required (seconds)');
  if (
    [f.has('--at'), f.has('--frames'), f.has('--every-seconds')].filter(Boolean)
      .length > 1
  )
    throw new MediaError('media.arguments', 'Choose one sampling mode');
  let times = f.has('--at')
    ? f
        .get('--at')!
        .split(',')
        .map((s) => (s.trim() ? Number(s) * 1000 : NaN))
    : coarseTimes(p, Number(f.get('--frames') ?? 12));
  if (f.has('--every-seconds')) {
    const step = Number(f.get('--every-seconds')) * 1000;
    if (
      !Number.isFinite(step) ||
      step <= 0 ||
      Math.ceil(p.durationMs / step) > 60
    )
      throw new MediaError(
        'media.arguments',
        'Invalid interval or frame limit exceeded',
      );
    times = Array.from(
      { length: Math.ceil(p.durationMs / step) },
      (_, i) => i * step,
    );
  }
  const mode = f.get('--seek') ?? 'accurate';
  if (mode !== 'accurate' && mode !== 'fast')
    throw new MediaError('media.arguments', '--seek must be fast or accurate');
  const frameDir = sub === 'grab' ? output : `${output}.frames`;
  await absent(frameDir);
  if (sub === 'filmstrip') await absent(`${output}.json`);
  const frames = await grab(file, times, frameDir, mode, o, p);
  if (sub === 'filmstrip') await filmstrip(frames, frameDir, output, p);
  return {
    sourceSha256: p.sha256,
    output,
    frameDirectory: frameDir,
    frames,
  };
}
