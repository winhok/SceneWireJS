import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import prettier from 'prettier';

// These exact files retain qualified bytes after the longer public namespace.
export const normalizedFiles = [
  'packages/domain-developer/src/index.ts',
  'packages/editor-core/src/index.ts',
  'packages/renderer-canvas/src/index.ts',
  'packages/renderer-web/src/session/prepare.ts',
];
const packages = [
  'audio',
  'cli',
  'compiler',
  'director-core',
  'domain-developer',
  'domain-editorial',
  'domain-education',
  'editor',
  'editor-core',
  'media',
  'media-inspect',
  'patch',
  'production-core',
  'reference-core',
  'renderer-canvas',
  'renderer-core',
  'renderer-web',
  'runtime',
  'schema',
  'time',
  'web-runtime',
];
const namespace = new RegExp(
  `(?<![\\w/])@scenewirejs/(${packages.join('|')})(?![\\w-])`,
  'g',
);

export function privateNamespace(text) {
  return text.replace(namespace, (token) => token.replace('js/', '/'));
}

export async function checkNormalized(text, filepath) {
  const options = await prettier.resolveConfig(filepath);
  return prettier.check(privateNamespace(text), { ...options, filepath });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ordinary = spawnSync('prettier', ['--check', '.'], {
    stdio: 'inherit',
  });
  let failed = ordinary.status !== 0;
  for (const filepath of normalizedFiles) {
    const passed = await checkNormalized(
      readFileSync(filepath, 'utf8'),
      filepath,
    );
    console.log(`${passed ? 'PASS' : 'FAIL'} namespace format: ${filepath}`);
    failed ||= !passed;
  }
  process.exitCode = failed ? 1 : 0;
}
