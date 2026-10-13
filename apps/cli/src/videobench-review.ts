import {
  verifyQualificationReportInputs,
  createQualificationFreezeFromInputs,
} from './videobench-qualification.js';
import { z } from 'zod';
import {
  realpath,
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  lstat,
  chmod,
  readdir,
  open,
} from 'node:fs/promises';
import {
  resolve,
  join,
  dirname,
  basename,
  relative,
  isAbsolute,
  sep,
} from 'node:path';
import {
  canonicalDigest,
  canonicalJson,
  outputIdentity,
  relativePathSchema,
} from '@scenewirejs/production-core';
import { pngPixels, pngGrid } from '@scenewirejs/media-inspect';
import {
  benchmarkCandidateSchema,
  benchmarkCaseSchema,
  benchmarkSuiteSchema,
  evaluationProfileSchema,
  validateBenchmarkSuite,
  validateVideoBenchEvidence,
  validateMaterializedEvidence,
  videoBenchDigest,
  blindInputBundleDigest,
  blindReviewPackSchema,
  blindIdentityMappingSchema,
  creativeReviewRecordSchema,
  aggregateVideoBenchReport,
  holdoutUseSchema,
  holdoutLedgerDigest,
  benchmarkCaseContentDigest,
  videoBenchBinding,
  type BenchmarkSuite,
  type BlindReviewPack,
  type BlindIdentityMapping,
  type CreativeReviewRecord,
  type MaterializedEvidenceBundle,
  type EvidenceCapturePlan,
  type HoldoutUse,
} from '@scenewirejs/reference-core';
async function retainedEvidencePath(root: string, path: string) {
  relativePathSchema.parse(path);
  await noSymlinkAncestors(root);
  if ((await lstat(root)).isSymbolicLink())
    throw Error('Symlink root rejected');
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink())
      throw Error('Symlink artifact rejected');
  }
  if (!(await lstat(cursor)).isFile()) throw Error('Regular artifact required');
  return cursor;
}

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/);
const templateSchema = z
  .object({
    context: z.string().min(1).max(10000),
    rubric: blindReviewPackSchema.shape.rubric,
  })
  .strict();
export type ReviewTemplate = z.infer<typeof templateSchema>;
export const reviewTemplateDigest = (t: ReviewTemplate) =>
  canonicalDigest('videobench/review-template-v1', templateSchema.parse(t));
const catalogSchema = z
  .object({
    version: z.literal(1),
    candidates: z.array(benchmarkCandidateSchema).min(2),
  })
  .strict();
export const candidateCatalogDigest = (c: unknown) =>
  canonicalDigest('videobench/candidate-catalog-v1', catalogSchema.parse(c));
