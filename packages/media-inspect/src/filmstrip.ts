import { type FrameEvidence } from '@scenewirejs/reference-core';
import { type MediaProbe } from '@scenewirejs/reference-core';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { writeJson } from './evidence';
export const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export async function filmstrip(
  frames: FrameEvidence[],
  root: string,
  output: string,
  p: MediaProbe,
) {
  const w = 400,
    h = (w * p.height) / p.width,
    cols = Math.min(3, frames.length);
  const tiles = [];
  for (const [i, f] of frames.entries()) {
    const x = (i % cols) * w,
      y = Math.floor(i / cols) * (h + 30);
    tiles.push(
      `<image x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/png;base64,${(await readFile(resolve(root, f.path))).toString('base64')}"/><text x="${x + 8}" y="${y + h + 21}" font-size="14">${(f.timeMs / 1000).toFixed(3)}s ${xml(f.shotId ?? '')}</text>`,
    );
  }
  await writeFile(
    output,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * w}" height="${Math.ceil(frames.length / cols) * (h + 30)}">${tiles.join('')}</svg>`,
    { flag: 'wx' },
  );
  await writeJson(`${output}.json`, { sourceSha256: p.sha256, frames });
}
