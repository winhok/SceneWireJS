import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { packages, repository } from './inventory.mjs';

export function bindProvenance(statement, candidate, artifact) {
  if (
    statement.predicateType !== 'https://slsa.dev/provenance/v1' ||
    statement.subject?.length !== 1 ||
    statement.subject[0].name !==
      `pkg:npm/${artifact.name.replace('@', '%40')}@${candidate.version}` ||
    statement.subject[0].digest?.sha512 !==
      createHash('sha512').update(readFileSync(artifact.path)).digest('hex')
  )
    throw Error('Provenance subject mismatch');
  const definition = statement.predicate?.buildDefinition;
  const workflow = definition?.externalParameters?.workflow;
  if (
    workflow?.repository !== `https://github.com/${repository}` ||
    workflow.path !== '.github/workflows/npm-release.yml' ||
    definition.buildType !==
      'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1' ||
    statement.predicate.runDetails?.builder?.id !==
      'https://github.com/actions/runner/github-hosted' ||
    !definition.resolvedDependencies?.some(
      (d) =>
        d.digest?.gitCommit === candidate.publicSha &&
        d.uri.startsWith(`git+https://github.com/${repository}@`),
    )
  )
    throw Error('Provenance source/workflow mismatch');
  return `https://github.com/${repository}/${workflow.path}@${workflow.ref}`;
}
export async function verifyProvenance(
  candidate,
  artifacts,
  report,
  npmCli,
  { fetchImpl = fetch, verify = createRequire(npmCli)('sigstore').verify } = {},
) {
  if (
    JSON.stringify(report.rows.map((p) => p.name).sort()) !==
    JSON.stringify([...packages].sort())
  )
    throw Error('Complete provenance inventory required');
  for (const row of report.rows) {
    const artifact = artifacts.find((p) => p.name === row.name);
    const url = new URL(row.provenance.url);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org')
      throw Error('Unsafe provenance origin');
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!response.ok) throw Error('Provenance download failed');
    const { attestations } = await response.json();
    const provenance = attestations?.find(
      (p) => p.predicateType === 'https://slsa.dev/provenance/v1',
    );
    if (!provenance) throw Error('Missing SLSA provenance');
    const statement = JSON.parse(
      Buffer.from(provenance.bundle.dsseEnvelope.payload, 'base64').toString(),
    );
    const identity = bindProvenance(statement, candidate, artifact);
    await verify(provenance.bundle, {
      certificateIssuer: 'https://token.actions.githubusercontent.com',
      certificateIdentityURI: identity,
    });
  }
  return 'PASS';
}
export function registryConsumer(
  candidate,
  npmCli,
  { run = execFileSync } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'registry-consumer-'));
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }),
    );
    writeFileSync(join(root, 'user.npmrc'), '');
    writeFileSync(join(root, 'global.npmrc'), '');
    mkdirSync(join(root, 'cache'));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/^(?:npm_config_|npm_token|node_auth_token|npm_id_token|actions_id_token)/i.test(
            key,
          ),
      ),
    );
    const options = {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 300000,
      stdio: 'pipe',
    };
    run(
      process.execPath,
      [
        npmCli,
        'install',
        ...packages.map((name) => `${name}@${candidate.version}`),
        '--registry=https://registry.npmjs.org/',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--fetch-retries=0',
        '--userconfig',
        join(root, 'user.npmrc'),
        '--globalconfig',
        join(root, 'global.npmrc'),
        '--cache',
        join(root, 'cache'),
      ],
      options,
    );
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
    for (const [path, p] of Object.entries(lock.packages)) {
      if (
        path &&
        (p.link ||
          !p.integrity ||
          !p.resolved?.startsWith('https://registry.npmjs.org/'))
      )
        throw Error('Consumer contains non-registry dependency');
    }
    for (const name of packages) {
      const manifest = JSON.parse(
        readFileSync(join(root, 'node_modules', name, 'package.json')),
      );
      if (manifest.version !== candidate.version)
        throw Error('Consumer package version mismatch');
      if (manifest.exports?.['.'])
        run(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `await import(${JSON.stringify(name)})`,
          ],
          options,
        );
    }
    run(
      join(root, 'node_modules', '.bin', 'scenewire'),
      ['--version'],
      options,
    );
    return 'PASS';
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