const positionSchema = z
  .object({
    version: z.literal(1),
    seed: z.string().min(1).max(256),
    balanced: z.boolean(),
    entries: z
      .array(
        z
          .object({
            caseId: id,
            reviewReplicateId: id,
            A: z.enum(['baseline', 'candidate']),
            receiptDigest: digest,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type FrozenPositions = z.infer<typeof positionSchema>;
/** Explicit seed, deterministic per-case shuffle and optional alternating balance; private host data. */
export function freezeReviewPositions(
  schedule: Pick<BenchmarkSuite, 'schedule'>['schedule'],
  seed: string,
  balanced = true,
): FrozenPositions {
  const counts = new Map<string, number>();
  const entries = schedule.map((s) => {
    const index = counts.get(s.caseId) ?? 0;
    counts.set(s.caseId, index + 1);
    const bit =
      parseInt(
        canonicalDigest('videobench/position-seed-v1', {
          seed,
          caseId: s.caseId,
          ...(balanced ? {} : { reviewReplicateId: s.reviewReplicateId }),
        }).slice(0, 2),
        16,
      ) % 2;
    const A = (
      (bit + (balanced ? index : 0)) % 2 ? 'candidate' : 'baseline'
    ) as 'candidate' | 'baseline';
    const receiptDigest = canonicalDigest('videobench/position-receipt-v1', {
      seed,
      balanced,
      caseId: s.caseId,
      reviewReplicateId: s.reviewReplicateId,
      index,
      A,
    });
    return {
      caseId: s.caseId,
      reviewReplicateId: s.reviewReplicateId,
      A,
      receiptDigest,
    };
  });
  return positionSchema.parse({ version: 1, seed, balanced, entries });
}
export interface ReviewProtocolRequest {
  suite: BenchmarkSuite;
  cases: z.infer<typeof benchmarkCaseSchema>[];
  profiles: z.infer<typeof evaluationProfileSchema>[];
  template: ReviewTemplate;
  positions: FrozenPositions;
  bundles: {
    root: string;
    caseId: string;
    arm: 'baseline' | 'candidate';
    plan: EvidenceCapturePlan;
    evidenceDigest: string;
  }[];
}
/** This object comes from explicit host arguments, never from review/request JSON. */
export interface ReviewHostTrust {
  catalog: unknown;
  catalogDigest: string;
  suiteDigest: string;
  evidenceSeals: {
    caseId: string;
    arm: 'baseline' | 'candidate';
    evidenceDigest: string;
  }[];
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const requireValid = (r: { valid: boolean; errors: string[] }) => {
  if (!r.valid) throw Error(r.errors.join('; '));
};
export interface QualificationHostAuthority {
  frozen: unknown;
  expectedDigest: string;
  currentInputs: unknown;
  ledgerRoot: string;
  ledgerDigest: string;
  claimId: string;
}
const qualifiedProtocols = new WeakMap<object, QualificationHostAuthority>();
/** Opaque host metadata validation only: never opens evidence or dispatches reviewers. */
export function prepareReviewProtocolMetadata(
  request: ReviewProtocolRequest,
  trust: ReviewHostTrust,
) {
  digest.parse(trust.catalogDigest);
  digest.parse(trust.suiteDigest);
  if (candidateCatalogDigest(trust.catalog) !== trust.catalogDigest)
    throw Error('Trusted candidate catalog digest mismatch');
  const catalog = catalogSchema.parse(trust.catalog);
  const suite = benchmarkSuiteSchema.parse(request.suite);
  const context = {
    expectedSuiteDigest: trust.suiteDigest,
    candidates: catalog.candidates,
    cases: request.cases,
    profiles: request.profiles,
    suite,
  };
  requireValid(validateBenchmarkSuite(suite, context));
  const template = templateSchema.parse(request.template);
  if (
    reviewTemplateDigest(template) !== suite.reviewProtocol.reviewTemplateDigest
  )
    throw Error('Review template digest mismatch');
  const positions = positionSchema.parse(request.positions);
  if (
    !same(
      positions,
      freezeReviewPositions(suite.schedule, positions.seed, positions.balanced),
    )
  )
    throw Error('Frozen randomization receipt mismatch');
  if (request.bundles.length !== request.cases.length * 2)
    throw Error('Incomplete/extra materialized bundles');
  const seals = z
    .array(
      z
        .object({
          caseId: id,
          arm: z.enum(['baseline', 'candidate']),
          evidenceDigest: digest,
        })
        .strict(),
    )
    .parse(trust.evidenceSeals);
  if (seals.length !== request.cases.length * 2)
    throw Error('Missing/extra trusted evidence seals');
  for (const c of request.cases)
    for (const arm of ['baseline', 'candidate'] as const) {
      const bundles = request.bundles.filter(
        (b) => b.caseId === c.id && b.arm === arm,
      );
      const retained = seals.filter(
        (seal) => seal.caseId === c.id && seal.arm === arm,
      );
      if (
        bundles.length !== 1 ||
        retained.length !== 1 ||
        bundles[0]!.evidenceDigest !== retained[0]!.evidenceDigest
      )
        throw Error('Independently retained evidence seal mismatch');
    }
  return {
    request,
    trust,
    context,
    suite,
    template,
    positions,
    catalog,
    seals,
  };
}
export async function loadReviewProtocol(
  request: ReviewProtocolRequest,
  trust: ReviewHostTrust,
  qualification?: QualificationHostAuthority,
) {
  const metadata = prepareReviewProtocolMetadata(request, trust);
  const { suite, context, template, positions, catalog, seals } = metadata;
  const formal = request.cases.some((c) => c.split === 'holdout');
  if (formal && !qualification)
    throw Error(
      'Formal holdout review requires independently approved Phase 4 freeze/consumption authority; Phase 3 refuses exposure',
    );
  if (formal) {
    const authority = qualification!;
    // This check precedes reading any holdout evidence bytes.
    const frozen = verifyQualificationReportInputs(
      authority.frozen,
      authority.expectedDigest,
      metadata,
      authority.currentInputs,
    );
    const ledger = await readHoldoutLedger(
      authority.ledgerRoot,
      authority.ledgerDigest,
    );
    for (const c of request.cases.filter((c) => c.split === 'holdout')) {
      const content = benchmarkCaseContentDigest(c, catalog.candidates);
      if (
        !frozen.artifact.qualification.formalHoldoutMaterials.some(
          (m) => m.contentDigest === content,
        )
      )
        throw Error('Holdout content absent from qualification freeze');
      const event = ledger.events.find(
        (e) => e.state === 'consumed' && e.contentDigest === content,
      );
      if (
        !event ||
        event.claimId !== authority.claimId ||
        event.suiteDigest !== trust.suiteDigest ||
        event.evaluatorDigest !== suite.evaluatorDigest ||
        !same(event.case, videoBenchBinding('case', c)) ||
        ledger.events.some(
          (e) =>
            e.state === 'retired-to-development' &&
            e.consumptionId === event.id,
        )
      )
        throw Error(
          'Holdout requires exact durable consumption before exposure',
        );
    }
  }
  const bundles: { root: string; bundle: MaterializedEvidenceBundle }[] = [];
  for (const c of request.cases)
    for (const arm of ['baseline', 'candidate'] as const) {
      const matches = request.bundles.filter(
        (b) => b.caseId === c.id && b.arm === arm,
      );
      if (matches.length !== 1)
        throw Error('Missing/duplicate materialized evidence');
      const b = matches[0]!;
      const seal = seals.filter((x) => x.caseId === c.id && x.arm === arm);
      if (seal.length !== 1 || seal[0]!.evidenceDigest !== b.evidenceDigest)
        throw Error('Independently retained evidence seal mismatch');
      digest.parse(b.evidenceDigest);
      const candidate = catalog.candidates.find((x) => x.id === c[arm].id)!;
      const checked = await validateMaterializedEvidence(
        b.root,
        {
          candidate,
          plan: b.plan,
          semanticDigest: b.evidenceDigest,
          caseId: c.id,
          arm,
        },
        { pixels: pngPixels, grid: pngGrid },
      );
      requireValid(checked);
      bundles.push({ root: resolve(b.root), bundle: checked.bundle! });
    }
  const evidence = bundles.flatMap((b) => b.bundle.evidence);
  requireValid(validateVideoBenchEvidence(evidence, context));
  const protocol = {
    request,
    trust,
    context,
    suite,
    template,
    positions,
    bundles,
    evidence,
    catalog,
  };
  if (formal) qualifiedProtocols.set(protocol, qualification!);
  return protocol;
}
type Protocol = Awaited<ReturnType<typeof loadReviewProtocol>>;
async function verifyFormalAuthority(p: Protocol) {
  if (!p.request.cases.some((c) => c.split === 'holdout')) return;
  const authority = qualifiedProtocols.get(p);
  if (!authority) throw Error('Formal holdout lacks host authority');
  verifyQualificationReportInputs(
    authority.frozen,
    authority.expectedDigest,
    p,
    authority.currentInputs,
  );
  // Revalidate current history (including retirement) at every exposure/import boundary.
  await loadReviewProtocol(p.request, p.trust, authority);
}

/** A mechanically reproducible evaluator freeze; independently retain its digest before Phase 4.
 * It is a freeze artifact, not authorization to expose formal holdout material. */
export function freezeReviewEvaluator(
  p: Pick<
    Protocol,
    'request' | 'trust' | 'suite' | 'template' | 'positions' | 'catalog'
  >,
  hostRuntimeDigest: string,
) {
  digest.parse(hostRuntimeDigest);
  const artifact = {
    version: 1,
    hostRuntimeDigest,
    suiteDigest: p.trust.suiteDigest,
    candidateCatalogDigest: p.trust.catalogDigest,
    evidenceSeals: p.trust.evidenceSeals,
    capturePlans: p.request.bundles.map(({ caseId, arm, plan }) => ({
      caseId,
      arm,
      plan,
    })),
    profiles: p.suite.profiles,
    rubricDigest: p.suite.rubricDigest,
    reviewTemplateDigest: reviewTemplateDigest(p.template),
    reviewEvidencePlan: p.suite.reviewEvidencePlan,
    reviewerAssignments: p.suite.schedule,
    positions: p.positions,
    aggregation: p.suite.reviewProtocol.aggregation,
    evaluatorDigest: p.suite.evaluatorDigest,
    configDigest: p.suite.configDigest,
    negativeControls: p.request.cases.flatMap((c) => c.controls),
    replicatePolicy: p.suite.replicatePolicy,
    retryPolicy: { maxAttempts: 1 },
  };
  return {
    artifact,
    digest: canonicalDigest('videobench/evaluator-freeze-v1', artifact),
  };
}
type Assignment = BenchmarkSuite['schedule'][number]['reviews'][number];
export function constructBlindReview(
  p: Pick<Protocol, 'suite' | 'positions' | 'template' | 'evidence'>,
  caseId: string,
  reviewReplicateId: string,
  packId: string,
) {
  const position = p.positions.entries.find(
    (e) => e.caseId === caseId && e.reviewReplicateId === reviewReplicateId,
  );
  if (!position) throw Error('Missing position receipt');
  const mapping: BlindIdentityMapping = {
    version: 1,
    packId,
    caseId,
    reviewReplicateId,
    aliases: [],
    A: position.A,
    B: position.A === 'baseline' ? 'candidate' : 'baseline',
    randomizationReceiptDigest: position.receiptDigest,
  };
  const pack: BlindReviewPack = {
    version: 1,
    id: packId,
    caseId,
    reviewReplicateId,
    ...p.template,
    reviewTemplateDigest: reviewTemplateDigest(p.template),
    evidenceA: [],
    evidenceB: [],
  };
  for (const pos of ['A', 'B'] as const) {
    const selected = p.suite.reviewEvidencePlan
      .find((x) => x.caseId === caseId)
      ?.arms.find((a) => a.arm === mapping[pos])?.evidenceIds;
    if (!selected) throw Error('Missing presealed evidence plan');
    const counters = { frame: 0, sheet: 0, strip: 0 };
    for (const sourceEvidenceId of selected) {
      const e = p.evidence.find((e) => e.id === sourceEvidenceId);
      if (!e || e.kind === 'diagnostic')
        throw Error('Ineligible creative evidence');
      const kind =
        e.kind === 'representative-frames'
          ? 'frame'
          : e.kind === 'contact-sheet'
            ? 'sheet'
            : 'strip';
      // One representative evidence record maps to a byte-identical chronological grid.
      const aliasId = `${pos}/${kind}-${String(++counters[kind]).padStart(2, '0')}`;
      pack[pos === 'A' ? 'evidenceA' : 'evidenceB'].push(aliasId);
      mapping.aliases.push({ aliasId, sourceEvidenceId });
    }
  }
  blindReviewPackSchema.parse(pack);
  blindIdentityMappingSchema.parse(mapping);
  return {
    pack,
    mapping,
    packDigest: videoBenchDigest('review-pack', pack),
    mappingDigest: videoBenchDigest('blind-mapping', mapping),
    inputBundleDigest: blindInputBundleDigest(pack, p.evidence, mapping),
  };
}
function assigned(p: Protocol, packId: string) {
  if (
    p.request.cases.some((c) => c.split === 'holdout') &&
    !qualifiedProtocols.has(p)
  )
    throw Error(
      'Formal holdout review is disabled before Phase 4 freeze/consumption authority',
    );
  const entries = p.suite.schedule.flatMap((s) =>
    s.reviews.filter((a) => a.packId === packId).map((a) => ({ s, a })),
  );
  if (entries.length !== 1) throw Error('Unscheduled/duplicate assignment');
  const { s, a } = entries[0]!;
  const built = constructBlindReview(
    p,
    s.caseId,
    s.reviewReplicateId,
    a.packId,
  );
  if (
    built.packDigest !== a.packDigest ||
    built.mappingDigest !== a.mappingDigest ||
    built.inputBundleDigest !== a.inputBundleDigest
  )
    throw Error('Frozen assignment pack/mapping/input digest mismatch');
  return { ...built, s, a };
}
export function scanReviewLeakage(
  text: string,
  candidates: z.infer<typeof benchmarkCandidateSchema>[],
) {
  const known = candidates
    .flatMap((c) => [
      c.id,
      c.projectId,
      c.binding.projectSha256,
      c.binding.sourceSha256 ?? '',
      c.renderDigest,
      c.sourceCommit ?? '',
    ])
    // Match the report validator's minimum identity length. Short valid IDs
    // such as "a" or "id" occur in ordinary rubric and rationale text.
    .filter((value) => value.length >= 4);
  const scan = (text: string) => {
    if (
      /\b(?:baseline|candidate|git|branch|version|v\d+\.\d+)\b|[a-f0-9]{40,64}|(?:^|[\s"'])(?:\/|[A-Za-z]:[\\/]|\\\\)/i.test(
        text,
      ) ||
      known.some((s) => text.includes(s))
    )
      throw Error('Judge-visible identity leakage');
  };
  let structured: unknown;
  try {
    structured = JSON.parse(text);
  } catch {
    /* Plain text remains supported. */
  }
  if (!structured || typeof structured !== 'object') return scan(text);
  const visit = (value: unknown): void => {
    if (typeof value === 'string') scan(value);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        scan(key);
        visit(child);
      }
    }
  };
  visit(structured);
}
/** Scan text only. Compressed PNG pixel bytes are not text and can contain accidental
 * slash/hex sequences. Reject metadata/unknown chunks instead of treating IDAT as prose. */
export function scanJudgeImage(bytes: Buffer) {
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error('Judge image is not PNG');
  const allowed = new Set([
    'IHDR',
    'IDAT',
    'IEND',
    'sRGB',
    'gAMA',
    'cHRM',
    'pHYs',
  ]);
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw Error('Malformed judge PNG');
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (!allowed.has(kind))
      throw Error('Judge-visible PNG metadata/identity leakage');
    offset += length + 12;
    if (offset > bytes.length) throw Error('Malformed judge PNG');
    if (kind === 'IEND' && offset !== bytes.length)
      throw Error('Trailing judge PNG data rejected');
  }
  pngPixels(bytes);
}
async function durableJson(path: string, value: unknown) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(canonicalJson(value));
    await file.sync();
  } finally {
    await file.close();
  }
}
async function syncDirectory(path: string) {
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function noSymlinkAncestors(path: string) {
  const full = resolve(path);
  let cursor = dirname(full);
  while (true) {
    if ((await lstat(cursor)).isSymbolicLink())
      throw Error('Symlink output ancestor rejected');
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
// Resolve existing ancestors without creating the missing output suffix.
async function resolvedOutputPath(path: string): Promise<string> {
  let cursor = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(cursor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const entry = await lstat(cursor).catch(
        (statError: NodeJS.ErrnoException) => {
          if (statError.code !== 'ENOENT') throw statError;
          return undefined;
        },
      );
      if (entry?.isSymbolicLink())
        throw Error('Unresolved formal output alias');
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      suffix.unshift(relative(parent, cursor));
      cursor = parent;
    }
  }
}
async function isolateFormalOutput(target: string, ledgerRoot: string) {
  const ledger = await realpath(resolve(ledgerRoot));
  const output = await resolvedOutputPath(target);
  const rel = relative(ledger, output);
  if (!rel || (!isAbsolute(rel) && rel.split(sep)[0] !== '..'))
    throw Error('Formal output overlaps ledger authority');
}

async function atomicNewDirectory(
  target: string,
  build: (temp: string) => Promise<void>,
) {
  await noSymlinkAncestors(target);
  // Preserve native target semantics while locking and syncing its physical parent.
  // In particular symlink/.. must not publish in one directory and quarantine in another.
  const parent = await realpath(dirname(target));
  const lock = `${join(parent, basename(target))}.lock`;
  const handle = await open(lock, 'wx', 0o600);
  let temp: string | undefined;
  let published = false;
  let quarantine = false;
  try {
    if (
      await lstat(target).then(
        () => true,
        (e) => {
          if (e.code === 'ENOENT') return false;
          throw e;
        },
      )
    )
      throw Error('Pre-existing output rejected');
    temp = await mkdtemp(join(parent, '.review-build-'));
    await build(temp);
    await rename(temp, target);
    published = true;
    temp = undefined;
    await syncDirectory(parent);
  } catch (error) {
    if (published) {
      try {
        await rm(target, { recursive: true, force: true });
      } catch (cleanupError) {
        // Retain the existing exclusive lock: consumers and retries fail closed.
        // Deletion/durability cannot be guaranteed under a failing filesystem.
        quarantine = true;
        throw new AggregateError(
          [error, cleanupError],
          'Publication durability and cleanup failed; output quarantined by retained lock',
        );
      }
    }
    throw error;
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    await handle.close();
    if (!quarantine) await rm(lock);
  }
}
const representativeGridCache = new WeakMap<
  object,
  Map<string, { key: string; bytes: Buffer }>
>();
async function aliasBytes(p: Protocol, sourceId: string): Promise<Buffer> {
  const source = p.bundles.find((b) =>
    b.bundle.evidence.some((e) => e.id === sourceId),
  );
  const e = source?.bundle.evidence.find((e) => e.id === sourceId);
  if (!source || !e || e.kind === 'diagnostic')
    throw Error('Unknown alias source');
  const read = async (path: string, sha: string) => {
    const bytes = await readFile(await retainedEvidencePath(source.root, path));
    if (outputIdentity(bytes) !== sha)
      throw Error('Evidence bytes changed during pack construction');
    return bytes;
  };
  if (e.kind !== 'representative-frames')
    return read(e.artifact.path, e.artifact.sha256);
  const frames = await Promise.all(
    e.frames.map((f) => read(f.frame.path, f.frame.sha256)),
  );
  const sourceWidth = frames[0]!.readUInt32BE(16),
    sourceHeight = frames[0]!.readUInt32BE(20);
  const width = Math.min(640, sourceWidth),
    height = Math.max(1, Math.round((sourceHeight * width) / sourceWidth));
  if (
    Math.min(4, e.frames.length) *
      width *
      Math.ceil(e.frames.length / 4) *
      height >
    reviewPackLimits.maxImagePixels
  )
    throw Error('Review pack image pixel limit');
  const key = canonicalDigest('videobench/representative-grid-v1', {
    frames: e.frames.map((f) => ({
      timeMs: f.frame.timeMs,
      sha256: f.frame.sha256,
    })),
    columns: Math.min(4, frames.length),
    width,
    height,
  });
  const cache = representativeGridCache.get(p) ?? new Map();
  representativeGridCache.set(p, cache);
  const retained = cache.get(sourceId);
  // All original bytes have just been revalidated, including on a cache hit.
  if (retained?.key === key) return Buffer.from(retained.bytes);
  const bytes = pngGrid(frames, Math.min(4, frames.length), width, height);
  if (bytes.length <= 16 * 1024 * 1024) {
    if (
      [...cache.values()].reduce((sum, entry) => sum + entry.bytes.length, 0) +
        bytes.length >
      64 * 1024 * 1024
    )
      cache.clear();
    cache.set(sourceId, { key, bytes: Buffer.from(bytes) });
  }
  return bytes;
}
/** Judge payload intentionally omits all operational IDs and digest metadata. Private pack remains the frozen contract. */
function judgeContext(
  pack: BlindReviewPack,
  p: Protocol,
  mapping: BlindIdentityMapping,
) {
  const c = p.request.cases.find((c) => c.id === pack.caseId)!;
  const profile = p.request.profiles.find((x) => x.id === c.profile.id)!;
  return {
    evidenceMetadata: mapping.aliases.map((alias) => {
      const source = p.evidence.find((e) => e.id === alias.sourceEvidenceId);
      if (!source || source.kind === 'diagnostic')
        throw Error('Ineligible timing metadata');
      if (source.kind === 'representative-frames')
        return {
          aliasId: alias.aliasId,
          kind: source.kind,
          timesMs: source.frames.map((f) => f.frame.timeMs),
        };
      if (source.kind === 'frame-strip')
        return {
          aliasId: alias.aliasId,
          kind: source.kind,
          startMs: source.range.startMs,
          endMs: source.range.endMs,
          cadenceMs: source.cadenceMs,
        };
      const frames = p.evidence
        .filter((e) => e.kind === 'representative-frames')
        .flatMap((e) => e.frames);
      return {
        aliasId: alias.aliasId,
        kind: source.kind,
        timesMs: source.frameIds.map((id) => {
          const frame = frames.find((f) => f.frame.id === id);
          if (!frame) throw Error('Missing sheet frame timing');
          return frame.frame.timeMs;
        }),
      };
    }),
    context: pack.context,
    rubric: pack.rubric.map((r) => ({
      ...r,
      applicable: profile.dimensions.find((d) => d.id === r.dimensionId)!
        .applicable,
    })),
    evidenceA: pack.evidenceA,
    evidenceB: pack.evidenceB,
  };
}
const reviewerInstructions = `Review A and B using only this folder.
Read prompt-or-context.json for dimension definitions, applicable evidence aliases and image timing metadata.
Use chronological frames, the contact sheet and temporal strip together.
Return JSON containing only { "dimensions": [...] } in the form shown by review-schema.json.
For each dimension choose A, B, equivalent, inconclusive or not-applicable.
Equivalent means the shown evidence supports no meaningful difference.
Inconclusive means evidence is insufficient or the tradeoff prevents a clear preference.
Use not-applicable only when the dimension definition marks it inactive.
Cite the visible evidence aliases and explain the observed presentation.
Do not infer identities. Do not consult other reviews or outside material.
`;
const judgeSchema = {
  dimensions: [
    {
      dimensionId: 'rubric dimension identifier',
      verdict: ['A', 'B', 'equivalent', 'inconclusive', 'not-applicable'],
      evidenceIds: ['A/frame-01', 'B/frame-01'],
      rationale: 'Explain using only the shown aliases',
    },
  ],
};
export const reviewPackLimits = Object.freeze({
  maxImagePixels: 64 * 1024 * 1024,
  maxFiles: 256,
  maxTotalBytes: 256 * 1024 * 1024,
  maxAliases: 128,
  maxContextBytes: 64 * 1024,
});
export function validateReviewPackResources(
  files: Map<string, Buffer>,
  aliases: number,
) {
  if (
    aliases > reviewPackLimits.maxAliases ||
    files.size > reviewPackLimits.maxFiles
  )
    throw Error('Review pack file/alias limit');
  let total = 0;
  for (const [path, bytes] of files) {
    total += bytes.length;
    if (path.endsWith('.png')) {
      if (
        bytes.length < 24 ||
        bytes.readUInt32BE(16) * bytes.readUInt32BE(20) >
          reviewPackLimits.maxImagePixels
      )
        throw Error('Review pack image pixel limit');
    } else if (bytes.length > reviewPackLimits.maxContextBytes)
      throw Error('Review pack context byte limit');
  }
  if (total > reviewPackLimits.maxTotalBytes)
    throw Error('Review pack total byte limit');
}
export async function materializeBlindReviewPack(
  p: Protocol,
  packId: string,
  target: string,
) {
  const built = assigned(p, packId);
  if (
    p.request.cases.some((c) => c.split === 'holdout') &&
    !qualifiedProtocols.has(p)
  )
    throw Error(
      'Formal holdout export requires evaluator freeze and consumption authority; Phase 3 does not dispatch holdout',
    );
  const publish = async () => {
    await atomicNewDirectory(target, async (temp) => {
      const judge = join(temp, 'review-pack');
      const privateRoot = join(temp, 'private');
      await mkdir(judge);
      await mkdir(privateRoot);
      await mkdir(join(judge, 'A'));
      await mkdir(join(judge, 'B'));
      const context = judgeContext(built.pack, p, built.mapping);
      scanReviewLeakage(canonicalJson(context), p.catalog.candidates);
      const resources = new Map<string, Buffer>([
        ['prompt-or-context.json', Buffer.from(canonicalJson(context))],
        ['review-schema.json', Buffer.from(canonicalJson(judgeSchema))],
        ['instructions.txt', Buffer.from(reviewerInstructions)],
      ]);
      validateReviewPackResources(resources, built.mapping.aliases.length);
      await durableJson(join(judge, 'prompt-or-context.json'), context);
      await durableJson(join(judge, 'review-schema.json'), judgeSchema);
      await writeFile(join(judge, 'instructions.txt'), reviewerInstructions, {
        flag: 'wx',
        mode: 0o400,
      });
      for (const alias of built.mapping.aliases) {
        const bytes = await aliasBytes(p, alias.sourceEvidenceId);
        // PNG metadata is not expected from Phase 2; detect textual identity if present.
        scanJudgeImage(bytes);
        resources.set(`${alias.aliasId}.png`, bytes);
        validateReviewPackResources(resources, built.mapping.aliases.length);
        await writeFile(join(judge, `${alias.aliasId}.png`), bytes, {
          flag: 'wx',
          mode: 0o400,
        });
      }
      await durableJson(join(privateRoot, 'pack.json'), built.pack);
      await durableJson(join(privateRoot, 'mapping.json'), built.mapping);
      await durableJson(join(privateRoot, 'receipt.json'), {
        packDigest: built.packDigest,
        mappingDigest: built.mappingDigest,
        inputBundleDigest: built.inputBundleDigest,
      });
      await verifyJudgeWorkspace(p, packId, judge);
      await chmod(join(judge, 'prompt-or-context.json'), 0o400);
      await chmod(join(judge, 'review-schema.json'), 0o400);
      // Flush copied resources and directory entries before canonical publication.
      async function syncTree(root: string): Promise<void> {
        for (const name of await readdir(root)) {
          const path = join(root, name);
          if ((await lstat(path)).isDirectory()) await syncTree(path);
          else {
            const file = await open(path, 'r');
            try {
              await file.sync();
            } finally {
              await file.close();
            }
          }
        }
        await syncDirectory(root);
      }
      await syncTree(temp);
    });
  };
  if (p.request.cases.some((c) => c.split === 'holdout')) {
    // Formal isolation and publication must use the same normalized path.
    // Development retains its existing native target-path semantics.
    target = resolve(target);
    const authority = qualifiedProtocols.get(p)!;
    await isolateFormalOutput(target, authority.ledgerRoot);
    // Same fail-closed lock as consume/retire/reconcile. Never acquire a ledger
    // lock from inside the output lock: ledger -> output -> durable completion.
    await exclusive(authority.ledgerRoot, async () => {
      await verifyFormalAuthority(p);
      await publish();
    });
  } else await publish();
  return {
    packId,
    packDigest: built.packDigest,
    mappingDigest: built.mappingDigest,
    inputBundleDigest: built.inputBundleDigest,
    materialized: true,
  };
}
// Resolve the native spelling before any join/dirname normalization. Reject aliases
// whose physical and lexical identities differ, then use one identity throughout.
async function trustedWorkspacePath(root: string): Promise<string> {
  const physical = await realpath(root);
  if (physical !== resolve(root))
    throw Error('Ambiguous judge workspace path identity');
  return physical;
}
async function verifyPrivateSidecar(
  p: Protocol,
  packId: string,
  exportRoot: string,
) {
  exportRoot = await trustedWorkspacePath(exportRoot);
  const built = assigned(p, packId);
  const root = join(exportRoot, 'private');
  const pack = JSON.parse(
    await readFile(await retainedEvidencePath(root, 'pack.json'), 'utf8'),
  );
  const mapping = JSON.parse(
    await readFile(await retainedEvidencePath(root, 'mapping.json'), 'utf8'),
  );
  const receipt = JSON.parse(
    await readFile(await retainedEvidencePath(root, 'receipt.json'), 'utf8'),
  );
  if (
    !same(pack, built.pack) ||
    !same(mapping, built.mapping) ||
    !same(receipt, {
      packDigest: built.packDigest,
      mappingDigest: built.mappingDigest,
      inputBundleDigest: built.inputBundleDigest,
    })
  )
    throw Error('Private mapping/pack mutation');
}
export async function verifyJudgeWorkspace(
  p: Protocol,
  packId: string,
  root: string,
) {
  root = await trustedWorkspacePath(root);
  const publicationLock = `${dirname(root)}.lock`;
  await lstat(publicationLock).then(
    () => {
      throw Error('Unresolved output publication lock');
    },
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
  const built = assigned(p, packId);
  if ((await lstat(root)).isSymbolicLink())
    throw Error('Judge root symlink rejected');
  const expected = new Map<string, Buffer>([
    [
      'prompt-or-context.json',
      Buffer.from(canonicalJson(judgeContext(built.pack, p, built.mapping))),
    ],
    ['review-schema.json', Buffer.from(canonicalJson(judgeSchema))],
    ['instructions.txt', Buffer.from(reviewerInstructions)],
  ]);
  if (built.mapping.aliases.length > reviewPackLimits.maxAliases)
    throw Error('Review pack alias limit');
  validateReviewPackResources(expected, built.mapping.aliases.length);
  for (const a of built.mapping.aliases) {
    expected.set(`${a.aliasId}.png`, await aliasBytes(p, a.sourceEvidenceId));
    validateReviewPackResources(expected, built.mapping.aliases.length);
  }
  const files: string[] = [];
  async function scan(directory: string, prefix = '') {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const s = await lstat(path);
      const rel = `${prefix}${name}`;
      if (s.isSymbolicLink()) throw Error('Judge workspace symlink rejected');
      if (s.isDirectory()) {
        if (!['A', 'B'].includes(rel))
          throw Error('Unexpected judge directory');
        await scan(path, `${rel}/`);
      } else if (s.isFile()) files.push(rel);
      else throw Error('Unexpected judge file type');
    }
  }
  await scan(root);
  if (!same(files.sort(), [...expected.keys()].sort()))
    throw Error('Judge isolation inventory mismatch');
  for (const [path, bytes] of expected) {
    const actual = await readFile(await retainedEvidencePath(root, path));
    if (!actual.equals(bytes)) throw Error('Judge pack bytes mutated');
    if (path.endsWith('.png')) scanJudgeImage(actual);
    else scanReviewLeakage(actual.toString('utf8'), p.catalog.candidates);
  }
  return canonicalDigest(
    'videobench/judge-workspace-v1',
    [...expected].map(([path, bytes]) => ({
      path,
      sha256: outputIdentity(bytes),
    })),
  );
}

async function authorityRoot(root: string, judgeRoot?: string) {
  await noSymlinkAncestors(root);
  if (judgeRoot) {
    const rel = relative(resolve(judgeRoot), resolve(root));
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel)))
      throw Error('Receipt authority cannot be in judge workspace');
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink())
    throw Error('Authority symlink rejected');
}
async function exclusive<T>(root: string, action: () => Promise<T>) {
  await authorityRoot(root);
  const lock = join(root, '.lock');
  const handle = await open(lock, 'wx', 0o600);
  try {
    return await action();
  } finally {
    await handle.close();
    await rm(lock);
  }
}
const attemptSchema = z
  .object({
    version: z.literal(1),
    attemptId: id,
    suiteDigest: digest,
    packId: id,
    reviewerId: id,
    assignmentDigest: digest,
    startedAt: z.string(),
    endedAt: z.string().optional(),
    status: z.enum([
      'started',
      'accepted',
      'executor-failure',
      'invalid-output',
    ]),
    workspaceDigest: digest,
    receiptDigest: digest.optional(),
    resultDigest: digest.optional(),
  })
  .strict();
const trustedReceiptSchema = z
  .object({
    version: z.literal(1),
    attemptId: id,
    suiteDigest: digest,
    assignmentDigest: digest,
    packDigest: digest,
    mappingDigest: digest,
    inputBundleDigest: digest,
    reviewTemplateDigest: digest,
    workspaceDigest: digest,
    workspacePolicy: z.enum(['empty', 'sanitized']),
    provenance: z.enum(['host-manual-import-v1', 'host-isolated-execution-v1']),
    rawReviewDigest: digest,
    receiptDigest: digest,
    resultDigest: digest,
  })
  .strict();
function validateImported(
  p: Protocol,
  built: ReturnType<typeof assigned>,
  raw: unknown,
) {
  const r = creativeReviewRecordSchema.parse(raw);
  const { a, s, pack } = built;
  scanReviewLeakage(
    [r.id, r.caseId, r.reviewReplicateId, r.packId].join(' '),
    p.catalog.candidates,
  );
  if (
    r.caseId !== s.caseId ||
    r.reviewReplicateId !== s.reviewReplicateId ||
    r.reviewerId !== a.reviewerId ||
    r.identityClass !== a.identityClass ||
    r.reviewerType !== a.reviewerClass ||
    r.packId !== a.packId ||
    r.packDigest !== a.packDigest ||
    (r.reviewerType === 'external-agent' && !same(r.agent, a.agent))
  )
    throw Error('Imported assignment mismatch');
  if (
    r.receipt.workspacePolicy !== p.suite.reviewProtocol.workspacePolicy ||
    r.receipt.inputBundleDigest !== built.inputBundleDigest ||
    r.receipt.reviewTemplateDigest !== reviewTemplateDigest(p.template)
  )
    throw Error('Imported receipt input/template mismatch');
  const c = p.request.cases.find((c) => c.id === s.caseId)!;
  if (
    !same(
      r.dimensions.map((d) => d.dimensionId).sort(),
      c.requiredDimensions.slice().sort(),
    )
  )
    throw Error('Missing/duplicate required dimensions');
  const profile = p.request.profiles.find((x) => x.id === c.profile.id)!;
  for (const d of r.dimensions) {
    scanReviewLeakage(d.rationale, p.catalog.candidates);
    const aliases = [...pack.evidenceA, ...pack.evidenceB];
    // Runtime requires all presealed aliases per dimension; no selective evidence omission.
    if (!same(d.evidenceIds.slice().sort(), aliases.slice().sort()))
      throw Error('Missing/duplicate/unknown required aliases');
    const applicable = profile.dimensions.find(
      (x) => x.id === d.dimensionId,
    )!.applicable;
    if (
      applicable
        ? d.verdict === 'not-applicable'
        : d.verdict !== 'not-applicable'
    )
      throw Error('Review applicability mismatch');
  }
  return r;
}
/** Human judges submit only the isolated schema's dimensions. Attach the host routing
 * envelope after review while retaining their original bytes in the trusted receipt. */
function normalizeHumanImport(
  p: Protocol,
  built: ReturnType<typeof assigned>,
  raw: unknown,
  attemptId: string,
) {
  const dimensionsOnly = z
    .object({
      dimensions: creativeReviewRecordSchema.options[0].shape.dimensions,
    })
    .strict()
    .safeParse(raw);
  if (!dimensionsOnly.success) return raw;
  if (built.a.reviewerClass !== 'human')
    throw Error('Dimensions-only import requires scheduled human reviewer');
  return {
    version: 1,
    id: attemptId,
    caseId: built.s.caseId,
    reviewReplicateId: built.s.reviewReplicateId,
    reviewerId: built.a.reviewerId,
    identityClass: built.a.identityClass,
    reviewerType: 'human',
    packId: built.a.packId,
    packDigest: built.packDigest,
    receipt: {
      workspacePolicy: p.suite.reviewProtocol.workspacePolicy,
      inputBundleDigest: built.inputBundleDigest,
      reviewTemplateDigest: reviewTemplateDigest(p.template),
      provenance: 'manual-human-dimensions-import',
      receiptDigest: '0'.repeat(64),
    },
    dimensions: dimensionsOnly.data.dimensions,
  };
}

/** Explicit host import is the authority operation. The untrusted JSON cannot create its own receipt.
 * Default retry policy is one attempt. Failed and successful attempts are never overwritten. */
export async function importBlindReview(
  p: Protocol,
  packId: string,
  judgeRoot: string,
  rawBytes: Buffer | (() => Promise<Buffer>),
  authority: string,
  attemptId: string,
) {
  judgeRoot = await trustedWorkspacePath(judgeRoot);
  await verifyFormalAuthority(p);
  id.parse(attemptId);
  const built = assigned(p, packId);
  await authorityRoot(authority, judgeRoot);
  await verifyPrivateSidecar(p, packId, dirname(judgeRoot));
  const workspaceDigest = await verifyJudgeWorkspace(p, packId, judgeRoot);
  return exclusive(authority, async () => {
    const attemptsRoot = join(authority, 'attempts');
    await mkdir(attemptsRoot, { recursive: true });
    const assignmentDigest = canonicalDigest(
      'videobench/review-assignment-v1',
      {
        suiteDigest: p.trust.suiteDigest,
        schedule: built.s,
        assignment: built.a,
      },
    );
    for (const name of await readdir(attemptsRoot)) {
      const existing = attemptSchema.parse(
        JSON.parse(
          await readFile(
            await retainedEvidencePath(attemptsRoot, name),
            'utf8',
          ),
        ),
      );
      if (existing.assignmentDigest === assignmentDigest)
        throw Error(
          'Selective retry/duplicate review rejected: one-attempt policy',
        );
    }
    const started = attemptSchema.parse({
      version: 1,
      attemptId,
      suiteDigest: p.trust.suiteDigest,
      packId,
      reviewerId: built.a.reviewerId,
      assignmentDigest,
      startedAt: new Date().toISOString(),
      status: 'started',
      workspaceDigest,
    });
    await durableJson(join(attemptsRoot, `${attemptId}-start.json`), started);
    await syncDirectory(attemptsRoot);
    let executorFailed = false;
    const executed = typeof rawBytes === 'function';
    try {
      if (typeof rawBytes === 'function') {
        try {
          rawBytes = await rawBytes();
        } catch (error) {
          executorFailed = true;
          throw error;
        }
      }
      if (rawBytes.length > 1024 * 1024) throw Error('Review byte limit');
      const record = validateImported(
        p,
        built,
        normalizeHumanImport(
          p,
          built,
          JSON.parse(rawBytes.toString('utf8')),
          attemptId,
        ),
      );
      // Recheck evidence + workspace after parsing; receipt binds actual retained bytes.
      await verifyJudgeWorkspace(p, packId, judgeRoot);
      const receiptContent = {
        version: 1 as const,
        attemptId,
        suiteDigest: p.trust.suiteDigest,
        assignmentDigest,
        packDigest: built.packDigest,
        mappingDigest: built.mappingDigest,
        inputBundleDigest: built.inputBundleDigest,
        reviewTemplateDigest: reviewTemplateDigest(p.template),
        workspaceDigest,
        workspacePolicy: p.suite.reviewProtocol.workspacePolicy,
        provenance: executed
          ? ('host-isolated-execution-v1' as const)
          : ('host-manual-import-v1' as const),
        rawReviewDigest: outputIdentity(rawBytes),
      };
      const receiptDigest = canonicalDigest(
        'videobench/trusted-review-receipt-v1',
        receiptContent,
      );
      const accepted: CreativeReviewRecord = {
        ...record,
        receipt: {
          workspacePolicy: receiptContent.workspacePolicy,
          inputBundleDigest: built.inputBundleDigest,
          reviewTemplateDigest: receiptContent.reviewTemplateDigest,
          provenance: receiptContent.provenance,
          receiptDigest,
        },
      };
      const importedBytes = rawBytes;
      const bytes = Buffer.from(canonicalJson(accepted));
      const receipt = trustedReceiptSchema.parse({
        ...receiptContent,
        receiptDigest,
        resultDigest: outputIdentity(bytes),
      });
      const resultRoot = join(authority, 'accepted');
      await mkdir(resultRoot, { recursive: true });
      await atomicNewDirectory(join(resultRoot, attemptId), async (temp) => {
        await writeFile(join(temp, 'raw.json'), importedBytes, {
          flag: 'wx',
          mode: 0o400,
        });
        await durableJson(join(temp, 'review.json'), accepted);
        await durableJson(join(temp, 'receipt.json'), receipt);
      });
      await durableJson(join(attemptsRoot, `${attemptId}-end.json`), {
        ...started,
        endedAt: new Date().toISOString(),
        status: 'accepted',
        receiptDigest,
        resultDigest: receipt.resultDigest,
      });
      await syncDirectory(attemptsRoot);
      return { accepted: true, attemptId, review: accepted, receipt };
    } catch (error) {
      await durableJson(join(attemptsRoot, `${attemptId}-end.json`), {
        ...started,
        endedAt: new Date().toISOString(),
        status: executorFailed ? 'executor-failure' : 'invalid-output',
      });
      await syncDirectory(attemptsRoot);
      throw error;
    }
  });
}
export async function loadTrustedReviews(
  p: Protocol,
  authority: string,
  exports: { packId: string; root: string }[],
) {
  await verifyFormalAuthority(p);
  const expectedAssignments = p.suite.schedule.flatMap((s) => s.reviews);
  if (
    !same(
      exports.map((e) => e.packId).sort(),
      expectedAssignments.map((a) => a.packId).sort(),
    )
  )
    throw Error('Missing/duplicate/extra scheduled pack export');
  const reviews: CreativeReviewRecord[] = [];
  const packs: BlindReviewPack[] = [];
  const mappings: BlindIdentityMapping[] = [];
  const acceptedRoot = join(authority, 'accepted');
  const entries = await readdir(acceptedRoot);
  if (entries.length !== expectedAssignments.length)
    throw Error('Missing/extra scheduled trusted reviews');
  for (const attemptId of entries) {
    id.parse(attemptId);
    const dir = join(acceptedRoot, attemptId);
    const bytes = await readFile(
      await retainedEvidencePath(dir, 'review.json'),
    );
    const receipt = trustedReceiptSchema.parse(
      JSON.parse(
        await readFile(await retainedEvidencePath(dir, 'receipt.json'), 'utf8'),
      ),
    );
    const raw = await readFile(await retainedEvidencePath(dir, 'raw.json'));
    const { resultDigest, receiptDigest, ...content } = receipt;
    if (
      outputIdentity(bytes) !== resultDigest ||
      outputIdentity(raw) !== receipt.rawReviewDigest ||
      canonicalDigest('videobench/trusted-review-receipt-v1', content) !==
        receiptDigest
    )
      throw Error('Trusted receipt/result tamper');
    const r = creativeReviewRecordSchema.parse(
      JSON.parse(bytes.toString('utf8')),
    );
    const built = assigned(p, r.packId);
    validateImported(p, built, r);
    const suppliedRoot = exports.find((e) => e.packId === r.packId)?.root;
    if (!suppliedRoot) throw Error('Unscheduled review');
    const exportRoot = await trustedWorkspacePath(suppliedRoot);
    const workspaceDigest = await verifyJudgeWorkspace(
      p,
      r.packId,
      join(exportRoot, 'review-pack'),
    );
    await verifyPrivateSidecar(p, r.packId, exportRoot);
    const assignmentDigest = canonicalDigest(
      'videobench/review-assignment-v1',
      {
        suiteDigest: p.trust.suiteDigest,
        schedule: built.s,
        assignment: built.a,
      },
    );
    if (
      receipt.attemptId !== attemptId ||
      receipt.suiteDigest !== p.trust.suiteDigest ||
      receipt.assignmentDigest !== assignmentDigest ||
      receipt.packDigest !== built.packDigest ||
      receipt.mappingDigest !== built.mappingDigest ||
      receipt.inputBundleDigest !== built.inputBundleDigest ||
      receipt.reviewTemplateDigest !== reviewTemplateDigest(p.template) ||
      receipt.workspaceDigest !== workspaceDigest ||
      r.receipt.receiptDigest !== receiptDigest
    )
      throw Error('Host receipt authority mismatch');
    const attemptsRoot = join(authority, 'attempts');
    const start = attemptSchema.parse(
      JSON.parse(
        await readFile(
          await retainedEvidencePath(attemptsRoot, `${attemptId}-start.json`),
          'utf8',
        ),
      ),
    );
    const end = attemptSchema.parse(
      JSON.parse(
        await readFile(
          await retainedEvidencePath(attemptsRoot, `${attemptId}-end.json`),
          'utf8',
        ),
      ),
    );
    if (
      start.status !== 'started' ||
      end.status !== 'accepted' ||
      end.receiptDigest !== receiptDigest ||
      end.resultDigest !== resultDigest ||
      start.assignmentDigest !== assignmentDigest ||
      end.assignmentDigest !== assignmentDigest ||
      !end.endedAt ||
      !same(end, {
        ...start,
        status: 'accepted',
        endedAt: end.endedAt,
        receiptDigest,
        resultDigest,
      }) ||
      !Number.isFinite(Date.parse(end.endedAt)) ||
      Date.parse(end.endedAt) < Date.parse(start.startedAt)
    )
      throw Error('Attempt lineage mismatch');
    reviews.push(r);
    packs.push(built.pack);
    mappings.push(built.mapping);
  }
  if (
    !same(
      reviews.map((r) => r.packId).sort(),
      expectedAssignments.map((a) => a.packId).sort(),
    )
  )
    throw Error('Selective/duplicate scheduled reviews');
  return { reviews, packs, mappings };
}
/** Provider-neutral executor receives only sanitized context and a confined workspace.
 * Provider adapters are outside reference-core. No adapter or provider is invoked by CLI import. */
export interface ReviewExecutor {
  execute(input: {
    context: ReturnType<typeof judgeContext>;
    assignment: Pick<Assignment, 'reviewerClass' | 'identityClass' | 'agent'>;
    workspace: string;
    signal: AbortSignal;
  }): Promise<CreativeReviewRecord['dimensions']>;
}

const ledgerHeadSchema = z
  .object({
    version: z.literal(1),
    count: z.number().int().nonnegative(),
    digest,
  })
  .strict();
export async function executeBlindReview(
  p: Protocol,
  packId: string,
  judgeRoot: string,
  authority: string,
  attemptId: string,
  executor: ReviewExecutor,
  timeoutMs = 10000,
) {
  judgeRoot = await trustedWorkspacePath(judgeRoot);
  await verifyFormalAuthority(p);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000)
    throw Error('Review timeout bounds');
  const built = assigned(p, packId);
  return importBlindReview(
    p,
    packId,
    judgeRoot,
    async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const dimensions = await Promise.race([
          executor.execute({
            context: judgeContext(built.pack, p, built.mapping),
            assignment: {
              reviewerClass: built.a.reviewerClass,
              identityClass: built.a.identityClass,
              ...(built.a.agent ? { agent: built.a.agent } : {}),
            },
            workspace: judgeRoot,
            signal: controller.signal,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(Error('Review executor timeout'));
            }, timeoutMs);
          }),
        ]);
        return Buffer.from(
          canonicalJson({
            version: 1,
            id: attemptId,
            caseId: built.s.caseId,
            reviewReplicateId: built.s.reviewReplicateId,
            reviewerId: built.a.reviewerId,
            identityClass: built.a.identityClass,
            reviewerType: built.a.reviewerClass,
            ...(built.a.agent ? { agent: built.a.agent } : {}),
            packId,
            packDigest: built.packDigest,
            receipt: {
              workspacePolicy: p.suite.reviewProtocol.workspacePolicy,
              inputBundleDigest: built.inputBundleDigest,
              reviewTemplateDigest: reviewTemplateDigest(p.template),
              provenance: 'isolated-executor',
              receiptDigest: '0'.repeat(64),
            },
            dimensions,
          }),
        );
      } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
      }
    },
    authority,
    attemptId,
  );
}

