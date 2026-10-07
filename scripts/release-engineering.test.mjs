// Portable fixtures for the audited release contract; all transport is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { packages, repository } from './release/inventory.mjs';
import {
  validateIdentity,
  verifyTarballs,
  sha256,
} from './release/candidate.mjs';
import { readback, promotionPlan } from './release/readback.mjs';

const sha = 'a'.repeat(40);
const version = '1.2.0-candidate.1';
function fixture(repositoryUrl = 'https://github.com/winhok/SceneWireJS.git') {
  const root = mkdtempSync(join(tmpdir(), 'scenewire-release-test-'));
  const artifacts = join(root, 'artifacts');
  mkdirSync(artifacts);
  const entries = packages.map((name, index) => {
    const source = join(root, String(index));
    mkdirSync(join(source, 'package', 'dist'), { recursive: true });
    const dependencies = index ? { [packages[0]]: version } : {};
    writeFileSync(
      join(source, 'package', 'package.json'),
      JSON.stringify({
        name,
        version,
        dependencies,
        publishConfig: { access: 'public' },
        repository: {
          type: 'git',
          url: repositoryUrl,
        },
      }),
    );
    writeFileSync(
      join(source, 'package', 'dist', 'index.js'),
      'export const version = 1;',
    );
    const tarball = `fixture-${index}.tgz`;
    execFileSync('tar', [
      '-czf',
      join(artifacts, tarball),
      '-C',
      source,
      'package',
    ]);
    const bytes = readFileSync(join(artifacts, tarball));
    return {
      name,
      version,
      tarball,
      bytes: bytes.length,
      sha256: sha256(bytes),
      dependencies,
    };
  });
  const candidate = {
    schemaVersion: 1,
    repository,
    publicSha: sha,
    version,
    packages: entries,
  };
  return { root, artifacts, candidate };
}
function identity(candidate) {
  const bytes = Buffer.from(JSON.stringify(candidate));
  return { sha, version, bytes, inventorySha256: sha256(bytes) };
}
test('frozen SHA/version/inventory/20 packages reject every altered binding', () => {
  const f = fixture();
  try {
    validateIdentity(f.candidate, identity(f.candidate));
    for (const override of [
      { sha: 'b'.repeat(40) },
      { version: '1.2.0' },
      { inventorySha256: '0'.repeat(64) },
    ])
      assert.throws(() =>
        validateIdentity(f.candidate, {
          ...identity(f.candidate),
          ...override,
        }),
      );
    for (const mutation of [
      (c) => c.packages.pop(),
      (c) => c.packages.push(c.packages[0]),
      (c) => (c.packages[0].tarball = '../escape.tgz'),
      (c) => (c.packages[0].version = '1.1.0'),
      (c) => (c.repository = 'other/repo'),
    ]) {
      const c = structuredClone(f.candidate);
      mutation(c);
      assert.throws(() => validateIdentity(c, identity(c)));
    }
    assert.equal(verifyTarballs(f.candidate, f.artifacts).length, 20);
    const path = join(f.artifacts, f.candidate.packages[0].tarball);
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(path, bytes);
    assert.throws(
      () => verifyTarballs(f.candidate, f.artifacts),
      /byte mismatch/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('readback is GET-only, requires all metadata and exact tarball bytes; provenance remains pending', async () => {
  const f = fixture();
  try {
    const verified = verifyTarballs(f.candidate, f.artifacts);
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url: String(url), method: options.method ?? 'GET' });
      const s = String(url);
      const p = verified.find(
        (p) =>
          s.endsWith('/' + encodeURIComponent(p.name)) || s.endsWith(p.tarball),
      );
      assert.ok(p);
      if (s.endsWith('.tgz'))
        return { ok: true, arrayBuffer: async () => readFileSync(p.path) };
      return {
        ok: true,
        json: async () => ({
          'dist-tags': { candidate: version },
          versions: {
            [version]: {
              ...p.manifest,
              dist: {
                tarball: `https://registry.npmjs.org/${p.tarball}`,
                attestations: {
                  url: 'https://registry.npmjs.org/attestations',
                  provenance: {
                    predicateType: 'https://slsa.dev/provenance/v1',
                  },
                },
              },
            },
          },
        }),
      };
    };
    const result = await readback(f.candidate, { fetchImpl });
    assert.equal(result.rows.length, 20);
    assert.equal(result.publicRegistryWrites, 0);
    assert.equal(
      result.provenanceVerification,
      'pending-signature-and-subject-validation',
    );
    assert.ok(requests.every((r) => r.method === 'GET'));
    assert.equal(promotionPlan(f.candidate).length, 20);
    await assert.rejects(
      readback(f.candidate, { fetchImpl: async () => ({ ok: false }) }),
      /reconcile/,
    );
    await assert.rejects(
      readback(f.candidate, { fetchImpl, tag: '1.2.0' }),
      /dist-tag/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('canonical audited export copies are exact and live operations fail closed', () => {
  for (const name of ['npm-publish-auth.mjs', 'npm-publish-payload-audit.mjs'])
    assert.deepEqual(
      Buffer.from(
        sha256(readFileSync(new URL(`./release/${name}`, import.meta.url))),
        'hex',
      ),
      Buffer.from(auditedHashes[name], 'hex'),
    );
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          new URL('./release/prepare.mjs', import.meta.url).pathname,
          'candidate',
        ],
        { stdio: 'pipe' },
      ),
    /Activation forbidden/,
  );
  const workflow = readFileSync(
    new URL('../.github/workflows/npm-release.yml', import.meta.url),
    'utf8',
  );
  for (const required of [
    "github.repository == 'winhok/SceneWireJS'",
    'github.sha == inputs.expected_sha',
    'environment: npm-production',
    'id-token: write',
    'contents: read',
    "node-version: '24'",
    'npm@12.2.0',
    'options: [prepare, candidate, promote, recovery-promote]',
    'pnpm package:pack',
  ])
    assert.ok(workflow.includes(required), required);
  const printed = execFileSync(
    process.execPath,
    [new URL('./release/trust-bootstrap.mjs', import.meta.url).pathname],
    { encoding: 'utf8' },
  );
  assert.equal(
    printed.split('\n').filter((line) => line.startsWith('npm trust github '))
      .length,
    20,
  );
});

test('OIDC adapter binds audience/repo/SHA/workflow/environment and never falls back to tokens', async () => {
  const { exchangeToken, canonicalOidcSubmit, activationPolicy } =
    await import('./release/oidc.mjs');
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_SHA: sha,
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/npm-release.yml@refs/heads/main`,
    ACTIONS_ID_TOKEN_REQUEST_URL:
      'https://vstoken.actions.githubusercontent.com/token',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'MOCK_REQUEST_ONLY',
  };
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'npm:registry.npmjs.org',
    repository,
    repository_visibility: 'public',
    sha,
    sub: 'repo:winhok@56586247/SceneWireJS@1394415814:environment:npm-production',
    repository_owner_id: '56586247',
    repository_id: '1394415814',
    workflow_ref: env.GITHUB_WORKFLOW_REF,
    workflow_sha: sha,
  };
  const jwt = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      json: async () =>
        requests.length === 1
          ? { value: jwt }
          : { token: 'MOCK_EXCHANGE_ONLY' },
    };
  };
  assert.equal(
    await exchangeToken(packages[0], sha, { env, fetchImpl }),
    'MOCK_EXCHANGE_ONLY',
  );
  assert.ok(requests[0].url.includes('audience=npm%3Aregistry.npmjs.org'));
  assert.equal(requests[1].options.method, 'POST');
  assert.ok(requests[1].url.endsWith('@scenewirejs%2faudio'));
  await assert.rejects(
    exchangeToken(packages[0], sha, {
      env: { ...env, NODE_AUTH_TOKEN: 'fallback' },
      fetchImpl,
    }),
    /fallback/,
  );
  for (const invalid of [
    { sub: `repo:${repository}:environment:npm-production` },
    { sub: 'repo:winhok@1/SceneWireJS@1394415814:environment:npm-production' },
    { sub: 'repo:winhok@56586247/SceneWireJS@1:environment:npm-production' },
    { sub: 'repo:winhok@56586247/SceneWireJS@1394415814:environment:other' },
    { repository_owner_id: '1' },
    { repository_id: '1' },
  ]) {
    let exchanges = 0;
    const invalidJwt = `header.${Buffer.from(JSON.stringify({ ...claims, ...invalid })).toString('base64url')}.signature`;
    await assert.rejects(
      exchangeToken(packages[0], sha, {
        env,
        fetchImpl: async (_url, options) => {
          if (options.method === 'POST') exchanges += 1;
          return { ok: true, json: async () => ({ value: invalidJwt }) };
        },
      }),
      /OIDC claim binding mismatch/,
    );
    assert.equal(exchanges, 0);
  }
  assert.deepEqual(activationPolicy, { candidate: true, promote: true });
  const f = fixture();
  try {
    const artifact = verifyTarballs(f.candidate, f.artifacts)[0];
    let calls = 0;
    await canonicalOidcSubmit(
      '/unused/npm-cli.js',
      artifact,
      'MOCK_EXCHANGE_ONLY',
      {
        submit: async (_npmCli, tgz, options) => {
          calls += 1;
          assert.equal(tgz, artifact.path);
          assert.equal(options.provenance, true);
          assert.equal(options.defaultTag, 'candidate');
          assert.equal(options.fetchRetries, 0);
          assert.equal(
            options['//registry.npmjs.org/:_authToken'],
            'MOCK_EXCHANGE_ONLY',
          );
        },
      },
    );
    assert.equal(calls, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('actual generated payload gate rejects metadata leaks and attachment substitution before transport', async () => {
  const { auditSubmission } = await import('./release/oidc.mjs');
  const f = fixture();
  try {
    const artifact = verifyTarballs(f.candidate, f.artifacts)[0];
    const body = {
      versions: { [version]: { name: artifact.name, version } },
      'dist-tags': { candidate: version },
      _attachments: {
        'canonical.tgz': {
          data: readFileSync(artifact.path).toString('base64'),
        },
        'canonical.sigstore': { data: '{}' },
      },
    };
    auditSubmission(body, artifact, 'candidate');
    for (const mutate of [
      (b) => (b.versions[version]._where = '/tmp/leaked/path'),
      (b) =>
        (b._attachments['canonical.tgz'].data =
          Buffer.from('different').toString('base64')),
      (b) => delete b._attachments['canonical.sigstore'],
      (b) => (b['dist-tags'].latest = version),
    ]) {
      const changed = structuredClone(body);
      mutate(changed);
      assert.throws(() => auditSubmission(changed, artifact, 'candidate'));
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('candidate and promotion are independently implemented with zero real registry writes', async () => {
  const { candidateSubmission, stablePromotion } =
    await import('./release/release.mjs');
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_SHA: sha,
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/npm-release.yml@refs/heads/main`,
  };
  const f = fixture();
  try {
    const artifacts = verifyTarballs(f.candidate, f.artifacts);
    let submissions = 0;
    let promotions = 0;
    let qualifications = 0;
    const exchange = async (name) => {
      assert.ok(packages.includes(name));
      return 'MOCK_EXCHANGE_ONLY';
    };
    const reconcile = async (_candidate, { tag }) => ({ rows: [], tag });
    const result = await candidateSubmission(f.candidate, artifacts, {
      sha,
      env,
      fetchImpl: async () => ({ status: 404 }),
      exchange,
      submit: async () => {
        submissions += 1;
      },
      reconcile,
    });
    assert.equal(submissions, 20);
    assert.equal(result.tag, 'candidate');
    await assert.rejects(
      candidateSubmission(f.candidate, artifacts, {
        sha,
        env,
        fetchImpl: async () => ({ status: 200 }),
        exchange,
        submit: async () => {
          throw Error('must not submit');
        },
        reconcile,
      }),
      /absence unconfirmed/,
    );
    const stable = await stablePromotion(f.candidate, {
      sha,
      env,
      fetchImpl: async (_url, options) => {
        assert.equal(options.method, 'PUT');
        assert.equal(options.body, JSON.stringify(version));
        promotions += 1;
        return { ok: true };
      },
      exchange,
      qualify: async () => {
        qualifications += 1;
      },
      reconcile,
    });
    assert.equal(qualifications, 1);
    assert.equal(promotions, 20);
    assert.equal(stable.tag, 'latest');
    await assert.rejects(
      stablePromotion(f.candidate, { sha, env, exchange, reconcile }),
      /qualification required/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('guarded canonical path audits the actual library request before mocked transport', async () => {
  const { guardedSubmission } = await import('./release/oidc.mjs');
  const f = fixture();
  try {
    const artifact = verifyTarballs(f.candidate, f.artifacts)[0];
    const npmRoot = join(f.root, 'mock-npm');
    mkdirSync(join(npmRoot, 'bin'), { recursive: true });
    mkdirSync(join(npmRoot, 'node_modules', 'libnpmpublish', 'lib'), {
      recursive: true,
    });
    mkdirSync(join(npmRoot, 'node_modules', 'npm-registry-fetch'), {
      recursive: true,
    });
    const npmCli = join(npmRoot, 'bin', 'npm-cli.js');
    writeFileSync(npmCli, '');
    writeFileSync(
      join(npmRoot, 'node_modules', 'npm-registry-fetch', 'index.js'),
      "module.exports = (_uri, opts) => { if (!opts.body) throw Error('body missing'); return Promise.resolve({mockTransport:true}); };",
    );
    writeFileSync(
      join(npmRoot, 'node_modules', 'libnpmpublish', 'package.json'),
      JSON.stringify({ main: 'lib/index.js' }),
    );
    writeFileSync(
      join(npmRoot, 'node_modules', 'libnpmpublish', 'lib', 'index.js'),
      "exports.publish = require('./publish.js');",
    );
    const producer = `const fetch = require('npm-registry-fetch'); module.exports = async (manifest, bytes, options) => fetch(manifest.name, {...options, method:'PUT',body:{versions:{[manifest.version]:manifest},'dist-tags':{candidate:manifest.version},_attachments:{'canonical.tgz':{data:bytes.toString('base64')},'canonical.sigstore':{data:'{}'}}}});`;
    const path = join(
      npmRoot,
      'node_modules',
      'libnpmpublish',
      'lib',
      'publish.js',
    );
    writeFileSync(path, producer);
    assert.deepEqual(
      await guardedSubmission(npmCli, artifact, 'MOCK_EXCHANGE_ONLY'),
      { mockTransport: true },
    );
    writeFileSync(
      path,
      producer.replace(
        'versions:{[manifest.version]:manifest}',
        "versions:{[manifest.version]:{...manifest,_resolved:'file:/tmp/unsafe'}}",
      ),
    );
    await assert.rejects(
      guardedSubmission(npmCli, artifact, 'MOCK_EXCHANGE_ONLY'),
      /Unsafe generated/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('provenance qualification binds actual sha512, public commit, hosted builder and certificate identity', async () => {
  const { createHash } = await import('node:crypto');
  const { verifyProvenance } = await import('./release/qualify.mjs');
  const f = fixture();
  try {
    const artifacts = verifyTarballs(f.candidate, f.artifacts);
    const rows = artifacts.map((p) => ({
      name: p.name,
      provenance: {
        url: `https://registry.npmjs.org/attest/${encodeURIComponent(p.name)}`,
      },
    }));
    let verified = 0;
    const statements = artifacts.map((p) => ({
      predicateType: 'https://slsa.dev/provenance/v1',
      subject: [
        {
          name: `pkg:npm/${p.name.replace('@', '%40')}@${version}`,
          digest: {
            sha512: createHash('sha512')
              .update(readFileSync(p.path))
              .digest('hex'),
          },
        },
      ],
      predicate: {
        buildDefinition: {
          buildType:
            'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
          externalParameters: {
            workflow: {
              repository: `https://github.com/${repository}`,
              path: '.github/workflows/npm-release.yml',
              ref: 'refs/heads/main',
            },
          },
          resolvedDependencies: [
            {
              uri: `git+https://github.com/${repository}@refs/heads/main`,
              digest: { gitCommit: sha },
            },
          ],
        },
        runDetails: {
          builder: { id: 'https://github.com/actions/runner/github-hosted' },
        },
      },
    }));
    const fetchImpl = async (url) => {
      const index = artifacts.findIndex((p) =>
        String(url).endsWith(encodeURIComponent(p.name)),
      );
      return {
        ok: true,
        json: async () => ({
          attestations: [
            {
              predicateType: 'https://slsa.dev/provenance/v1',
              bundle: {
                dsseEnvelope: {
                  payload: Buffer.from(
                    JSON.stringify(statements[index]),
                  ).toString('base64'),
                },
              },
            },
          ],
        }),
      };
    };
    const verify = async (_bundle, options) => {
      verified += 1;
      assert.equal(
        options.certificateIssuer,
        'https://token.actions.githubusercontent.com',
      );
      assert.equal(
        options.certificateIdentityURI,
        `https://github.com/${repository}/.github/workflows/npm-release.yml@refs/heads/main`,
      );
    };
    assert.equal(
      await verifyProvenance(
        f.candidate,
        artifacts,
        { rows },
        '/unused/npm-cli.js',
        { fetchImpl, verify },
      ),
      'PASS',
    );
    assert.equal(verified, 20);
    await assert.rejects(
      verifyProvenance(
        f.candidate,
        artifacts,
        { rows: [] },
        '/unused/npm-cli.js',
        { fetchImpl, verify },
      ),
      /Complete provenance/,
    );
    statements[0].subject[0].digest.sha512 = '0'.repeat(128);
    await assert.rejects(
      verifyProvenance(f.candidate, artifacts, { rows }, '/unused/npm-cli.js', {
        fetchImpl,
        verify,
      }),
      /subject mismatch/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('registry-only consumer uses empty state, exact public versions and rejects local lockfile references', async () => {
  const { registryConsumer } = await import('./release/qualify.mjs');
  const candidate = { version };
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    assert.ok(
      !Object.keys(options.env).some((key) =>
        /^(?:npm_token|node_auth_token|npm_config_|actions_id_token)/i.test(
          key,
        ),
      ),
    );
    if (args[1] === 'install') {
      assert.equal(
        args.filter((p) => p.startsWith('@scenewirejs/')).length,
        20,
      );
      assert.ok(args.includes('--ignore-scripts'));
      assert.ok(args.includes('--registry=https://registry.npmjs.org/'));
      writeFileSync(
        join(options.cwd, 'package-lock.json'),
        JSON.stringify({
          packages: {
            '': {},
            ...Object.fromEntries(
              packages.map((name) => [
                `node_modules/${name}`,
                {
                  version,
                  integrity: 'sha512-mock',
                  resolved: `https://registry.npmjs.org/${name}/-/mock.tgz`,
                },
              ]),
            ),
          },
        }),
      );
      for (const name of packages) {
        mkdirSync(join(options.cwd, 'node_modules', name), { recursive: true });
        writeFileSync(
          join(options.cwd, 'node_modules', name, 'package.json'),
          JSON.stringify({ version, exports: { '.': './index.js' } }),
        );
      }
    }
    return '';
  };
  assert.equal(
    registryConsumer(candidate, '/unused/npm-cli.js', { run }),
    'PASS',
  );
  assert.equal(calls.length, 22);
  assert.deepEqual(calls.at(-1).args, ['engines', '--json']);
  assert.throws(
    () =>
      registryConsumer(candidate, '/unused/npm-cli.js', {
        run: (_command, _args, options) => {
          writeFileSync(
            join(options.cwd, 'package-lock.json'),
            JSON.stringify({
              packages: {
                'node_modules/unsafe': { resolved: 'file:../unsafe' },
              },
            }),
          );
        },
      }),
    /non-registry/,
  );
});

test('external dispatch inventory preserves frozen bytes without source-commit self-reference', async () => {
  const { materializeCandidate } =
    await import('./release/dispatch-candidate.mjs');
  const f = fixture();
  try {
    const input = JSON.stringify(f.candidate, null, 2) + '\n';
    const path = join(f.root, 'dispatch-inventory.json');
    const expected = {
      sha,
      version,
      inventorySha256: sha256(Buffer.from(input)),
    };
    materializeCandidate(input, path, expected);
    assert.equal(readFileSync(path, 'utf8'), input);
    assert.throws(() => materializeCandidate(input, path, expected), /EEXIST/);
    const mismatched = join(f.root, 'mismatched-inventory.json');
    assert.throws(
      () => materializeCandidate(input.trim(), mismatched, expected),
      /SHA mismatch/,
    );
    assert.throws(() => readFileSync(mismatched), /ENOENT/);
    const workflow = readFileSync(
      new URL('../.github/workflows/npm-release.yml', import.meta.url),
      'utf8',
    );
    assert.ok(!workflow.includes('release/candidate.json'));
    assert.equal(
      workflow.split('CANDIDATE_JSON: ${{ inputs.candidate_json }}').length - 1,
      5,
    );
    assert.equal(
      workflow.split('node scripts/release/dispatch-candidate.mjs').length - 1,
      5,
    );
    assert.equal(
      workflow.split('"$CANDIDATE_FILE" "$EXPECTED_SHA"').length - 1,
      8,
    );
    assert.ok(workflow.includes('github.sha == inputs.expected_sha'));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('frozen packages accept exact git+HTTPS identity and reject foreign or decorated URLs', () => {
  for (const url of [
    'git+https://github.com/winhok/SceneWireJS.git',
    'https://github.com/winhok/Other.git',
    'git+https://github.com/other/SceneWireJS.git',
    'http://github.com/winhok/SceneWireJS.git',
    'https://github.com/winhok/SceneWireJS.git?redirect=other',
    'https://github.com/winhok/SceneWireJS.git#other',
    'git+https://github.com/winhok/SceneWireJS.git/extra',
    'git+https://github.com/winhok/SceneWireJS.git.evil',
  ]) {
    const f = fixture(url);
    try {
      if (url === 'git+https://github.com/winhok/SceneWireJS.git')
        assert.equal(verifyTarballs(f.candidate, f.artifacts).length, 20);
      else
        assert.throws(
          () => verifyTarballs(f.candidate, f.artifacts),
          /Public repository provenance mismatch/,
        );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('all release operations consume the public packer output with reviewed activation and exact operation conditions', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/npm-release.yml', import.meta.url),
    'utf8',
  );
  const packer = readFileSync(
    new URL('./package-pack.mjs', import.meta.url),
    'utf8',
  );
  const root = /const artifactRoot = resolve\('([^']+)'\)/.exec(packer)?.[1];
  assert.equal(root, '.build/npm');
  const lines = workflow
    .split('\n')
    .filter((line) =>
      /node scripts\/release\/(?:prepare|release)\.mjs /.test(line),
    );
  assert.equal(lines.length, 3);
  for (const line of lines)
    assert.ok(line.includes(` ${root} "$NPM_CLI"`), line);
  assert.equal(workflow.match(/if: false/g)?.length ?? 0, 0);
  for (const operation of ['candidate', 'promote'])
    assert.ok(
      workflow.includes(
        "if: inputs.operation == '" +
          operation +
          "' && github.repository == 'winhok/SceneWireJS' && github.sha == inputs.expected_sha",
      ),
    );
});

const auditedHashes = {
  'npm-publish-auth.mjs':
    'bb8f0639454cd5387d829792d5efd2477e5c73e99bdddf59402a665a2ca1ced6',
  'npm-publish-payload-audit.mjs':
    '6e1e0b4081b8635961ffae4fae0352d81943d6b849138fe59f4449dd1a83e825',
};

test('each release job builds exports before checking and packing', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/npm-release.yml', import.meta.url),
    'utf8',
  );
  for (const job of ['prepare', 'candidate', 'promote']) {
    const block = workflow
      .split('  ' + job + ':\n')[1]
      ?.split(/\n  [a-z]+:\n/)[0];
    assert.ok(block, job);
    const install = block.indexOf('pnpm install --frozen-lockfile');
    const build = block.indexOf('pnpm build:cli');
    const check = block.indexOf('pnpm package:check');
    const pack = block.indexOf('pnpm package:pack');
    assert.ok(
      install >= 0 && build > install && check > build && pack > check,
      job,
    );
  }
});

test('recovery separates artifact and workflow identities, gates all writes and skips exact latest tags', async () => {
  const { recoveryPromote, releaseSourceSha } =
    await import('./release/recovery-promote.mjs');
  const workflowSha = 'b'.repeat(40);
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: workflowSha,
    GITHUB_WORKFLOW_SHA: workflowSha,
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REF: 'refs/heads/release/v1.2.0',
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/npm-release.yml@refs/heads/release/v1.2.0`,
  };
  const candidate = {
    repository,
    publicSha: releaseSourceSha,
    version: '1.2.0',
    packages: packages.map((name) => ({ name })),
  };
  const latest = new Map(
    packages.map((name, i) => [name, i < 3 ? '1.2.0' : '1.1.0']),
  );
  const exchanged = [],
    writes = [],
    gates = [];
  const options = {
    workflowSha,
    env,
    npmCli: '/unused/npm-cli.js',
    reconcile: async (c, { tag }) => {
      assert.equal(c.publicSha, releaseSourceSha);
      gates.push(tag);
      return { rows: [] };
    },
    verify: async (c) => {
      assert.equal(c.publicSha, releaseSourceSha);
      gates.push('provenance');
    },
    consumer: () => {
      gates.push('consumer');
      return 'PASS';
    },
    exchange: async (name, sha) => {
      assert.equal(sha, workflowSha);
      assert.ok(gates.includes('consumer'));
      exchanged.push(name);
      return 'MOCK_OIDC';
    },
    fetchImpl: async (url, options) => {
      if (options.method === 'GET') {
        const name = decodeURIComponent(new URL(url).pathname.slice(1));
        return {
          ok: true,
          json: async () => ({ 'dist-tags': { latest: latest.get(name) } }),
        };
      }
      assert.equal(options.method, 'PUT');
      assert.ok(url.endsWith('/dist-tags/latest'));
      assert.equal(options.body, '"1.2.0"');
      const name = decodeURIComponent(new URL(url).pathname.split('/')[3]);
      latest.set(name, '1.2.0');
      writes.push(name);
      return { ok: true };
    },
  };
  const dry = await recoveryPromote(candidate, [], options);
  assert.equal(dry.operation, 'verify');
  assert.equal(writes.length, 0);
  assert.equal(exchanged.length, 0);
  const promoted = await recoveryPromote(candidate, [], {
    ...options,
    write: true,
  });
  assert.equal(promoted.result, 'PASS');
  assert.equal(writes.length, 17);
  assert.equal(exchanged.length, 17);
  const repeated = await recoveryPromote(candidate, [], {
    ...options,
    write: true,
  });
  assert.equal(repeated.writes.length, 0);
  assert.equal(writes.length, 17);
  for (const invalid of [
    { publicSha: workflowSha },
    { version: '1.2.1' },
    { packages: candidate.packages.slice(1) },
  ])
    await assert.rejects(
      recoveryPromote({ ...candidate, ...invalid }, [], {
        ...options,
        write: true,
      }),
      /binding/,
    );
  await assert.rejects(
    recoveryPromote(candidate, [], {
      ...options,
      write: true,
      env: { ...env, GITHUB_REF: 'refs/heads/main' },
    }),
    /binding/,
  );
  for (const failure of [
    {
      verify: async () => {
        throw Error('provenance mismatch');
      },
    },
    { consumer: () => 'FAIL' },
    {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ 'dist-tags': { latest: '1.3.0' } }),
      }),
    },
    {
      fetchImpl: async () => {
        throw Error('network');
      },
    },
  ]) {
    await assert.rejects(
      recoveryPromote(candidate, [], { ...options, ...failure, write: true }),
    );
    assert.equal(writes.length, 17);
  }
});

test('recovery stops ambiguous PUT and safely resumes only after exact tag reconciliation', async () => {
  const { recoveryPromote, releaseSourceSha } =
    await import('./release/recovery-promote.mjs');
  const workflowSha = 'b'.repeat(40),
    candidate = {
      repository,
      publicSha: releaseSourceSha,
      version: '1.2.0',
      packages: packages.map((name) => ({ name })),
    };
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: workflowSha,
    GITHUB_WORKFLOW_SHA: workflowSha,
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REF: 'refs/heads/release/v1.2.0',
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/npm-release.yml@refs/heads/release/v1.2.0`,
  };
  const latest = new Map(packages.map((name) => [name, '1.1.0'])),
    writes = [];
  let fail = true;
  const options = {
    workflowSha,
    env,
    write: true,
    reconcile: async () => ({ rows: [] }),
    verify: async () => {},
    consumer: () => 'PASS',
    exchange: async () => 'MOCK_OIDC',
    fetchImpl: async (url, options) => {
      if (options.method === 'GET') {
        const name = decodeURIComponent(new URL(url).pathname.slice(1));
        return {
          ok: true,
          json: async () => ({ 'dist-tags': { latest: latest.get(name) } }),
        };
      }
      const name = decodeURIComponent(new URL(url).pathname.split('/')[3]);
      latest.set(name, '1.2.0');
      writes.push(name);
      if (fail) throw Error('disconnect');
      return { ok: true };
    },
  };
  await assert.rejects(
    recoveryPromote(candidate, [], options),
    /ambiguous latest mutation/,
  );
  assert.equal(writes.length, 1);
  fail = false;
  await recoveryPromote(candidate, [], options);
  assert.equal(writes.length, 20);
  assert.equal(new Set(writes).size, 20);
});

test('recovery read-only gate precedes protected environment and never invokes package submission', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/npm-release.yml', import.meta.url),
    'utf8',
  );
  const readonly = workflow
    .split('  recovery-verify:\n')[1]
    .split('  recovery-promote:\n')[0];
  const write = workflow.split('  recovery-promote:\n')[1];
  assert.ok(!readonly.includes('environment: npm-production'));
  assert.ok(
    write.includes('needs: recovery-verify') &&
      write.includes('environment: npm-production'),
  );
  assert.ok(
    readonly.includes('recovery-promote.mjs verify') &&
      write.includes('recovery-promote.mjs promote'),
  );
  for (const block of [readonly, write])
    assert.ok(
      block.includes('inputs.release_source_sha') &&
        block.includes('github.sha == inputs.expected_sha'),
    );
  const source = readFileSync(
    new URL('./release/recovery-promote.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(
    !/candidateSubmission|guardedSubmission|canonicalOidcSubmit|publishCanonical/.test(
      source,
    ),
  );
});
