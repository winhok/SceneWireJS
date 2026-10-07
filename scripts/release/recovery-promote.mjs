import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packages, repository } from './inventory.mjs';
import { validateIdentity, verifyTarballs } from './candidate.mjs';
import { readback } from './readback.mjs';
import { verifyProvenance, registryConsumer } from './qualify.mjs';
import { assertWorkflow, exchangeToken } from './oidc.mjs';

export const releaseSourceSha = '1e6e660829cb95c8c25f459ee7b2d193832a2709';
export const frozenCandidateHash =
  '49f55ee35115134d362ec4f42ed35822ab9ccb30eb9e14ce0d58984e99e5e0f2';
const registry = 'https://registry.npmjs.org/';

export function assertRecovery(candidate, workflowSha, env) {
  assertWorkflow(env, workflowSha);
  if (
    !/^[a-f0-9]{40}$/.test(workflowSha) ||
    workflowSha === releaseSourceSha ||
    env.GITHUB_REF !== 'refs/heads/release/v1.2.0' ||
    env.GITHUB_WORKFLOW_REF !==
      `${repository}/.github/workflows/npm-release.yml@refs/heads/release/v1.2.0` ||
    candidate.publicSha !== releaseSourceSha ||
    candidate.version !== '1.2.0' ||
    candidate.repository !== repository ||
    JSON.stringify(candidate.packages.map((p) => p.name).sort()) !==
      JSON.stringify([...packages].sort())
  )
    throw Error(
      'Exact one-time recovery source/workflow/inventory binding required',
    );
}

export async function latestStates(candidate, fetchImpl = fetch) {
  const rows = [];
  for (const p of candidate.packages) {
    let response;
    try {
      response = await fetchImpl(`${registry}${encodeURIComponent(p.name)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
        headers: { 'cache-control': 'no-cache' },
      });
    } catch {
      throw Error(`${p.name}: READ_AMBIGUOUS`);
    }
    if (!response.ok) throw Error(`${p.name}: READ_AMBIGUOUS`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw Error(`${p.name}: READ_AMBIGUOUS`);
    }
    const latest = body['dist-tags']?.latest;
    const state =
      latest === '1.1.0'
        ? 'LATEST_1_1_0'
        : latest === '1.2.0'
          ? 'LATEST_1_2_0'
          : 'LATEST_OTHER';
    if (state === 'LATEST_OTHER') throw Error(`${p.name}: LATEST_OTHER`);
    rows.push({ name: p.name, latest, state });
  }
  return rows;
}

export async function recoveryPromote(
  candidate,
  artifacts,
  {
    workflowSha,
    env = process.env,
    npmCli,
    fetchImpl = fetch,
    write = false,
    reconcile = readback,
    verify = verifyProvenance,
    consumer = registryConsumer,
    exchange = exchangeToken,
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
    maxAttempts = 12,
  } = {},
) {
  assertRecovery(candidate, workflowSha, env);
  // Package identity and provenance always bind the original published source.
  const before = await reconcile(candidate, { fetchImpl, tag: 'candidate' });
  await verify(candidate, artifacts, before, npmCli, { fetchImpl });
  const consumerResult = consumer(candidate, npmCli);
  if (consumerResult !== 'PASS') throw Error('Registry consumer failed');
  const initial = await latestStates(candidate, fetchImpl);
  const report = {
    releaseSourceSha,
    promotionWorkflowSha: workflowSha,
    candidate: '20/20 PASS',
    provenance: '20/20 PASS',
    registryConsumer: 'PASS',
    initial,
    writes: [],
    operation: write ? 'promote' : 'verify',
  };
  if (!write) return report;
  for (const p of candidate.packages) {
    // Re-read before each write. An already promoted version is never rewritten.
    const [current] = await latestStates({ packages: [p] }, fetchImpl);
    if (current.state === 'LATEST_1_2_0') continue;
    // OIDC binds the exact recovery workflow SHA, never the artifact source SHA.
    const token = await exchange(p.name, workflowSha, { env, fetchImpl });
    let response;
    try {
      response = await fetchImpl(
        `${registry}-/package/${encodeURIComponent(p.name)}/dist-tags/latest`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify('1.2.0'),
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        },
      );
    } catch {
      throw Error(
        `${p.name}: ambiguous latest mutation; read-only reconciliation required`,
      );
    }
    if (!response.ok)
      throw Error(
        `${p.name}: ambiguous latest mutation; read-only reconciliation required`,
      );
    report.writes.push({ name: p.name, result: 'request accepted' });
  }
  // Only propagation from the known prior version may be polled; unknown tags/read errors stop.
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const rows = await latestStates(candidate, fetchImpl);
    if (rows.every((r) => r.state === 'LATEST_1_2_0')) {
      const after = await reconcile(candidate, { fetchImpl, tag: 'latest' });
      await verify(candidate, artifacts, after, npmCli, { fetchImpl });
      report.latest = rows;
      report.result = 'PASS';
      return report;
    }
    if (attempt + 1 < maxAttempts)
      await wait(Math.min(5000 * 2 ** attempt, 30000));
  }
  throw Error(
    'Latest propagation deadline; read-only reconciliation required, never blind retry',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [
      operation,
      candidatePath,
      workflowSha,
      inventoryHash,
      artifactRoot,
      npmCli,
      reportPath,
    ] = process.argv.slice(2);
    if (
      !['verify', 'promote'].includes(operation) ||
      inventoryHash !== frozenCandidateHash
    )
      throw Error('Unsupported recovery operation or changed frozen candidate');
    if (
      execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim() !== workflowSha
    )
      throw Error('Recovery checkout SHA mismatch');
    const bytes = readFileSync(candidatePath),
      candidate = JSON.parse(bytes);
    validateIdentity(candidate, {
      sha: releaseSourceSha,
      version: '1.2.0',
      inventorySha256: frozenCandidateHash,
      bytes,
    });
    const artifacts = verifyTarballs(candidate, artifactRoot);
    const report = await recoveryPromote(candidate, artifacts, {
      workflowSha,
      npmCli,
      write: operation === 'promote',
    });
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({
        operation,
        releaseSourceSha,
        promotionWorkflowSha: workflowSha,
        result: operation === 'verify' ? 'PASS' : report.result,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
