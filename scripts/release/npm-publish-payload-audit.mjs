import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

export function sameDependencyMap(left = {}, right = {}) {
  return (
    JSON.stringify(Object.entries(left).sort()) ===
    JSON.stringify(Object.entries(right).sort())
  );
}

export function auditMetadata(value, path = '$', findings = []) {
  if (typeof value === 'string') {
    const rules = [
      ['local-protocol', /(?:file|link|workspace):/i],
      [
        'absolute-filesystem-path',
        /(?:^|[\s"'=])\/(?:private|tmp|var|Users|home|opt|root|mnt|workspace|build|usr)\//i,
      ],
      ['windows-path', /(?:^|[\s"'=])[A-Za-z]:[\\/]/],
      [
        'private-checkout',
        /SceneWire-dev|scenewire-canonical|scenewire-final|\/Users\/|\/home\//i,
      ],
      [
        'credential',
        /npm_[A-Za-z0-9]{20,}|-----BEGIN .*PRIVATE KEY|(?:bearer|password|_authToken)\s*[:=]\s*\S+/i,
      ],
    ];
    for (const [rule, pattern] of rules)
      if (pattern.test(value)) findings.push({ path, rule });
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '_attachments') continue;
      auditMetadata(item, `${path}.${key}`, findings);
    }
  }
  return findings;
}

export async function publishCanonical(npmCli, tarball, options) {
  const require = createRequire(resolve(npmCli));
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOf', resolve(tarball), 'package/package.json'], {
      encoding: 'utf8',
    }),
  );
  const findings = auditMetadata(manifest);
  if (findings.length) throw new Error('Unsafe canonical manifest');
  return require('libnpmpublish').publish(
    manifest,
    readFileSync(tarball),
    options,
  );
}

export async function capturePublish(
  npmCli,
  tarball,
  mode = 'library',
  tag = 'v1-recovery-candidate',
) {
  const root = mkdtempSync(join(tmpdir(), 'publish-capture-'));
  let payload;
  const server = createServer(async (request, response) => {
    if (request.method === 'PUT') {
      if (request.headers.authorization !== 'Bearer LOCAL_CAPTURE_ONLY') {
        response.writeHead(401);
        response.end('{}');
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      payload = JSON.parse(Buffer.concat(chunks));
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"versions":{},"dist-tags":{}}');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const port = server.address().port;
    const registry = `http://127.0.0.1:${port}/`;
    writeFileSync(
      join(root, 'user.npmrc'),
      `//127.0.0.1:${port}/:_authToken=LOCAL_CAPTURE_ONLY\n`,
    );
    writeFileSync(join(root, 'global.npmrc'), '');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(?:npm_config_|npm_token|node_auth_token)/i.test(key),
      ),
    );
    const libraryCode = `import { publishCanonical } from ${JSON.stringify(import.meta.url)}; await publishCanonical(process.argv[1], process.argv[2], {registry: process.argv[3], [new URL(process.argv[3]).host.startsWith('127.0.0.1:') ? '//'+new URL(process.argv[3]).host+'/:_authToken' : 'INVALID_REGISTRY']:'LOCAL_CAPTURE_ONLY', defaultTag:${JSON.stringify(tag)}, access:'public', provenance:false, fetchRetries:0, fetchTimeout:15000,authType:'web',npmCommand:'publish'});`;
    const args =
      mode === 'library'
        ? [
            '--input-type=module',
            '-e',
            libraryCode,
            resolve(npmCli),
            resolve(tarball),
            registry,
          ]
        : [
            resolve(npmCli),
            'publish',
            resolve(tarball),
            '--registry',
            registry,
            '--userconfig',
            join(root, 'user.npmrc'),
            '--globalconfig',
            join(root, 'global.npmrc'),
            '--tag',
            tag,
            '--access',
            'public',
            '--provenance=false',
            '--ignore-scripts',
            '--fetch-retries=0',
            '--fetch-timeout=15000',
          ];
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: 'ignore',
    });
    const timeout = setTimeout(() => child.kill('SIGTERM'), 30000);
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    clearTimeout(timeout);
    if (exitCode !== 0 || !payload)
      throw new Error(
        'Local publish capture failed; no public registry write occurred',
      );
    const attachment = Object.values(payload._attachments ?? {});
    if (attachment.length !== 1)
      throw new Error('Expected one canonical tarball attachment');
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const byteIdentity =
      hash(Buffer.from(attachment[0].data, 'base64')) ===
      hash(readFileSync(tarball));
    const findings = auditMetadata(payload);
    return {
      result: byteIdentity && findings.length === 0 ? 'PASS' : 'FAIL',
      mode,
      byteIdentity,
      findings,
      generatedFields: Object.keys(Object.values(payload.versions)[0]).filter(
        (key) => key.startsWith('_'),
      ),
      publicRegistryWrites: 0,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const report = await capturePublish(
    process.argv[2],
    process.argv[3],
    process.argv.includes('--cli') ? 'cli' : 'library',
  );
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[4])
    writeFileSync(process.argv[4], JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.result === 'PASS' ? 0 : 1;
}
