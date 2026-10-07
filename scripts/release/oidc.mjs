import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { packages, repository, environment } from './inventory.mjs';
import { sha256 } from './candidate.mjs';
import {
  publishCanonical,
  auditMetadata,
} from './npm-publish-payload-audit.mjs';

export const activationPolicy = Object.freeze({
  candidate: true,
  promote: true,
});
const registry = 'https://registry.npmjs.org/';
// GitHub API verified immutable identities for the public release repository.
const ownerId = '56586247';
const repositoryId = '1394415814';
const subject = `repo:winhok@${ownerId}/SceneWireJS@${repositoryId}:environment:${environment}`;
export function assertWorkflow(env, sha) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_SERVER_URL !== 'https://github.com' ||
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_SHA !== sha ||
    env.GITHUB_WORKFLOW_SHA !== sha ||
    env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw Error('Exact hosted public workflow binding required');
  if (
    !env.GITHUB_WORKFLOW_REF?.startsWith(
      `${repository}/.github/workflows/npm-release.yml@`,
    )
  )
    throw Error('Unexpected workflow');
  if (env.NODE_AUTH_TOKEN || env.NPM_TOKEN || env.NPM_ID_TOKEN)
    throw Error('Traditional credential fallback forbidden');
}
export async function exchangeToken(
  name,
  sha,
  { env = process.env, fetchImpl = fetch } = {},
) {
  assertWorkflow(env, sha);
  if (!packages.includes(name)) throw Error('Package outside frozen inventory');
  const request = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (
    request.protocol !== 'https:' ||
    !request.hostname.endsWith('.actions.githubusercontent.com') ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  )
    throw Error('Invalid GitHub OIDC origin');
  request.searchParams.set('audience', 'npm:registry.npmjs.org');
  const response = await fetchImpl(request, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
    },
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  if (!response.ok) throw Error('GitHub OIDC request failed');
  const { value } = await response.json();
  if (typeof value !== 'string') throw Error('Missing GitHub OIDC token');
  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(value.split('.')[1], 'base64url').toString(),
    );
  } catch {
    throw Error('Malformed OIDC claims');
  }
  // Claims are only a local sanity gate; npm validates their signed token.
  if (
    claims.iss !== 'https://token.actions.githubusercontent.com' ||
    claims.aud !== 'npm:registry.npmjs.org' ||
    claims.repository !== repository ||
    claims.repository_visibility !== 'public' ||
    claims.sha !== sha ||
    claims.sub !== subject ||
    claims.repository_owner_id !== ownerId ||
    claims.repository_id !== repositoryId ||
    claims.workflow_ref !== env.GITHUB_WORKFLOW_REF ||
    claims.workflow_sha !== sha
  )
    throw Error('OIDC claim binding mismatch');
  const exchange = await fetchImpl(
    `${registry}-/npm/v1/oidc/token/exchange/package/${name.replace('/', '%2f')}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${value}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    },
  );
  if (!exchange.ok) throw Error('Package-scoped OIDC exchange failed');
  const body = await exchange.json();
  if (typeof body.token !== 'string' || !body.token)
    throw Error('Missing package-scoped npm token');
  return body.token;
}
export function auditSubmission(body, artifact, tag) {
  if (auditMetadata(body).length)
    throw Error('Unsafe generated publication metadata');
  const versions = Object.values(body.versions ?? {});
  if (
    versions.length !== 1 ||
    versions[0].name !== artifact.name ||
    versions[0].version !== artifact.version ||
    body['dist-tags']?.[tag] !== artifact.version ||
    Object.keys(body['dist-tags'] ?? {}).length !== 1
  )
    throw Error('Submission identity mismatch');
  const attachments = Object.entries(body._attachments ?? {});
  const tgz = attachments.filter(([name]) => name.endsWith('.tgz'));
  if (
    attachments.length !== 2 ||
    tgz.length !== 1 ||
    sha256(Buffer.from(tgz[0][1].data, 'base64')) !== artifact.sha256
  )
    throw Error('Actual submission tgz bytes differ');
  if (!attachments.some(([name]) => name.endsWith('.sigstore')))
    throw Error('Submission lacks generated provenance');
  const bundle = JSON.parse(
    attachments.find(([name]) => name.endsWith('.sigstore'))[1].data,
  );
  if (auditMetadata(bundle).length) throw Error('Unsafe provenance metadata');
  if (bundle.dsseEnvelope?.payload) {
    const statement = JSON.parse(
      Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString(),
    );
    if (auditMetadata(statement).length)
      throw Error('Unsafe provenance statement');
  }
}
export async function canonicalOidcSubmit(
  npmCli,
  artifact,
  token,
  { submit = publishCanonical } = {},
) {
  if (sha256(readFileSync(artifact.path)) !== artifact.sha256)
    throw Error('Tarball changed before submit');
  return submit(npmCli, artifact.path, {
    registry,
    defaultTag: 'candidate',
    access: 'public',
    provenance: true,
    fetchRetries: 0,
    fetchTimeout: 30000,
    npmCommand: 'publish',
    '//registry.npmjs.org/:_authToken': token,
  });
}
export async function guardedSubmission(npmCli, artifact, token) {
  // Intercept the actual npm-generated request body, after provenance generation,
  // before registry transport. Scope the pinned library cache to one submission.
  const require = createRequire(npmCli);
  const fetchPath = require.resolve('npm-registry-fetch');
  const libPath = require.resolve('libnpmpublish');
  const publishPath = join(dirname(libPath), 'publish.js');
  const originalFetch = require(fetchPath);
  const originalExports = require.cache[fetchPath].exports;
  const cached = new Map(
    [libPath, publishPath].map((p) => [p, require.cache[p]]),
  );
  const wrapper = (...args) => {
    const options = args[1] ?? {};
    if (['PUT', 'POST'].includes(options.method))
      auditSubmission(options.body, artifact, 'candidate');
    return originalFetch(...args);
  };
  Object.assign(wrapper, originalFetch);
  require.cache[fetchPath].exports = wrapper;
  delete require.cache[libPath];
  delete require.cache[publishPath];
  try {
    return await canonicalOidcSubmit(npmCli, artifact, token);
  } finally {
    require.cache[fetchPath].exports = originalExports;
    for (const [p, value] of cached) {
      if (value) require.cache[p] = value;
      else delete require.cache[p];
    }
  }
}