export async function initializeHoldoutLedger(root: string) {
  await atomicNewDirectory(root, async (temp) => {
    await mkdir(join(temp, 'events'));
    await durableJson(join(temp, 'head.json'), {
      version: 1,
      count: 0,
      digest: holdoutLedgerDigest([]),
    });
    await syncDirectory(join(temp, 'events'));
    await syncDirectory(temp);
  });
}
/** Head is a host-retained high-water mark. A crash between event append and head advance fails closed.
 * Never recover by deleting an event; operator reconciliation must preserve consumption. */
export async function readHoldoutLedger(root: string, expectedDigest?: string) {
  const head = ledgerHeadSchema.parse(
    JSON.parse(
      await readFile(await retainedEvidencePath(root, 'head.json'), 'utf8'),
    ),
  );
  return inspectHoldoutLedger(root, head, expectedDigest);
}
async function inspectHoldoutLedger(
  root: string,
  head: z.infer<typeof ledgerHeadSchema>,
  expectedDigest?: string,
) {
  const directory = join(root, 'events');
  const files = (await readdir(directory)).sort();
  if (files.length !== head.count)
    throw Error('Holdout history truncation/unreconciled append');
  const events: HoldoutUse[] = [];
  const consumed = new Map<string, HoldoutUse>();
  const retired = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    if (files[i] !== `${String(i).padStart(8, '0')}.json`)
      throw Error('Holdout sequence mismatch');
    const e = holdoutUseSchema.parse(
      JSON.parse(
        await readFile(
          await retainedEvidencePath(directory, files[i]!),
          'utf8',
        ),
      ),
    );
    if (
      e.sequence !== i ||
      e.previousEntryDigest !==
        (i
          ? canonicalDigest('videobench/holdout-event-v1', events[i - 1]!)
          : '0'.repeat(64))
    )
      throw Error('Holdout history chain tamper');
    if (events.some((x) => x.id === e.id))
      throw Error('Duplicate holdout event');
    if (e.state === 'consumed') {
      if (
        [...consumed.values()].some((x) => x.contentDigest === e.contentDigest)
      )
        throw Error('Holdout reuse');
      consumed.set(e.id, e);
    } else {
      const original = consumed.get(e.consumptionId);
      if (
        !original ||
        retired.has(e.consumptionId) ||
        !same(original.case, e.case) ||
        original.contentDigest !== e.contentDigest ||
        original.suiteDigest !== e.suiteDigest ||
        original.evaluatorDigest !== e.evaluatorDigest ||
        original.claimId !== e.claimId
      )
        throw Error('Invalid holdout retirement');
      retired.add(e.consumptionId);
    }
    events.push(e);
  }
  const seal = holdoutLedgerDigest(events);
  if (
    seal !== head.digest ||
    (expectedDigest !== undefined && seal !== expectedDigest)
  )
    throw Error('Trusted holdout checkpoint mismatch');
  return { events, digest: seal };
}
/** Recover exactly one persisted append, authenticated by an independently retained
 * byte digest. Validate the old prefix and complete chain before advancing the head.
 * Never rewrite event bytes or restore freshness. Unknown integrity stays blocked. */
