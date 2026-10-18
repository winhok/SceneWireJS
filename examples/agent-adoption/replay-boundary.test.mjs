import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  cp,
  rm,
  symlink,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'scenewire-replay-boundary-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const checkout = join(temporary, 'checkout');
  const examples = join(checkout, 'examples', 'agent-adoption');
  await mkdir(join(examples, 'dom'), { recursive: true });
  const helper = join(examples, 'replay.mjs');
  await cp(new URL('./replay.mjs', import.meta.url), helper);
  await writeFile(join(examples, 'dom', 'package.json'), '{"private":true}\n');
  const bin = join(temporary, 'bin');
  await mkdir(bin);
  await writeFile(
    join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm'),
    process.platform === 'win32' ? '@exit /b 42\r\n' : '#!/bin/sh\nexit 42\n',
    { mode: 0o755 },
  );
  const invoke = (output) =>
    spawnSync(process.execPath, [helper, 'dom', output], {
      cwd: checkout,
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH },
      encoding: 'utf8',
      timeout: 10000,
    });
  return { temporary, checkout, invoke };
}

for (const name of ['inside', '..replay', '.']) {
  test(`rejects checkout destination ${name} before copying or installing`, async (t) => {
    const { checkout, invoke } = await fixture(t);
    const result = invoke(name);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside the checkout/);
    if (name !== '.') assert.equal(existsSync(join(checkout, name)), false);
  });
}

test('rejects an outside symlink parent that resolves into the checkout', async (t) => {
  const { temporary, checkout, invoke } = await fixture(t);
  const link = join(temporary, 'back-into-checkout');
  await symlink(
    checkout,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = invoke(join(link, 'new-parent', 'output'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the checkout/);
  assert.equal(existsSync(join(checkout, 'new-parent')), false);
});

test('refuses an existing outside destination without overwriting it', async (t) => {
  const { temporary, invoke } = await fixture(t);
  const output = join(temporary, 'existing');
  await mkdir(output);
  await writeFile(join(output, 'sentinel'), 'preserve');
  const result = invoke(output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Destination already exists/);
  assert.equal(await readFile(join(output, 'sentinel'), 'utf8'), 'preserve');
  assert.equal(existsSync(join(output, 'package.json')), false);
});

for (const name of ['outside', '..outside']) {
  test(`allows new outside destination ${name} and reaches the stub installer`, async (t) => {
    const { temporary, invoke } = await fixture(t);
    const output = join(temporary, name);
    const result = invoke(output);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /install failed/);
    const commands = JSON.parse(
      await readFile(join(output, 'checks', 'commands.json'), 'utf8'),
    );
    assert.equal(commands.length, 1);
    assert.equal(commands[0].exitCode, 42);
    assert.equal(
      await readFile(join(output, 'package.json'), 'utf8'),
      '{"private":true}\n',
    );
  });
}

test('allows a symlink parent that resolves outside the checkout', async (t) => {
  const { temporary, invoke } = await fixture(t);
  const outside = join(temporary, 'outside-parent');
  const link = join(temporary, 'outside-link');
  await mkdir(outside);
  await symlink(
    outside,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = invoke(join(link, 'output'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /install failed/);
  const commands = JSON.parse(
    await readFile(join(outside, 'output', 'checks', 'commands.json'), 'utf8'),
  );
  assert.equal(commands[0].exitCode, 42);
});
