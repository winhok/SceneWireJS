import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const expected = JSON.parse(readFileSync('package.json')).packageManager.split(
  '@',
)[1];
if (
  execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim() !== expected
)
  throw Error('Use pinned pnpm');
const artifactRoot = resolve('.build/npm');
mkdirSync(artifactRoot, { recursive: true });
const directories = [
  ...readdirSync('packages').map((name) => `packages/${name}`),
  'apps/cli',
];
const version = JSON.parse(
  readFileSync('packages/schema/package.json'),
).version;
const packages = [];
for (const directory of directories) {
  const metadata = JSON.parse(readFileSync(`${directory}/package.json`));
  execFileSync(
    'pnpm',
    ['--dir', directory, 'pack', '--pack-destination', artifactRoot],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const filename = `${metadata.name.slice(1).replace('/', '-')}-${version}.tgz`,
    tarball = resolve(artifactRoot, filename);
  const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .trim()
    .split('\n');
  const packed = JSON.parse(
    execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
      encoding: 'utf8',
    }),
  );
  if (
    packed.private === true ||
    packed.version !== version ||
    packed.engines?.node !== '>=22.12.0' ||
    packed.publishConfig?.access !== 'public'
  )
    throw Error(`Bad packed metadata: ${packed.name}`);
  if (JSON.stringify(packed).includes('workspace:'))
    throw Error(`Workspace protocol survived pack: ${packed.name}`);
  for (const file of files)
    if (
      !/^package\/(?:dist\/|package\.json$|README(?:\..*)?$|LICENSE(?:\..*)?$)/i.test(
        file,
      )
    )
      throw Error(`Unbounded packed file: ${file}`);
  const targets = Object.values(packed.exports ?? {}).flatMap((target) =>
    Object.values(target),
  );
  for (const target of [...targets, ...Object.values(packed.bin ?? {})])
    if (
      !target.startsWith('./dist/') ||
      !files.includes('package/' + target.slice(2))
    )
      throw Error(`Missing packed target: ${packed.name} ${target}`);
  const bytes = readFileSync(tarball);
  packages.push({
    name: packed.name,
    version: packed.version,
    tarball: filename,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    exports: packed.exports ?? null,
    bin: packed.bin ?? null,
    dependencies: packed.dependencies ?? {},
    files: files.length,
    manifest: 'PASS',
    nodeImport: 'pending',
    typecheck: 'pending',
  });
}
writeFileSync(
  artifactRoot + '/manifest.json',
  JSON.stringify({ pnpm: expected, packages }, null, 2) + '\n',
);
console.log(
  `Packed and verified ${packages.length} bounded npm artifacts at .build/npm`,
);