export async function reconcileHoldoutAppend(
  root: string,
  expectedHeadDigest: string,
  expectedPendingBytesDigest: string,
) {
  digest.parse(expectedHeadDigest);
  digest.parse(expectedPendingBytesDigest);
  return exclusive(root, async () => {
    const head = ledgerHeadSchema.parse(
      JSON.parse(
        await readFile(await retainedEvidencePath(root, 'head.json'), 'utf8'),
      ),
    );
    if (head.digest !== expectedHeadDigest)
      throw Error('Trusted holdout checkpoint mismatch');
    const files = (await readdir(join(root, 'events'))).sort();
    if (files.length !== head.count + 1)
      throw Error('Reconciliation requires exactly one pending holdout event');
    const events: HoldoutUse[] = [];
    for (let i = 0; i < files.length; i++) {
      const name = `${String(i).padStart(8, '0')}.json`;
      if (files[i] !== name) throw Error('Holdout sequence mismatch');
      const bytes = await readFile(
        await retainedEvidencePath(join(root, 'events'), name),
      );
      if (
        i === head.count &&
        outputIdentity(bytes) !== expectedPendingBytesDigest
      )
        throw Error('Pending holdout event bytes mismatch');
      events.push(holdoutUseSchema.parse(JSON.parse(bytes.toString('utf8'))));
    }
    if (holdoutLedgerDigest(events.slice(0, head.count)) !== head.digest)
      throw Error('Holdout prefix checkpoint mismatch');
    const next = {
      version: 1 as const,
      count: events.length,
      digest: holdoutLedgerDigest(events),
    };
    await inspectHoldoutLedger(root, next, next.digest);
    const staging = join(root, 'head-next.json');
    try {
      await durableJson(staging, next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const retained = await retainedEvidencePath(root, 'head-next.json');
      if (!(await readFile(retained)).equals(Buffer.from(canonicalJson(next))))
        throw Error('Interrupted holdout head bytes mismatch');
      const handle = await open(retained, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    await rename(staging, join(root, 'head.json'));
    await syncDirectory(root);
    return readHoldoutLedger(root, next.digest);
  });
}

async function appendHoldout(
  root: string,
  events: HoldoutUse[],
  event: HoldoutUse,
) {
  const path = join(
    root,
    'events',
    `${String(events.length).padStart(8, '0')}.json`,
  );
  await durableJson(path, holdoutUseSchema.parse(event));
  await syncDirectory(join(root, 'events'));
  const next = [...events, event];
  const seal = holdoutLedgerDigest(next);
  // Exclusive ledger lock plus atomic head swap; failed swap retains event and blocks reuse.
  await durableJson(join(root, 'head-next.json'), {
    version: 1,
    count: next.length,
    digest: seal,
  });
  await rename(join(root, 'head-next.json'), join(root, 'head.json'));
  await syncDirectory(root);
  return { event, digest: seal };
}
export async function preflightHoldout(
  root: string,
  c: z.infer<typeof benchmarkCaseSchema>,
  candidates: unknown,
  developmentContentDigests: string[],
  expectedDigest: string,
) {
  benchmarkCaseSchema.parse(c);
  if (c.split !== 'holdout') throw Error('Holdout case required');
  z.array(digest).parse(developmentContentDigests);
  const ledger = await readHoldoutLedger(root, expectedDigest);
  const contentDigest = benchmarkCaseContentDigest(c, candidates);
  if (developmentContentDigests.includes(contentDigest))
    throw Error('Development/holdout content overlap');
  if (ledger.events.some((e) => e.contentDigest === contentDigest))
    throw Error('Holdout content already consumed');
  return { fresh: true as const, contentDigest, ledgerDigest: ledger.digest };
}
export async function consumeHoldout(
  root: string,
  c: z.infer<typeof benchmarkCaseSchema>,
  candidates: unknown,
  suiteDigest: string,
  evaluatorDigest: string,
  claimId: string,
  consumptionId: string,
  expectedDigest: string,
) {
  benchmarkCaseSchema.parse(c);
  if (c.split !== 'holdout') throw Error('Holdout case required');
  return exclusive(root, async () => {
    const { events } = await readHoldoutLedger(root, expectedDigest);
    const contentDigest = benchmarkCaseContentDigest(c, candidates);
    if (events.some((e) => e.contentDigest === contentDigest))
      throw Error('Holdout content already consumed');
    const entry = {
      version: 1 as const,
      id: consumptionId,
      consumptionId,
      sequence: events.length,
      previousEntryDigest: events.length
        ? canonicalDigest('videobench/holdout-event-v1', events.at(-1)!)
        : '0'.repeat(64),
      contentDigest,
      case: videoBenchBinding('case', c),
      suiteDigest,
      evaluatorDigest,
      claimId,
      state: 'consumed' as const,
      usedForTuning: false,
      receiptDigest: canonicalDigest('videobench/holdout-reservation-v1', {
        contentDigest,
        suiteDigest,
        evaluatorDigest,
        claimId,
        consumptionId,
      }),
    };
    return appendHoldout(root, events, entry);
  });
}
export async function retireHoldout(
  root: string,
  consumptionId: string,
  retirementId: string,
  expectedDigest: string,
) {
  return exclusive(root, async () => {
    const { events } = await readHoldoutLedger(root, expectedDigest);
    const original = events.find(
      (e) => e.id === consumptionId && e.state === 'consumed',
    );
    if (
      !original ||
      events.some(
        (e) =>
          e.consumptionId === consumptionId &&
          e.state === 'retired-to-development',
      ) ||
      events.some((e) => e.id === retirementId)
    )
      throw Error('Invalid/duplicate retirement');
    return appendHoldout(root, events, {
      ...original,
      id: retirementId,
      sequence: events.length,
      previousEntryDigest: canonicalDigest(
        'videobench/holdout-event-v1',
        events.at(-1)!,
      ),
      state: 'retired-to-development',
      usedForTuning: true,
      receiptDigest: canonicalDigest('videobench/holdout-retirement-v1', {
        consumptionId,
        retirementId,
        original: original.receiptDigest,
      }),
    });
  });
}

/** Explicit CLI host trust arguments must be supplied independently of the protocol request. */
export async function videoBenchReviewCommand(args: string[]) {
  const [command, requestFile, ...rest] = args;
  const options = new Map<string, string>();
  if (!requestFile || rest.at(-1) !== '--json')
    throw Error('Review commands require request and --json');
  for (let i = 0; i < rest.length - 1; i += 2) {
    const key = rest[i]!,
      value = rest[i + 1];
    if (
      !key.startsWith('--') ||
      !value ||
      value.startsWith('--') ||
      options.has(key)
    )
      throw Error('Invalid/duplicate CLI option');
    options.set(key, value);
  }
  const get = (key: string) => {
    const value = options.get(key);
    if (!value) throw Error(`Missing ${key}`);
    return value;
  };
  if (command === 'holdout-init') {
    if (options.size) throw Error('Unknown holdout init option');
    await initializeHoldoutLedger(requestFile);
    return { digest: holdoutLedgerDigest([]), events: 0 };
  }
  if (command === 'holdout-retire') {
    const allowed = ['--ledger-digest', '--consumption-id', '--retirement-id'];
    if ([...options.keys()].some((k) => !allowed.includes(k)))
      throw Error('Unknown holdout retirement option');
    return retireHoldout(
      requestFile,
      id.parse(get('--consumption-id')),
      id.parse(get('--retirement-id')),
      digest.parse(get('--ledger-digest')),
    );
  }
  if (command === 'holdout-status') {
    if ([...options.keys()].some((k) => k !== '--ledger-digest'))
      throw Error('Unknown holdout status option');
    const ledger = await readHoldoutLedger(requestFile, get('--ledger-digest'));
    return {
      digest: ledger.digest,
      events: ledger.events.length,
      consumed: ledger.events.filter((e) => e.state === 'consumed').length,
      retired: ledger.events.filter((e) => e.state === 'retired-to-development')
        .length,
    };
  }
  if (command === 'holdout-preflight' || command === 'holdout-consume') {
    const allowed = [
      '--ledger',
      '--ledger-digest',
      ...(command === 'holdout-consume'
        ? ['--qualification-freeze', '--qualification-freeze-digest']
        : []),
    ];
    if ([...options.keys()].some((k) => !allowed.includes(k)))
      throw Error('Unknown holdout option');
    const input = z
      .object({
        case: benchmarkCaseSchema,
        candidates: z.array(benchmarkCandidateSchema).min(2),
        developmentContentDigests: z.array(digest),
        suiteDigest: digest,
        evaluatorDigest: digest,
        claimId: id,
        consumptionId: id,
      })
      .strict()
      .parse(JSON.parse(await readFile(requestFile, 'utf8')));
    const checked = await preflightHoldout(
      get('--ledger'),
      input.case,
      input.candidates,
      input.developmentContentDigests,
      get('--ledger-digest'),
    );
    if (command === 'holdout-preflight') return checked;
    const retained = JSON.parse(
      await readFile(get('--qualification-freeze'), 'utf8'),
    );
    const expected = digest.parse(get('--qualification-freeze-digest'));
    if (
      canonicalDigest(
        'videobench/qualification-freeze-v1',
        retained.artifact,
      ) !== expected ||
      retained.digest !== expected
    )
      throw Error('Qualification freeze mutation');
    if (
      retained.artifact.runtime.suiteDigest !== input.suiteDigest ||
      retained.artifact.runtime.evaluatorDigest !== input.evaluatorDigest ||
      retained.artifact.runtime.candidateCatalogDigest !==
        candidateCatalogDigest({ version: 1, candidates: input.candidates }) ||
      !retained.artifact.qualification.formalHoldoutMaterials.some(
        (m: { contentDigest: string }) =>
          m.contentDigest === checked.contentDigest,
      ) ||
      retained.artifact.qualification.developmentContentDigests.includes(
        checked.contentDigest,
      )
    )
      throw Error('Holdout consumption qualification binding mismatch');
    return consumeHoldout(
      get('--ledger'),
      input.case,
      input.candidates,
      input.suiteDigest,
      input.evaluatorDigest,
      input.claimId,
      input.consumptionId,
      checked.ledgerDigest,
    );
  }
  if (command === 'holdout-reconcile') {
    if (
      [...options.keys()].some(
        (k) => !['--ledger-digest', '--pending-bytes-digest'].includes(k),
      )
    )
      throw Error('Unknown reconciliation option');
    return reconcileHoldoutAppend(
      requestFile,
      get('--ledger-digest'),
      get('--pending-bytes-digest'),
    );
  }
  const allowed = [
    '--catalog',
    '--catalog-digest',
    '--suite-digest',
    '--evidence-seals',
    '--qualification-freeze',
    '--qualification-freeze-digest',
    '--qualification-inputs',
    '--ledger',
    '--ledger-digest',
    '--claim',
    ...(command === 'review-pack'
      ? ['--pack', '--output']
      : command === 'review-import'
        ? ['--pack', '--export', '--review', '--authority', '--attempt']
        : command === 'report'
          ? [
              '--exports',
              '--authority',
              '--ledger',
              '--ledger-digest',
              '--output',
              '--id',
              '--claim',
              '--qualification-freeze',
              '--qualification-freeze-digest',
              '--qualification-inputs',
            ]
          : command === 'qualification-freeze'
            ? ['--output']
            : []),
  ];
  if (
    ![
      'review-pack',
      'review-import',
      'report',
      'qualification-freeze',
    ].includes(command ?? '') ||
    [...options.keys()].some((k) => !allowed.includes(k))
  )
    throw Error('Unknown review command/option');
  const request = JSON.parse(
    await readFile(requestFile, 'utf8'),
  ) as ReviewProtocolRequest;
  const requestRoot = dirname(resolve(requestFile));
  request.bundles = request.bundles.map((b) => ({
    ...b,
    root: resolve(requestRoot, relativePathSchema.parse(b.root)),
  }));
  const trust: ReviewHostTrust = {
    catalog: JSON.parse(await readFile(get('--catalog'), 'utf8')),
    catalogDigest: get('--catalog-digest'),
    suiteDigest: get('--suite-digest'),
    evidenceSeals: JSON.parse(await readFile(get('--evidence-seals'), 'utf8')),
  };
  if (command === 'qualification-freeze') {
    if (
      [...options.keys()].some(
        (key) =>
          ![
            '--catalog',
            '--catalog-digest',
            '--suite-digest',
            '--evidence-seals',
            '--qualification-inputs',
            '--output',
          ].includes(key),
      )
    )
      throw Error('Unknown qualification freeze option');
    const frozen = createQualificationFreezeFromInputs(
      prepareReviewProtocolMetadata(request, trust),
      JSON.parse(await readFile(get('--qualification-inputs'), 'utf8')),
    );
    await durableJson(get('--output'), frozen);
    return { artifactWritten: true, digest: frozen.digest };
  }
  const authorityKeys = [
    '--qualification-freeze',
    '--qualification-freeze-digest',
    '--qualification-inputs',
  ];
  const hasAuthority = authorityKeys.some((key) => options.has(key));
  const qualification = hasAuthority
    ? {
        frozen: JSON.parse(
          await readFile(get('--qualification-freeze'), 'utf8'),
        ),
        expectedDigest: get('--qualification-freeze-digest'),
        currentInputs: JSON.parse(
          await readFile(get('--qualification-inputs'), 'utf8'),
        ),
        ledgerRoot: get('--ledger'),
        ledgerDigest: get('--ledger-digest'),
        claimId: get('--claim'),
      }
    : undefined;
  const p = await loadReviewProtocol(request, trust, qualification);
  if (command === 'review-pack')
    return materializeBlindReviewPack(p, get('--pack'), get('--output'));
  if (command === 'review-import')
    return importBlindReview(
      p,
      get('--pack'),
      join(get('--export'), 'review-pack'),
      await readFile(get('--review')),
      get('--authority'),
      get('--attempt'),
    );
  const freezeOptions = [
    '--qualification-freeze',
    '--qualification-freeze-digest',
    '--qualification-inputs',
  ];
  const hasFreeze = freezeOptions.some((key) => options.has(key));
  const formal = p.request.cases.some((c) => c.split === 'holdout');
  if ((hasFreeze || formal) && freezeOptions.some((key) => !options.has(key)))
    throw Error(
      'Qualification report requires freeze artifact, independently retained digest and current host inputs',
    );
  const qualificationFreeze = hasFreeze
    ? verifyQualificationReportInputs(
        JSON.parse(await readFile(get('--qualification-freeze'), 'utf8')),
        get('--qualification-freeze-digest'),
        p,
        JSON.parse(await readFile(get('--qualification-inputs'), 'utf8')),
      )
    : undefined;
  const exports = z
    .array(z.object({ packId: id, root: z.string() }).strict())
    .parse(JSON.parse(await readFile(get('--exports'), 'utf8')));
  const trusted = await loadTrustedReviews(p, get('--authority'), exports);
  const ledger = await readHoldoutLedger(
    get('--ledger'),
    get('--ledger-digest'),
  );
  const technical = p.bundles.map((b) => b.bundle.technical);
  // Phase 2 records keep their original tool fingerprint. It must equal the suite evaluator binding.
  const report = aggregateVideoBenchReport(get('--id'), get('--claim'), {
    ...p.context,
    evidence: p.evidence,
    reviews: [...trusted.reviews, ...technical],
    packs: trusted.packs,
    mappings: trusted.mappings,
    holdoutUses: ledger.events,
    expectedHoldoutLedgerDigest: ledger.digest,
    ...(qualificationFreeze
      ? { expectedQualificationFreezeDigest: qualificationFreeze.digest }
      : {}),
    requireQualificationFreeze: formal,
  });
  await durableJson(get('--output'), report);
  return { materialized: true, report };
}
