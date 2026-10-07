import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateIdentity, verifyTarballs } from './candidate.mjs';
import { capturePublish } from './npm-publish-payload-audit.mjs';
import { packages, npmVersion, repository } from './inventory.mjs';

export async function prepare({
  candidatePath,
  sha,
  version,
  inventorySha256,
  artifactRoot,
  npmCli,
}) {
  const bytes = readFileSync(candidatePath);
  const candidate = JSON.parse(bytes);
  validateIdentity(candidate, { sha, version, inventorySha256, bytes });
  const artifacts = verifyTarballs(candidate, artifactRoot);
  if (
    execFileSync(process.execPath, [npmCli, '--version'], {
      encoding: 'utf8',
    }).trim() !== npmVersion
  )
    throw Error('Exact pinned npm required');
  const payloads = [];
  for (const artifact of artifacts) {
    const audit = await capturePublish(
      npmCli,
      artifact.path,
      'library',
      'candidate',
    );
    if (audit.result !== 'PASS')
      throw Error('Canonical generated payload audit failed');
    payloads.push({ name: artifact.name, sha256: artifact.sha256, ...audit });
  }
  return {
    schemaVersion: 1,
    repository,
    publicSha: sha,
    version,
    operation: 'prepare',
    packageCount: packages.length,
    payloads,
    publicRegistryWrites: 0,
    oidcQualified: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [
    operation,
    candidatePath,
    sha,
    version,
    inventorySha256,
    artifactRoot,
    npmCli,
  ] = process.argv.slice(2);
  if (operation !== 'prepare')
    throw Error(
      'Activation forbidden: canonical OIDC adapter and dist-tag authority require independent review/qualification',
    );
  const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (
    actualSha !== sha ||
    process.env.GITHUB_SHA !== sha ||
    process.env.GITHUB_REPOSITORY !== repository
  )
    throw Error('Exact public workflow source binding required');
  console.log(
    JSON.stringify(
      await prepare({
        candidatePath,
        sha,
        version,
        inventorySha256,
        artifactRoot,
        npmCli,
      }),
      null,
      2,
    ),
  );
}
