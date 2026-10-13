import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  cp,
  mkdtemp,
} from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
// Runs only from an isolated tarball consumer. No repository runtime imports.
const require = createRequire(join(process.cwd(), 'package.json'));
const load = async (name) => {
  const path = require.resolve(name);
  assert.ok(
    realpathSync(path).startsWith(
      realpathSync(join(process.cwd(), 'node_modules')) + '/',
    ),
  );
  return import(path);
};
const ref = await load('@scenewirejs/reference-core');
const prod = await load('@scenewirejs/production-core');
const media = await load('@scenewirejs/media-inspect');
const renderer = await load('@scenewirejs/renderer-web/export');
const { encodeRgbPng, pngPixels, pngGrid } = media;
const { candidateIdentity, outputIdentity } = prod;
const results = [];
async function check(name, fn) {
  await fn();
  results.push({ name, status: 'PASS' });
}
const binding = {
  projectSha256: outputIdentity(Buffer.from('authored synthetic project')),
  sourceSha256: outputIdentity(Buffer.from('authored synthetic source')),
  assets: [],
};
const candidate = {
  version: 1,
  id: 'synthetic-output',
  projectId: 'synthetic-project',
  binding,
  productionCandidateDigest: candidateIdentity(binding),
  renderDigest: outputIdentity(Buffer.from('synthetic-render')),
  durationMs: 1000,
  rasterSensitive: false,
};
const plan = {
  caseId: 'synthetic-case',
  arm: 'baseline',
  representative: [
    { timeMs: 0, reason: 'shot-entry', derivation: 'start' },
    { timeMs: 900, reason: 'shot-exit', derivation: 'end' },
  ],
  strips: [{ startMs: 0, endMs: 900, cadenceMs: 100, purpose: 'continuity' }],
  diagnosticStrip: 0,
  transitions: [],
  diagnostics: ref.developmentDiagnosticConfig,
  limits: {
    maxFrames: 20,
    maxStripMs: 1000,
    timeoutMs: 10000,
    maxBytes: 1048576,
  },
};
const samples = (times) =>
  times.map((t) => encodeRgbPng(8, 8, Buffer.alloc(192, 40 + t / 100)));
