import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepare } from './prepare.mjs';
import { verifyTarballs } from './candidate.mjs';
import { readback } from './readback.mjs';
import { packages, repository } from './inventory.mjs';
import { verifyProvenance, registryConsumer } from './qualify.mjs';
import {
  activationPolicy,
  assertWorkflow,
  exchangeToken,
  guardedSubmission,
} from './oidc.mjs';

export async function candidateSubmission(
  candidate,
  artifacts,
  {
    sha,
    npmCli,
    env = process.env,
    fetchImpl = fetch,
    exchange = exchangeToken,
    submit = guardedSubmission,
    reconcile = readback,
  } = {},
) {
  assertWorkflow(env, sha);
  if (
    candidate.publicSha !== sha ||
    candidate.repository !== repository ||
    JSON.stringify(candidate.packages.map((p) => p.name).sort()) !==
      JSON.stringify([...packages].sort())
  )
    throw Error('Complete frozen candidate required');
  if (
    JSON.stringify(artifacts.map((p) => p.name).sort()) !==
    JSON.stringify([...packages].sort())
  )
    throw Error('Complete verified artifact inventory required');
  for (const artifact of artifacts) {
    const prior = await fetchImpl(
      `https://registry.npmjs.org/${encodeURIComponent(artifact.name)}/${encodeURIComponent(candidate.version)}`,
      { signal: AbortSignal.timeout(30000), redirect: 'error' },
    );
    // Only a definitive 404 allows submission. Existing or ambiguous state is never retried.
    if (prior.status !== 404)
      throw Error(
        'Version exists or absence unconfirmed: reconcile before submission',
      );
    const token = await exchange(artifact.name, sha, { env, fetchImpl });
    try {
      await submit(npmCli, artifact, token);
    } catch {
      throw Error(
        `Ambiguous candidate result for ${artifact.name}; reconcile registry bytes/metadata before any retry`,
      );
    }
  }
  return reconcile(candidate, { fetchImpl, tag: 'candidate' });
}
export async function stablePromotion(
  candidate,
  {
    sha,
    env = process.env,
    fetchImpl = fetch,
    exchange = exchangeToken,
    qualify,
    reconcile = readback,
  } = {},
) {
  assertWorkflow(env, sha);
  if (
    candidate.publicSha !== sha ||
    candidate.repository !== repository ||
    JSON.stringify(candidate.packages.map((p) => p.name).sort()) !==
      JSON.stringify([...packages].sort())
  )
    throw Error('Complete frozen candidate required');
  if (typeof qualify !== 'function')
    throw Error('Independent provenance/consumer qualification required');
  const before = await reconcile(candidate, { fetchImpl, tag: 'candidate' });
  await qualify(candidate, before);
  for (const p of candidate.packages) {
    // Package-scoped trust must independently grant manageDistTags. Registry 403 stops.
    const token = await exchange(p.name, sha, { env, fetchImpl });
    const response = await fetchImpl(
      `https://registry.npmjs.org/-/package/${encodeURIComponent(p.name)}/dist-tags/latest`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(candidate.version),
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      },
    );
    if (!response.ok)
      throw Error(
        'Dist-tag result failed/ambiguous; reconcile all tags before continuing',
      );
  }
  return reconcile(candidate, { fetchImpl, tag: 'latest' });
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
  if (!activationPolicy[operation])
    throw Error(
      'Activation forbidden by reviewed source policy; future owner-authorized activation commit required',
    );
  if (
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
    sha
  )
    throw Error('Checked-out source SHA mismatch');
  // Future activation changes only this reviewed policy, never accepts a bypass flag.
  await prepare({
    candidatePath,
    sha,
    version,
    inventorySha256,
    artifactRoot,
    npmCli,
  });
  const candidate = JSON.parse(readFileSync(candidatePath));
  const artifacts = verifyTarballs(candidate, artifactRoot);
  if (operation === 'candidate') {
    const report = await candidateSubmission(candidate, artifacts, {
      sha,
      npmCli,
    });
    report.provenanceVerification = await verifyProvenance(
      candidate,
      artifacts,
      report,
      npmCli,
    );
    report.registryOnlyConsumer = registryConsumer(candidate, npmCli);
    console.log(JSON.stringify(report));
  } else if (operation === 'promote') {
    const report = await stablePromotion(candidate, {
      sha,
      qualify: async (current, prior) => {
        await verifyProvenance(current, artifacts, prior, npmCli);
        registryConsumer(current, npmCli);
      },
    });
    report.provenanceVerification = await verifyProvenance(
      candidate,
      artifacts,
      report,
      npmCli,
    );
    report.registryOnlyConsumer = registryConsumer(candidate, npmCli);
    console.log(JSON.stringify(report));
  }
}
