import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, isBuiltin } from 'node:module';

test('blind text scanning accepts short IDs and rejects substantive identity leaks', async () => {
  await mkdir('.build', { recursive: true });
  const directory = await mkdtemp(resolve('.build/review-test-'));
  try {
    await build({
      configFile: false,
      logLevel: 'error',
      plugins: [
        {
          name: 'resolve-source-runtime-dependencies',
          resolveId(id, importer) {
            if (isBuiltin(id)) return { id, external: true };
            if (/^[^./]/.test(id) && importer)
              return {
                id: createRequire(importer).resolve(id),
                external: true,
              };
          },
        },
      ],
      build: {
        outDir: directory,
        lib: {
          entry: resolve('apps/cli/src/videobench-review.ts'),
          formats: ['es'],
          fileName: () => 'review.mjs',
        },
      },
    });
    const { scanReviewLeakage } = await import(
      pathToFileURL(join(directory, 'review.mjs')).href
    );
    const candidates = [
      {
        id: 'a',
        projectId: 'id',
        binding: {
          projectSha256: '1'.repeat(64),
          sourceSha256: '2'.repeat(64),
        },
        renderDigest: '3'.repeat(64),
      },
    ];
    assert.doesNotThrow(() =>
      scanReviewLeakage('A readable image with a clear hierarchy', candidates),
    );
    assert.doesNotThrow(() =>
      scanReviewLeakage(
        JSON.stringify({
          context: 'Compare supplied images',
          rationale: 'A readable image',
        }),
        candidates,
      ),
    );
    for (const text of [
      'baseline image',
      'branch name',
      '1'.repeat(64),
      '/private/source',
      'C:\\private\\source',
    ])
      assert.throws(
        () => scanReviewLeakage(text, candidates),
        /identity leakage/,
      );
    const named = [
      { ...candidates[0], id: 'output-secret', projectId: 'project-secret' },
    ];
    for (const text of [
      'The output-secret reads clearly',
      '{"project-secret":"image"}',
      'The project-secret image',
    ])
      assert.throws(() => scanReviewLeakage(text, named), /identity leakage/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