const adapter = {
  pixels: pngPixels,
  grid: pngGrid,
  async resolve() {
    return {
      binding,
      renderDigest: candidate.renderDigest,
      durationMs: 1000,
      tool: { id: 'synthetic', version: '1' },
      config: { fixture: 'authored' },
    };
  },
  async capture(times) {
    return samples(times);
  },
  async evaluate(times) {
    return { frames: samples(times) };
  },
};
const root = await mkdtemp(join(process.cwd(), 'videobench-owned-'));
let material;
let reviewFixture;
await check(
  'installed API and PNG/Sheet/Strip/temporal materialization',
  async () => {
    assert.equal(ref.videoBenchReportV1Schema.shape.version.value, 1);
    assert.equal(ref.videoBenchReportV2Schema.shape.version.value, 2);
    material = await ref.materializeVideoBenchEvidence(
      candidate,
      plan,
      adapter,
      join(root, 'first'),
    );
    assert.equal(material.valid, true);
    const files = await readdir(join(root, 'first'));
    for (const p of ['frames', 'sheets', 'strips', 'manifest.json'])
      assert.ok(files.includes(p));
  },
);
const expected = {
  candidate,
  plan,
  caseId: plan.caseId,
  arm: plan.arm,
  semanticDigest: material.bundle.semanticDigest,
};
await check('strict evidence recheck', async () =>
  assert.equal(
    (
      await ref.validateMaterializedEvidence(
        join(root, 'first'),
        expected,
        adapter,
      )
    ).valid,
    true,
  ),
);
await check(
  'idempotent semantic bytes on fresh retry and no overwrite',
  async () => {
    const b = await ref.materializeVideoBenchEvidence(
      candidate,
      plan,
      adapter,
      join(root, 'second'),
    );
    assert.equal(b.bundle.semanticDigest, material.bundle.semanticDigest);
    await assert.rejects(
      () =>
        ref.materializeVideoBenchEvidence(
          candidate,
          plan,
          adapter,
          join(root, 'first'),
        ),
      /already exists/,
    );
  },
);
await check('stale source, output and environment rejected', async () => {
  for (const patch of [
    { binding: { ...binding, sourceSha256: 'a'.repeat(64) } },
    { renderDigest: 'b'.repeat(64) },
    { environment: { forged: true } },
  ]) {
    await assert.rejects(
      () =>
        ref.materializeVideoBenchEvidence(
          candidate,
          plan,
          {
            ...adapter,
            async resolve() {
              return { ...(await adapter.resolve()), ...patch };
            },
          },
          join(
            root,
            'identity-' + results.length + '-' + Object.keys(patch)[0],
          ),
        ),
      /identity/,
    );
  }
});
await check('timeout cancellation and retry after failure', async () => {
  await assert.rejects(
    () =>
      ref.materializeVideoBenchEvidence(
        candidate,
        { ...plan, limits: { ...plan.limits, timeoutMs: 20 } },
        {
          ...adapter,
          resolve() {
            return new Promise(() => {});
          },
        },
        join(root, 'retry'),
      ),
    /timeout/,
  );
  assert.equal(
    (
      await ref.materializeVideoBenchEvidence(
        candidate,
        plan,
        adapter,
        join(root, 'retry'),
      )
    ).valid,
    true,
  );
});
await check('frame and byte limits', async () => {
  await assert.rejects(
    () =>
      ref.materializeVideoBenchEvidence(
        candidate,
        { ...plan, limits: { ...plan.limits, maxFrames: 2 } },
        adapter,
        join(root, 'limited'),
      ),
    /limit/,
  );
  await assert.rejects(
    () =>
      ref.materializeVideoBenchEvidence(
        candidate,
        { ...plan, limits: { ...plan.limits, maxBytes: 1 } },
        adapter,
        join(root, 'byte-limited'),
      ),
    /byte|limit/i,
  );
});
await check('malformed, tampered and missing evidence rejected', async () => {
  await cp(join(root, 'first'), join(root, 'tampered'), { recursive: true });
  await writeFile(join(root, 'tampered', 'manifest.json'), '{}');
  assert.equal(
    (
      await ref.validateMaterializedEvidence(
        join(root, 'tampered'),
        expected,
        adapter,
      )
    ).valid,
    false,
  );
  assert.equal(
    (
      await ref.validateMaterializedEvidence(
        join(root, 'absent'),
        expected,
        adapter,
      )
    ).valid,
    false,
  );
  await cp(join(root, 'first'), join(root, 'pixels-tampered'), {
    recursive: true,
  });
  const names = await readdir(join(root, 'pixels-tampered', 'frames'));
  await writeFile(
    join(root, 'pixels-tampered', 'frames', names[0]),
    encodeRgbPng(8, 8, Buffer.alloc(192, 200)),
  );
  assert.equal(
    (
      await ref.validateMaterializedEvidence(
        join(root, 'pixels-tampered'),
        expected,
        adapter,
      )
    ).valid,
    false,
  );
});
await check(
  'opaque A/B schema and conservative verdict vocabulary',
  async () => {
    for (const verdict of ['inconclusive', 'not-applicable', 'equivalent'])
      assert.equal(ref.reviewVerdictSchema.parse(verdict), verdict);
    assert.equal(
      ref.blindIdentityMappingSchema.safeParse({
        version: 1,
        packId: 'pack',
        caseId: 'case',
        reviewReplicateId: 'replicate',
        aliases: [
          { aliasId: 'A/frame-00', sourceEvidenceId: 'one' },
          { aliasId: 'B/frame-00', sourceEvidenceId: 'two' },
        ],
        A: 'candidate',
        B: 'candidate',
        randomizationReceiptDigest: 'a'.repeat(64),
      }).success,
      false,
    );
    assert.equal(
      ref.benchmarkSuiteSchema.shape.reviewProtocol.shape.aggregation.safeParse(
        'majority',
      ).success,
      false,
    );
  },
);
await check(
  'blinded receipts, unanimous aggregation, disagreement and nonapplicability',
  async () => {
    const secondCandidate = { ...candidate, id: 'synthetic-second' };
    const second = await ref.materializeVideoBenchEvidence(
      secondCandidate,
      { ...plan, arm: 'candidate' },
      adapter,
      join(root, 'comparison'),
    );
    const candidates = [candidate, secondCandidate],
      evidence = [
        ...material.bundle.evidence,
        ...second.bundle.evidence,
      ].filter((e) => e.kind === 'representative-frames');
    const profile = {
      version: 1,
      id: 'owned-profile',
      grammar: 'owned',
      dimensionVocabularyVersion: 1,
      technicalGates: [],
      dimensions: [
        {
          id: 'hierarchy',
          applicable: true,
          interpretation: 'Synthetic comparison only',
          requiredEvidence: ['representative-frames'],
          measurements: [],
        },
      ],
    };
    const bind = ref.videoBenchBinding,
      digest = ref.videoBenchDigest;
    const c = {
      version: 1,
      id: plan.caseId,
      purpose: 'Exercise bounded aggregation',
      profile: bind('profile', profile),
      inputs: [],
      baseline: bind('candidate', candidate),
      candidate: bind('candidate', secondCandidate),
      requiredDimensions: ['hierarchy'],
      evidencePlan: [
        { dimensionId: 'hierarchy', kinds: ['representative-frames'] },
      ],
      split: 'development',
      readIntents: [],
      controls: [],
    };
    const hash = outputIdentity(Buffer.from('synthetic-protocol'));
    const selected = (arm) =>
      evidence.filter(
        (e) => e.arm === arm && e.kind === 'representative-frames',
      );
    const packs = [0, 1].map((i) => ({
      version: 1,
      id: 'opaque-pack-' + i,
      caseId: c.id,
      reviewReplicateId: 'opaque-round',
      context: 'Compare supplied images',
      reviewTemplateDigest: hash,
      evidenceA: ['A/frame-00'],
      evidenceB: ['B/frame-00'],
      rubric: [
        {
          dimensionId: 'hierarchy',
          instructions: 'Describe hierarchy in images',
        },
      ],
    }));
    const mappings = packs.map((p) => ({
      version: 1,
      packId: p.id,
      caseId: c.id,
      reviewReplicateId: p.reviewReplicateId,
      aliases: [
        { aliasId: 'A/frame-00', sourceEvidenceId: selected('baseline')[0].id },
        {
          aliasId: 'B/frame-00',
          sourceEvidenceId: selected('candidate')[0].id,
        },
      ],
      A: 'baseline',
      B: 'candidate',
      randomizationReceiptDigest: hash,
    }));
    const assignments = packs.map((p, i) => ({
      reviewerId: 'synthetic-reviewer-' + i,
      packId: p.id,
      packDigest: digest('review-pack', p),
      mappingDigest: digest('blind-mapping', mappings[i]),
      inputBundleDigest: ref.blindInputBundleDigest(p, evidence, mappings[i]),
      reviewerClass: 'human',
      identityClass: 'synthetic-class-' + i,
    }));
    const suite = {
      version: 1,
      id: 'synthetic-suite',
      cases: [bind('case', c)],
      profiles: [c.profile],
      dimensionRegistry: ['hierarchy'],
      rubricDigest: hash,
      configDigest: hash,
      corpusDigest: hash,
      evaluatorDigest: hash,
      replicatePolicy: {
        count: 1,
        weight: 'equal',
        selection: 'all-scheduled',
        unit: 'review',
      },
      reviewProtocol: {
        version: 1,
        aggregation: 'unanimous-v1',
        positionPolicy: 'frozen-randomized',
        creativeReviewersPerReplicate: 2,
        workspacePolicy: 'empty',
        reviewTemplateDigest: hash,
      },
      evidenceBundles: [
        {
          caseId: c.id,
          arms: ['baseline', 'candidate'].map((arm) => ({
            arm,
            candidate: c[arm],
            evidence: evidence
              .filter((e) => e.arm === arm)
              .map((e) => ({ id: e.id, digest: digest('evidence', e) })),
          })),
        },
      ],
      reviewEvidencePlan: [
        {
          caseId: c.id,
          arms: ['baseline', 'candidate'].map((arm) => ({
            arm,
            evidenceIds: selected(arm).map((e) => e.id),
          })),
        },
      ],
      schedule: [
        {
          caseId: c.id,
          reviewReplicateId: 'opaque-round',
          reviews: assignments,
        },
      ],
    };
    const reviews = assignments.map((a, i) => ({
      version: 1,
      id: 'synthetic-verdict-' + i,
      caseId: c.id,
      reviewReplicateId: 'opaque-round',
      reviewerId: a.reviewerId,
      identityClass: a.identityClass,
      packId: a.packId,
      packDigest: a.packDigest,
      reviewerType: 'human',
      receipt: {
        workspacePolicy: 'empty',
        inputBundleDigest: a.inputBundleDigest,
        reviewTemplateDigest: hash,
        provenance: 'Synthetic receipt, no real reviewer authentication',
        receiptDigest: hash,
      },
      dimensions: [
        {
          dimensionId: 'hierarchy',
          verdict: 'B',
          evidenceIds: ['A/frame-00', 'B/frame-00'],
          rationale: 'The right image reads clearly',
        },
      ],
    }));
    const context = {
      expectedSuiteDigest: digest('suite', suite),
      suite,
      candidates,
      profiles: [profile],
      cases: [c],
      evidence,
      reviews,
      packs,
      mappings,
      holdoutUses: [],
      expectedHoldoutLedgerDigest: ref.holdoutLedgerDigest([]),
    };
    const result = (ctx) =>
      ref
        .aggregateVideoBenchReport('synthetic-report', 'synthetic-claim', ctx)
        .sections.find((s) => s.split === 'development').cases[0].dimensions[0]
        .result;
    assert.equal(result(context), 'improved');
    const disagree = structuredClone(context);
    disagree.reviews[1].dimensions[0].verdict = 'A';
    assert.equal(result(disagree), 'inconclusive');
    const inconclusive = structuredClone(context);
    for (const r of inconclusive.reviews.filter(
      (r) => r.reviewerType === 'human',
    ))
      r.dimensions[0].verdict = 'inconclusive';
    assert.equal(result(inconclusive), 'inconclusive');
    const forged = structuredClone(context);
    forged.reviews[0].receipt.inputBundleDigest = '0'.repeat(64);
    assert.throws(() => result(forged), /receipt/i);
    const missing = structuredClone(context);
    missing.evidence = [];
    assert.throws(() => result(missing));
    const na = structuredClone(context);
    na.profiles[0].dimensions[0].applicable = false;
    na.cases[0].profile = bind('profile', na.profiles[0]);
    na.suite.profiles = [na.cases[0].profile];
    na.suite.cases = [bind('case', na.cases[0])];
    na.expectedSuiteDigest = digest('suite', na.suite);
    for (const r of na.reviews.filter((r) => r.reviewerType === 'human'))
      r.dimensions[0].verdict = 'not-applicable';
    assert.equal(result(na), 'not-applicable');
    reviewFixture = { c, suite, profile, candidates };
  },
);
const cli = join(
  process.cwd(),
  'node_modules/@scenewirejs/cli/dist/scenewire.js',
);
const command = (args) =>
  JSON.parse(
    execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, NODE_PATH: '' },
    }),
  );
