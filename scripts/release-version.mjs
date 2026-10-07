import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const version = process.argv[2];
if (
  !/^(?:0\.15\.0|1\.0\.0-rc\.[1-9]\d*|1\.0\.[01]|1\.1\.0|1\.2\.0)$/.test(
    version ?? '',
  )
)
  throw Error(
    'Expected release train version: 0.15.0, 1.0.0-rc.N, 1.0.0, 1.0.1, 1.1.0 or 1.2.0',
  );
for (const directory of [
  ...readdirSync('packages').map((name) => `packages/${name}`),
  'apps/cli',
]) {
  const path = `${directory}/package.json`,
    metadata = JSON.parse(readFileSync(path));
  metadata.version = version;
  writeFileSync(path, JSON.stringify(metadata, null, 2) + '\n');
}
console.log(
  `Updated all publishable manifests to ${version}; run pnpm install --lockfile-only before building/packing.`,
);
