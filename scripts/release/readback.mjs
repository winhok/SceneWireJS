import { packages, repository } from './inventory.mjs';
import { sha256 } from './candidate.mjs';
import {
  auditMetadata,
  sameDependencyMap,
} from './npm-publish-payload-audit.mjs';

// Read-only reconciliation; never retries publication or changes registry state.
export async function readback(
  candidate,
  { fetchImpl = fetch, tag = 'candidate' } = {},
) {
  if (
    candidate.repository !== repository ||
    candidate.packages.length !== packages.length ||
    JSON.stringify(candidate.packages.map((p) => p.name).sort()) !==
      JSON.stringify([...packages].sort())
  )
    throw Error('Exact public inventory required');
  if (!['candidate', 'latest'].includes(tag))
    throw Error('Unexpected dist-tag');
  const rows = [];
  for (const p of candidate.packages) {
    const response = await fetchImpl(
      `https://registry.npmjs.org/${encodeURIComponent(p.name)}`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok)
      throw Error('Registry readback unavailable; stop/reconcile');
    const packument = await response.json();
    const manifest = packument.versions?.[candidate.version];
    if (
      !manifest ||
      manifest.name !== p.name ||
      manifest.version !== candidate.version ||
      auditMetadata(manifest).length ||
      packument['dist-tags']?.[tag] !== candidate.version
    )
      throw Error('Registry metadata mismatch');
    for (const field of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ])
      if (!sameDependencyMap(manifest[field], p[field]))
        throw Error('Registry closure mismatch');
    const tarball = new URL(manifest.dist.tarball);
    if (
      tarball.protocol !== 'https:' ||
      tarball.hostname !== 'registry.npmjs.org'
    )
      throw Error('Unexpected registry tarball origin');
    const download = await fetchImpl(tarball, {
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!download.ok) throw Error('Tarball readback unavailable');
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length !== p.bytes || sha256(bytes) !== p.sha256)
      throw Error('Published tarball bytes differ');
    if (
      !manifest.dist.attestations?.url ||
      !manifest.dist.attestations.provenance
    )
      throw Error('Missing provenance anchor');
    rows.push({
      name: p.name,
      version: candidate.version,
      sha256: p.sha256,
      manifest,
      provenance: manifest.dist.attestations,
    });
  }
  return {
    rows,
    publicRegistryWrites: 0,
    byteIdentity: 'PASS',
    provenanceVerification: 'pending-signature-and-subject-validation',
    registryOnlyConsumer: 'pending',
  };
}

export function promotionPlan(candidate) {
  if (
    candidate.repository !== repository ||
    JSON.stringify(candidate.packages.map((p) => p.name).sort()) !==
      JSON.stringify([...packages].sort())
  )
    throw Error('Exact public inventory required');
  // An argv plan is deliberately not executed here. npm dist-tag --dry-run is unsafe.
  return candidate.packages.map((p) => [
    'npm',
    'dist-tag',
    'add',
    `${p.name}@${candidate.version}`,
    'latest',
    '--registry=https://registry.npmjs.org/',
    '--fetch-retries=0',
  ]);
}
