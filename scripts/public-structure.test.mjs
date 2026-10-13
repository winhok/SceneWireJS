import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const snapshot = JSON.parse(
  readFileSync('scripts/public-source-snapshot.json'),
);
const controls = [
  'scripts/public-structure.test.mjs',
  'scripts/public-source-snapshot.json',
];
test('public v1.3 source matches the exact reviewed snapshot', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
  assert.deepEqual(files, [...Object.keys(snapshot.files), ...controls].sort());
  for (const [path, hash] of Object.entries(snapshot.files))
    assert.equal(
      createHash('sha256').update(readFileSync(path)).digest('hex'),
      hash.join(''),
      path,
    );
  for (const path of files)
    assert.ok(
      !/(?:^|\/)(?:\.env(?:\.|$)|node_modules|dist)(?:\/|$)/.test(path),
      path,
    );
  assert.equal(snapshot.version, '1.3.0');
});
