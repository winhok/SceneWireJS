import { type MediaProbe } from '@scenewirejs/reference-core';
import { type InspectOptions } from './contracts';
import { type AudioProfile } from '@scenewirejs/reference-core';
import { bounded } from './limits';
import { run } from './process';
import { ff } from './limits';
import { input } from './limits';
import { writeFile } from 'node:fs/promises';
export async function waveform(
  path: string,
  p: MediaProbe,
  options: InspectOptions = {},
): Promise<AudioProfile> {
  bounded(p, options);
  if (!p.audio) return { available: false, samples: [], silence: [] };
  const rate = 8000,
    window = 800,
    { stdout } = await run(
      'ffmpeg',
      [
        ...ff,
        ...input(path),
        '-vn',
        '-map',
        '0:a:0',
        '-ac',
        '1',
        '-ar',
        String(rate),
        '-f',
        'f32le',
        'pipe:1',
      ],
      options,
    );
  const samples: AudioProfile['samples'] = [],
    silence: AudioProfile['silence'] = [];
  let quiet: number | undefined;
  for (let offset = 0; offset < stdout.length / 4; offset += window) {
    const n = Math.min(window, stdout.length / 4 - offset);
    let sum = 0,
      peak = 0;
    for (let i = 0; i < n; i++) {
      const v = stdout.readFloatLE((offset + i) * 4);
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const rms = Math.min(1, Math.sqrt(sum / n)),
      timeMs = (offset / rate) * 1000;
    if (timeMs >= p.durationMs) break;
    samples.push({ timeMs, rms, peak: Math.min(1, peak) });
    if (rms < 0.01) {
      quiet ??= timeMs;
    } else if (quiet !== undefined) {
      if (timeMs - quiet >= 300)
        silence.push({ startMs: quiet, endMs: timeMs });
      quiet = undefined;
    }
  }
  const decodedEnd = Math.min(p.durationMs, (stdout.length / 4 / rate) * 1000);
  if (quiet !== undefined && decodedEnd - quiet >= 300)
    silence.push({ startMs: quiet, endMs: decodedEnd });
  return { available: true, samples, silence };
}
export async function waveformSvg(
  audio: AudioProfile,
  output: string,
  durationMs: number,
  sha256: string,
) {
  const points = audio.samples
    .map((s) => `${(s.timeMs / durationMs) * 1000},${100 - s.rms * 95}`)
    .join(' ');
  await writeFile(
    output,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="120"><desc>Source SHA-256 ${sha256}; audio ${audio.available ? 'available' : 'unavailable'}</desc><polyline fill="none" stroke="black" points="${points}"/></svg>`,
    { flag: 'wx' },
  );
}
