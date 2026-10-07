import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, basename, dirname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { packages, repository } from './inventory.mjs';
import {
  auditMetadata,
  sameDependencyMap,
} from './npm-publish-payload-audit.mjs';

export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export function validateIdentity(
  candidate,
  { sha, version, inventorySha256, bytes },
) {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{64}$/.test(inventorySha256))
    throw Error('Invalid frozen identity');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw Error('Invalid version');
  if (sha256(bytes) !== inventorySha256)
    throw Error('Frozen inventory SHA mismatch');
  if (
    candidate.schemaVersion !== 1 ||
    candidate.repository !== repository ||
    candidate.publicSha !== sha ||
    candidate.version !== version
  )
    throw Error('Candidate identity mismatch');
  if (
    !Array.isArray(candidate.packages) ||
    JSON.stringify(candidate.packages.map((p) => p.name).sort()) !==
      JSON.stringify([...packages].sort())
  )
    throw Error('Exact 20-package inventory required');
  for (const p of candidate.packages) {
    if (
      p.version !== version ||
      !/^[a-f0-9]{64}$/.test(p.sha256) ||
      !Number.isSafeInteger(p.bytes) ||
      p.bytes <= 0 ||
      basename(p.tarball) !== p.tarball ||
      !/^[a-z0-9.-]+\.tgz$/.test(p.tarball)
    )
      throw Error('Invalid package inventory row');
  }
  if (
    new Set(candidate.packages.map((p) => p.tarball)).size !== packages.length
  )
    throw Error('Duplicate tarball');
}
export function verifyTarballs(candidate, root) {
  const base = realpathSync(root);
  const actual = readdirSync(base)
    .filter((p) => p.endsWith('.tgz'))
    .sort();
  if (
    JSON.stringify(actual) !==
    JSON.stringify(candidate.packages.map((p) => p.tarball).sort())
  )
    throw Error('Unexpected packed tarball inventory');
  return candidate.packages.map((p) => {
    const path = realpathSync(resolve(base, p.tarball));
    if (dirname(path) !== base || !path.startsWith(base + sep))
      throw Error('Tarball escapes artifact root');
    const bytes = readFileSync(path);
    if (bytes.length !== p.bytes || sha256(bytes) !== p.sha256)
      throw Error('Tarball byte mismatch');
    const files = execFileSync('tar', ['-tzf', path], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/);
    if (
      files.some(
        (file) =>
          !/^package\/(?:$|dist\/|package\.json$|README(?:\..*)?$|LICENSE(?:\..*)?$)/i.test(
            file,
          ) || file.split('/').includes('..'),
      )
    )
      throw Error('Unbounded package files');
    const manifest = JSON.parse(
      execFileSync('tar', ['-xOf', path, 'package/package.json'], {
        encoding: 'utf8',
      }),
    );
    if (
      manifest.name !== p.name ||
      manifest.version !== candidate.version ||
      manifest.private ||
      manifest.publishConfig?.access !== 'public' ||
      auditMetadata(manifest).length
    )
      throw Error('Unsafe package manifest');
    // npm manifests may retain either exact HTTPS or git+HTTPS spelling.
    // Use a bounded allowlist; do not normalize arbitrary URLs or package bytes.
    if (
      ![
        'https://github.com/winhok/SceneWireJS.git',
        'git+https://github.com/winhok/SceneWireJS.git',
      ].includes(manifest.repository?.url)
    )
      throw Error('Public repository provenance mismatch');
    for (const field of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      if (!sameDependencyMap(manifest[field], p[field]))
        throw Error('Frozen dependency mismatch');
      for (const [name, value] of Object.entries(manifest[field] ?? {})) {
        if (
          name.startsWith('@scenewire') &&
          (!packages.includes(name) || value !== candidate.version)
        )
          throw Error('Internal dependency closure mismatch');
      }
    }
    return { ...p, path, manifest };
  });
}