await check(
  'indexed PNG batches preserve exact frames, order and resource bounds',
  async () => {
    const video = join(root, 'indexed.mp4');
    await media.run(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=64x48:rate=30',
        '-frames:v',
        '3000',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-y',
        video,
      ],
      { timeoutMs: 60000 },
    );
    const indices = [2999, 0, 1471];
    const frames = await media.frameBytesBatch(video, indices, {
      nativeSize: true,
      timeoutMs: 30000,
    });
    for (const [i, frameIndex] of indices.entries()) {
      const single = await media.frameBytes(
        video,
        (frameIndex * 1000) / 30,
        'accurate',
        { frameIndex, nativeSize: true, timeoutMs: 30000 },
      );
      assert.deepEqual(pngPixels(frames[i]), pngPixels(single));
    }
    await assert.rejects(
      media.frameBytesBatch(video, [0, 0]),
      /Unique frame indices/,
    );
    await assert.rejects(
      media.frameBytesBatch(video, [-1]),
      /Unique frame indices/,
    );
    await assert.rejects(
      media.frameBytesBatch(video, [3000]),
      /Missing decoded frame/,
    );
    const sparse = Array.from({ length: 120 }, (_, i) => i * 25);
    assert.equal(
      (await media.frameBytesBatch(video, sparse, { nativeSize: true })).length,
      120,
    );
    await assert.rejects(
      media.frameBytesBatch(video, [0, 2999], { maxBytes: 16 }),
      /limit exceeded/,
    );
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      media.frameBytesBatch(video, [0], { signal: cancelled.signal }),
      /cancelled/,
    );
  },
);
await check(
  'synthetic formal pack/import/report reject absent authority before evidence exposure',
  async () => {
    const fixture = join(root, 'formal-negative');
    await mkdir(fixture);
    const { c, profile, candidates } = reviewFixture;
    const formalCase = { ...c, split: 'holdout' };
    const suite = structuredClone(reviewFixture.suite);
    const template = {
      context: 'Synthetic authority rejection fixture only',
      rubric: [
        { dimensionId: 'hierarchy', instructions: 'Compare supplied images' },
      ],
    };
    suite.cases = [ref.videoBenchBinding('case', formalCase)];
    suite.reviewProtocol.reviewTemplateDigest = prod.canonicalDigest(
      'videobench/review-template-v1',
      template,
    );
    const suiteDigest = ref.videoBenchDigest('suite', suite);
    const valid = ref.validateBenchmarkSuite(suite, {
      expectedSuiteDigest: suiteDigest,
      candidates,
      cases: [formalCase],
      profiles: [profile],
    });
    assert.equal(valid.valid, true, valid.errors.join('; '));
    const seed = 'owned-synthetic-authority-test';
    const A =
      parseInt(
        prod
          .canonicalDigest('videobench/position-seed-v1', {
            seed,
            caseId: c.id,
          })
          .slice(0, 2),
        16,
      ) % 2
        ? 'candidate'
        : 'baseline';
    const positions = {
      version: 1,
      seed,
      balanced: true,
      entries: [
        {
          caseId: c.id,
          reviewReplicateId: 'opaque-round',
          A,
          receiptDigest: prod.canonicalDigest(
            'videobench/position-receipt-v1',
            {
              seed,
              balanced: true,
              caseId: c.id,
              reviewReplicateId: 'opaque-round',
              index: 0,
              A,
            },
          ),
        },
      ],
    };
    // These evidence roots and the ledger deliberately do not exist. The precise
    // authority error must precede any evidence read or output/ledger creation.
    const bundles = ['baseline', 'candidate'].map((arm) => ({
      root: 'unread-evidence-' + arm,
      caseId: c.id,
      arm,
      plan: { ...plan, arm },
      evidenceDigest: 'a'.repeat(64),
    }));
    const catalog = { version: 1, candidates };
    const seals = bundles.map(({ caseId, arm, evidenceDigest }) => ({
      caseId,
      arm,
      evidenceDigest,
    }));
    await writeFile(
      join(fixture, 'request.json'),
      JSON.stringify({
        suite,
        cases: [formalCase],
        profiles: [profile],
        template,
        positions,
        bundles,
      }),
    );
    await writeFile(join(fixture, 'catalog.json'), JSON.stringify(catalog));
    await writeFile(join(fixture, 'seals.json'), JSON.stringify(seals));
    const initialFiles = await readdir(fixture);
    for (const name of ['review-pack', 'review-import', 'report']) {
      assert.throws(
        () =>
          command([
            'videobench',
            name,
            join(fixture, 'request.json'),
            '--catalog',
            join(fixture, 'catalog.json'),
            '--catalog-digest',
            prod.canonicalDigest('videobench/candidate-catalog-v1', catalog),
            '--suite-digest',
            suiteDigest,
            '--evidence-seals',
            join(fixture, 'seals.json'),
            '--ledger',
            join(fixture, 'ledger'),
            '--ledger-digest',
            ref.holdoutLedgerDigest([]),
            ...(name === 'review-import'
              ? []
              : ['--output', join(fixture, 'output')]),
            '--json',
          ]),
        (error) => {
          assert.equal(error.status, 1);
          const diagnostic = JSON.parse(error.stderr.toString());
          assert.match(
            diagnostic.issues[0].message,
            /Formal holdout review requires independently approved Phase 4 freeze\/consumption authority/,
          );
          return true;
        },
      );
      assert.deepEqual(await readdir(fixture), initialFiles);
    }
    const ledger = join(fixture, 'synthetic-ledger');
    const initialized = command([
      'videobench',
      'holdout-init',
      ledger,
      '--json',
    ]);
    const statusArgs = [
      'videobench',
      'holdout-status',
      ledger,
      '--ledger-digest',
      initialized.digest,
      '--json',
    ];
    const before = command(statusArgs);
    await writeFile(
      join(fixture, 'consume.json'),
      JSON.stringify({
        case: formalCase,
        candidates,
        developmentContentDigests: [],
        suiteDigest,
        evaluatorDigest: suite.evaluatorDigest,
        claimId: 'synthetic-claim',
        consumptionId: 'synthetic-consumption',
      }),
    );
    assert.throws(
      () =>
        command([
          'videobench',
          'holdout-consume',
          join(fixture, 'consume.json'),
          '--ledger',
          ledger,
          '--ledger-digest',
          initialized.digest,
          '--json',
        ]),
      (error) => {
        assert.equal(error.status, 1);
        const diagnostic = JSON.parse(error.stderr.toString());
        assert.match(diagnostic.issues[0].message, /qualification-freeze/);
        return true;
      },
    );
    assert.deepEqual(command(statusArgs), before);
    assert.equal(before.consumed, 0);
  },
);
await check(
  'installed CLI bounded help and malformed review/qualification/path controls',
  async () => {
    const help = command(['videobench', '--help']);
    assert.ok(help.commands.includes('qualification-freeze'));
    assert.match(help.scope, /not a qualified creative judge/);
    for (const name of ['review-import', 'qualification-freeze']) {
      await writeFile(join(root, 'bad.json'), '{}');
      assert.throws(() =>
        command(['videobench', name, join(root, 'bad.json'), '--json']),
      );
    }
    await writeFile(
      join(root, 'bad-path.json'),
      JSON.stringify({
        id: 'bad',
        projectId: 'bad',
        project: '../private.json',
        renderOutput: 'out.mp4',
      }),
    );
    assert.throws(() =>
      command([
        'videobench',
        'identify',
        join(root, 'bad-path.json'),
        '--json',
      ]),
    );
  },
);
await check(
  'real installed renderer and CLI capture with frozen identities',
  async () => {
    const fixture = join(root, 'render');
    await mkdir(fixture);
    command(['scaffold', 'web-dom', fixture + '/composition']);
    const project = {
      id: 'public-owned',
      version: 9,
      seed: 1,
      metadata: {
        title: 'Public synthetic fixture',
        createdAt: '2026-10-13T00:00:00Z',
        updatedAt: '2026-10-13T00:00:00Z',
      },
      canvas: { width: 160, height: 90, background: '#101827' },
      fps: 30,
      theme: {
        name: 'owned',
        fontFamily: 'sans-serif',
        foreground: '#ffffff',
        accent: '#53d5b0',
      },
      assets: [
        {
          id: 'composition',
          type: 'composition',
          rendererId: 'web',
          src: 'composition/composition.json',
        },
      ],
      scenes: [
        { id: 'scene', name: 'Owned', startFrame: 0, durationFrames: 30 },
      ],
      tracks: [
        {
          id: 'track',
          name: 'Owned',
          type: 'visual',
          clips: [
            {
              id: 'clip',
              component: 'ForeignComposition',
              startFrame: 0,
              durationFrames: 30,
              transform: {},
              props: { assetId: 'composition', placement: 'replace-scene' },
            },
          ],
        },
      ],
      markers: [],
    };
    await writeFile(join(fixture, 'project.json'), JSON.stringify(project));
    await renderer.renderVideo({
      project,
      projectRoot: fixture,
      workspaceRoot: process.cwd(),
      profile: 'deterministic-export',
      output: join(fixture, 'render.mp4'),
      workers: 1,
    });
    const identify = {
      id: 'public-real',
      projectId: project.id,
      project: 'project.json',
      renderOutput: 'render.mp4',
    };
    await writeFile(join(fixture, 'identify.json'), JSON.stringify(identify));
    const actual = command([
      'videobench',
      'identify',
      join(fixture, 'identify.json'),
      '--json',
    ]);
    const capture = {
      candidate: actual,
      plan: {
        ...plan,
        caseId: 'public-real-case',
        limits: { ...plan.limits, timeoutMs: 180000 },
        representative: [
          { timeMs: 0, reason: 'shot-entry', derivation: 'start' },
          { timeMs: 900, reason: 'shot-exit', derivation: 'end' },
        ],
      },
      project: 'project.json',
      renderOutput: 'render.mp4',
    };
    await writeFile(join(fixture, 'capture.json'), JSON.stringify(capture));
    const result = command([
      'videobench',
      'capture',
      join(fixture, 'capture.json'),
      '--output',
      join(fixture, 'evidence'),
      '--json',
    ]);
    assert.equal(result.valid, true);
    const bundle = JSON.parse(
      await readFile(join(fixture, 'evidence', 'manifest.json'), 'utf8'),
    );
    assert.equal(
      bundle.candidate.productionCandidateDigest,
      actual.productionCandidateDigest,
    );
    assert.equal(bundle.candidate.renderDigest, actual.renderDigest);
  },
);
await writeFile(
  'videobench-installed-results.json',
  JSON.stringify(
    {
      status: 'PASS',
      source: 'isolated canonical tarball installation',
      creativeQualification: 'NO_GO',
      formalHoldout: 'NOT_CONSUMED',
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(results));
