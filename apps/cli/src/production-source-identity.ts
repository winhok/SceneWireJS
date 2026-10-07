import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

async function exists(path: string) {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** Fingerprint executable module bytes, not the CLI executable or formatter. */
export async function producerModuleClosure(
  root: string,
  entries: readonly string[],
): Promise<{ modules: [string, string][]; dependencies: string[] }> {
  const seen = new Set<string>();
  const modules: [string, string][] = [];
  const dependencies = new Set<string>();
  async function visit(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    const text = await readFile(path, 'utf8');
    modules.push([
      relative(root, path).replaceAll('\\', '/'),
      createHash('sha256').update(text).digest('hex'),
    ]);
    // Relative imports, re-exports and literal dynamic imports. Type-only edges do not execute.
    const edges =
      /(?:\b(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"]+)\1/g;
    for (const match of text.matchAll(edges)) {
      const specifier = match[2]!;
      if (specifier.startsWith('node:')) continue;
      if (!specifier.startsWith('.')) {
        dependencies.add(
          specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0]!,
        );
        continue;
      }
      const base = join(dirname(path), specifier);
      const candidates = /\.[cm]?[jt]sx?$/.test(base)
        ? [base]
        : [
            base + '.ts',
            base + '.tsx',
            base + '.js',
            join(base, 'index.ts'),
            join(base, 'index.js'),
          ];
      const target = (await Promise.all(candidates.map(exists))).findIndex(
        Boolean,
      );
      if (target < 0) throw Error(`Missing producer module: ${specifier}`);
      await visit(candidates[target]!);
    }
  }
  for (const entry of entries) await visit(join(root, entry));
  return {
    modules: modules.sort(([a], [b]) => a.localeCompare(b, 'en')),
    dependencies: [...dependencies].sort(),
  };
}

/** Bound a producer call while ignoring delimiters in strings and comments. */
function producerBounds(source: string, kind: string): [number, number] {
  const start = source.indexOf(`producers.set('${kind}'`);
  const alternate = source.indexOf(`producers.set("${kind}"`);
  const offset = start >= 0 ? start : alternate;
  if (offset < 0)
    throw Error(`Missing actual producer implementation: ${kind}`);
  let depth = 0;
  let quote = '';
  for (
    let index = source.indexOf('(', offset);
    index < source.length;
    index++
  ) {
    const character = source[index]!;
    if (quote) {
      if (character === '\\') index++;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index);
      if (end < 0) break;
      index = end;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) break;
      index = end + 1;
      continue;
    }
    if (character === '(') depth++;
    if (character === ')' && --depth === 0) return [offset, index + 1];
  }
  throw Error('Unbounded actual producer implementation');
}
/** Exact producer block; unrelated producer edits must not invalidate siblings. */
export function producerImplementation(source: string, kind: string): string {
  const [start, end] = producerBounds(source, kind);
  return source.slice(start, end);
}

export function createProducerSourceIdentity(
  source: string,
): Record<string, string> {
  const start = source.indexOf('const duration');
  const header = source.indexOf('export function createMediaProducers');
  const interfaceStart = source.indexOf(
    'export interface MediaProducerOptions',
  );
  const end = interfaceStart >= 0 ? interfaceStart : header;
  const [first] = producerBounds(source, 'render-range-raster');
  const [, last] = producerBounds(source, 'final-media');
  const returned = source.indexOf('return producers;', last);
  if (
    start < 0 ||
    end < start ||
    header < 0 ||
    first < header ||
    returned < last
  )
    throw Error('Missing media producer shared implementation');
  const shared =
    source.slice(0, start) +
    source.slice(start, end) +
    source.slice(header, first) +
    source.slice(last, returned + 'return producers;'.length);
  return Object.fromEntries(
    ['render-range-raster', 'audio-mix', 'final-media'].map((kind) => [
      kind,
      createHash('sha256')
        .update(shared)
        .update(producerImplementation(source, kind))
        .digest('hex'),
    ]),
  );
}
