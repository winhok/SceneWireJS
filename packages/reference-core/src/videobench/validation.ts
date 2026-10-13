import { z } from 'zod';
import { canonicalDigest, canonicalJson } from '@scenewirejs/production-core';
import { benchmarkCandidateSchema, type BenchmarkCandidate } from './candidate';
import { benchmarkCaseSchema, type BenchmarkCase } from './case';
import {
  evaluationProfileSchema,
  CORE_DIMENSIONS,
  type EvaluationProfile,
} from './profile';
import {
  benchmarkSuiteSchema,
  holdoutUseSchema,
  type BenchmarkSuite,
} from './suite';
import { videoBenchEvidenceSchema, type VideoBenchEvidence } from './evidence';
import {
  blindReviewPackSchema,
  blindIdentityMappingSchema,
  reviewRecordSchema,
  type CreativeReviewRecord,
  type BlindIdentityMapping,
} from './review';
import { videoBenchReportSchema, type VideoBenchReport } from './report';
import type { DigestBinding } from './common';

/** Digests seal records using the existing production finite-JSON convention. */
export function videoBenchDigest(
  kind:
    | 'candidate'
    | 'profile'
    | 'case'
    | 'suite'
    | 'review-pack'
    | 'blind-mapping'
    | 'evidence',
  value: unknown,
): string {
  const schemas = {
    candidate: benchmarkCandidateSchema,
    profile: evaluationProfileSchema,
    case: benchmarkCaseSchema,
    suite: benchmarkSuiteSchema,
    'review-pack': blindReviewPackSchema,
    'blind-mapping': blindIdentityMappingSchema,
    evidence: videoBenchEvidenceSchema,
  };
  // Check before parsing: unknown fields, accessors and non-JSON values cannot vanish into a seal.
  canonicalJson(value);
  const parsed = schemas[kind].parse(value);
  return canonicalDigest(`videobench/${kind}-v1`, parsed);
}
export function videoBenchBinding(
  kind: 'candidate' | 'profile' | 'case' | 'suite' | 'review-pack',
  value: { id: string },
): DigestBinding {
  return { id: value.id, digest: videoBenchDigest(kind, value) };
}
/** Evidence aliases resolve privately; the input seal includes exact frozen sources, without exposing them. */
export function blindInputBundleDigest(
  packInput: unknown,
  evidenceInput: unknown,
  mappingInput: unknown,
): string {
  canonicalJson(packInput);
  canonicalJson(evidenceInput);
  canonicalJson(mappingInput);
  const pack = blindReviewPackSchema.parse(packInput),
    mapping = blindIdentityMappingSchema.parse(mappingInput),
    evidence = z.array(videoBenchEvidenceSchema).parse(evidenceInput);
  const ids = [...pack.evidenceA, ...pack.evidenceB];
  if (new Set(ids).size !== ids.length || mapping.aliases.length !== ids.length)
    throw new Error('Duplicate/extra blind evidence alias');
  const selected = ids.map((aliasId) => {
    const aliases = mapping.aliases.filter((a) => a.aliasId === aliasId);
    if (aliases.length !== 1)
      throw new Error('Unknown/duplicate blind evidence alias');
    const matches = evidence.filter(
      (e) => e.id === aliases[0]!.sourceEvidenceId,
    );
    if (matches.length !== 1 || matches[0]!.kind === 'diagnostic')
      throw new Error('Unknown/duplicate/ineligible blind source');
    return { aliasId, source: matches[0]! };
  });
  return canonicalDigest('videobench/blind-input-v1', {
    packDigest: videoBenchDigest('review-pack', pack),
    mappingDigest: videoBenchDigest('blind-mapping', mapping),
    evidence: selected,
  });
}
function blindBundleMatches(
  pack: unknown,
  evidence: unknown,
  mapping: unknown,
  expected: string,
) {
  try {
    return blindInputBundleDigest(pack, evidence, mapping) === expected;
  } catch {
    return false;
  }
}
/** Holdout material identity ignores names, split, rubric, profile and evaluator changes. */
export function benchmarkCaseContentDigest(
  caseInput: unknown,
  candidateInputs: unknown,
): string {
  canonicalJson(caseInput);
  canonicalJson(candidateInputs);
  const c = benchmarkCaseSchema.parse(caseInput),
    candidates = z.array(benchmarkCandidateSchema).parse(candidateInputs);
  const inputs = [...new Set(c.inputs.map((i) => i.sha256))].sort();
  if (inputs.length)
    return canonicalDigest('videobench/holdout-content-v1', { inputs });
  const baseline = candidates.find((x) => x.id === c.baseline.id);
  if (
    !baseline ||
    videoBenchDigest('candidate', baseline) !== c.baseline.digest
  )
    throw new Error('Unknown content candidate binding');
  return canonicalDigest('videobench/holdout-content-v1', {
    baselineOutput: baseline.renderDigest,
  });
}
export function holdoutLedgerDigest(input: unknown): string {
  canonicalJson(input);
  return canonicalDigest(
    'videobench/holdout-ledger-v1',
    z.array(holdoutUseSchema).parse(input),
  );
}
export interface VideoBenchProtocolContext {
  /** Independently trusted authority, not read from an untrusted report/suite. */
  expectedSuiteDigest: string;
  candidates: unknown;
  profiles: unknown;
  cases: unknown;
}
export interface VideoBenchReportContext extends VideoBenchProtocolContext {
  /** Independently verified qualification-freeze-v1 authority. */
  expectedQualificationFreezeDigest?: string;
  /** Historical/synthetic V1 holdout records are not formal qualification. */
  requireQualificationFreeze?: boolean;
  suite: unknown;
  evidence: unknown;
  reviews: unknown;
  packs: unknown;
  mappings: unknown;
  /** Trusted ledger supplied by the host. Persistence/authentication belongs to future tooling. */
  holdoutUses: unknown;
  expectedHoldoutLedgerDigest: string;
}
export interface VideoBenchValidation<T> {
  valid: boolean;
  errors: string[];
  value?: T;
}
function parse<T>(
  schema: z.ZodType<T>,
  input: unknown,
  errors: string[],
  label: string,
): T | undefined {
  try {
    canonicalJson(input);
  } catch {
    errors.push(`${label}: finite JSON data required`);
    return;
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    errors.push(
      ...result.error.issues.map(
        (i) => `${label}.${i.path.join('.')}: ${i.message}`,
      ),
    );
    return;
  }
  return result.data;
}
function unique(ids: string[], errors: string[], label: string) {
  if (new Set(ids).size !== ids.length) errors.push(`Duplicate ${label}`);
}
function same(a: unknown, b: unknown) {
  return canonicalJson(a) === canonicalJson(b);
}
function bound(
  binding: DigestBinding,
  kind: 'candidate' | 'profile' | 'case',
  records: Map<string, BenchmarkCandidate | EvaluationProfile | BenchmarkCase>,
  errors: string[],
) {
  const value = records.get(binding.id);
  if (!value || videoBenchDigest(kind, value) !== binding.digest)
    errors.push(`${kind} identity/digest mismatch: ${binding.id}`);
}
interface Protocol {
  suite: BenchmarkSuite;
  candidates: BenchmarkCandidate[];
  profiles: EvaluationProfile[];
  cases: BenchmarkCase[];
}
function protocol(
  input: unknown,
  ctx: VideoBenchProtocolContext,
  errors: string[],
): Protocol | undefined {
  const suite = parse(benchmarkSuiteSchema, input, errors, 'suite');
  const candidates = parse(
    z.array(benchmarkCandidateSchema),
    ctx.candidates,
    errors,
    'candidates',
  );
  const profiles = parse(
    z.array(evaluationProfileSchema),
    ctx.profiles,
    errors,
    'profiles',
  );
  const cases = parse(z.array(benchmarkCaseSchema), ctx.cases, errors, 'cases');
  if (!suite || !candidates || !profiles || !cases) return;
  if (videoBenchDigest('suite', suite) !== ctx.expectedSuiteDigest)
    errors.push('Trusted suite digest mismatch');
  for (const [label, records] of [
    ['candidates', candidates],
    ['profiles', profiles],
    ['cases', cases],
  ] as const)
    unique(
      records.map((x) => x.id),
      errors,
      label,
    );
  const cm = new Map(candidates.map((x) => [x.id, x])),
    pm = new Map(profiles.map((x) => [x.id, x])),
    bm = new Map(cases.map((x) => [x.id, x]));
  unique(
    suite.cases.map((x) => x.id),
    errors,
    'suite cases',
  );
  unique(
    suite.profiles.map((x) => x.id),
    errors,
    'suite profiles',
  );
  unique(suite.dimensionRegistry, errors, 'dimension registry');
  // Only core IDs or explicitly versioned extensions may be registered.
  for (const id of suite.dimensionRegistry)
    if (
      !CORE_DIMENSIONS.some((x) => x === id) &&
      !/^x-[a-z0-9-]+\/v[1-9][0-9]*$/.test(id)
    )
      errors.push(`Unknown dimension: ${id}`);
  for (const b of suite.cases) bound(b, 'case', bm, errors);
  for (const b of suite.profiles) bound(b, 'profile', pm, errors);
  if (
    !same(suite.cases.map((x) => x.id).sort(), cases.map((x) => x.id).sort()) ||
    !same(
      suite.profiles.map((x) => x.id).sort(),
      profiles.map((x) => x.id).sort(),
    )
  )
    errors.push('Catalog differs from suite inventory');
  for (const p of profiles)
    for (const d of p.dimensions)
      if (!suite.dimensionRegistry.includes(d.id))
        errors.push(`Unregistered profile dimension: ${d.id}`);
  for (const c of cases) {
    bound(c.profile, 'profile', pm, errors);
    bound(c.baseline, 'candidate', cm, errors);
    bound(c.candidate, 'candidate', cm, errors);
    const p = pm.get(c.profile.id);
    if (!suite.profiles.some((x) => same(x, c.profile)))
      errors.push('Case profile not sealed by suite');
    if (
      !same(
        c.requiredDimensions.slice().sort(),
        c.evidencePlan.map((x) => x.dimensionId).sort(),
      )
    )
      errors.push('Evidence plan must cover exact required dimensions');
    for (const d of c.requiredDimensions) {
      const pd = p?.dimensions.find((x) => x.id === d),
        plan = c.evidencePlan.find((x) => x.dimensionId === d);
      if (!pd || !suite.dimensionRegistry.includes(d))
        errors.push(`Unknown case dimension: ${d}`);
      if (plan) {
        unique(plan.kinds, errors, 'evidence plan kinds');
        if (pd?.requiredEvidence.some((k) => !plan.kinds.includes(k)))
          errors.push('Plan omits profile-required evidence');
      }
    }
    for (const r of c.readIntents)
      if (
        r.timeRange.endMs >
        Math.min(
          cm.get(c.baseline.id)?.durationMs ?? 0,
          cm.get(c.candidate.id)?.durationMs ?? 0,
        )
      )
        errors.push('ReadIntent outside comparable duration');
    for (const control of c.controls) {
      if (!c.requiredDimensions.includes(control.dimensionId))
        errors.push('Control dimension not in case');
      unique(control.requiredEvidenceKinds, errors, 'control kinds');
    }
    const schedules = suite.schedule.filter((x) => x.caseId === c.id);
    if (schedules.length !== suite.replicatePolicy.count)
      errors.push(`Missing/extra scheduled replicate: ${c.id}`);
    unique(
      schedules.map((x) => x.reviewReplicateId),
      errors,
      'replicate schedule',
    );
    for (const s of schedules) {
      if (
        s.reviews.length !== suite.reviewProtocol.creativeReviewersPerReplicate
      )
        errors.push('Reviewer count differs from frozen protocol');
      unique(
        s.reviews.map((x) => x.reviewerId),
        errors,
        'independent reviewer identities',
      );
    }
  }
  for (const [label, plans] of [
    ['evidence bundles', suite.evidenceBundles],
    ['review evidence plans', suite.reviewEvidencePlan],
  ] as const) {
    unique(
      plans.map((x) => x.caseId),
      errors,
      label,
    );
    if (!same(plans.map((x) => x.caseId).sort(), cases.map((x) => x.id).sort()))
      errors.push(`Missing/extra ${label}`);
    for (const plan of plans) {
      unique(
        plan.arms.map((a) => a.arm),
        errors,
        `${label} arms`,
      );
    }
  }
  for (const bundle of suite.evidenceBundles) {
    const c = bm.get(bundle.caseId);
    if (!c) continue;
    for (const arm of bundle.arms) {
      if (!same(arm.candidate, c[arm.arm]))
        errors.push('Frozen evidence candidate/cross-arm mismatch');
      unique(
        arm.evidence.map((e) => e.id),
        errors,
        'frozen evidence IDs',
      );
    }
  }
  for (const plan of suite.reviewEvidencePlan) {
    const bundle = suite.evidenceBundles.find((b) => b.caseId === plan.caseId);
    for (const arm of plan.arms) {
      unique(arm.evidenceIds, errors, 'review-eligible evidence');
      if (
        arm.evidenceIds.some(
          (id) =>
            !bundle?.arms
              .find((a) => a.arm === arm.arm)
              ?.evidence.some((e) => e.id === id),
        )
      )
        errors.push('Review selection outside frozen evidence inventory');
    }
  }
  const assignments = suite.schedule.flatMap((s) => s.reviews);
  unique(
    assignments.map((x) => x.packId),
    errors,
    'review pack assignments',
  );
  for (const s of suite.schedule)
    if (!bm.has(s.caseId)) errors.push('Unknown scheduled case');
  return { suite, candidates, profiles, cases };
}
export function validateBenchmarkSuite(
  input: unknown,
  context: VideoBenchProtocolContext,
): VideoBenchValidation<BenchmarkSuite> {
  const errors: string[] = [];
  const p = protocol(input, context, errors);
  return { valid: !errors.length, errors, ...(p ? { value: p.suite } : {}) };
}
function evidenceChecks(
  evidence: VideoBenchEvidence[],
  p: Protocol,
  errors: string[],
) {
  unique(
    evidence.map((e) => e.id),
    errors,
    'evidence IDs',
  );
  const sealed = p.suite.evidenceBundles.flatMap((b) =>
    b.arms.flatMap((a) => a.evidence),
  );
  unique(
    sealed.map((e) => e.id),
    errors,
    'sealed evidence IDs',
  );
  if (!same(sealed.map((e) => e.id).sort(), evidence.map((e) => e.id).sort()))
    errors.push('Missing/extra frozen evidence');
  for (const binding of sealed) {
    const e = evidence.find((e) => e.id === binding.id);
    if (!e || videoBenchDigest('evidence', e) !== binding.digest)
      errors.push('Frozen evidence digest mismatch');
  }
  for (const plan of p.suite.reviewEvidencePlan) {
    const c = p.cases.find((c) => c.id === plan.caseId),
      profile = p.profiles.find((p) => p.id === c?.profile.id);
    for (const arm of plan.arms) {
      const selected = arm.evidenceIds.map((id) =>
        evidence.find((e) => e.id === id),
      );
      if (
        selected.some(
          (e) =>
            !e ||
            e.kind === 'diagnostic' ||
            e.caseId !== plan.caseId ||
            e.arm !== arm.arm,
        )
      )
        errors.push('Ineligible diagnostic/out-of-scope creative evidence');
      for (const d of profile?.dimensions ?? []) {
        if (!d.applicable || !c?.requiredDimensions.includes(d.id)) continue;
        if (
          d.requiredEvidence
            .filter((k) => k !== 'diagnostic')
            .some((k) => !selected.some((e) => e?.kind === k))
        )
          errors.push('Review evidence plan omits dimension evidence');
        if (
          [
            'comprehension-timing',
            'motion-continuity',
            'transition-quality',
          ].includes(d.id) &&
          !selected.some((e) => e?.kind === 'frame-strip')
        )
          errors.push('Creative temporal review requires frame strip');
      }
    }
  }
  for (const bundle of p.suite.evidenceBundles)
    for (const arm of bundle.arms)
      for (const binding of arm.evidence) {
        const e = evidence.find((e) => e.id === binding.id);
        if (
          !e ||
          e.caseId !== bundle.caseId ||
          e.arm !== arm.arm ||
          !same(e.candidate, arm.candidate)
        )
          errors.push('Frozen evidence scope/candidate mismatch');
      }
  const frames = evidence.flatMap((e) =>
    e.kind === 'representative-frames'
      ? e.frames.map((f) => ({ f: f.frame, parent: e }))
      : [],
  );
  unique(
    [...evidence.map((e) => e.id), ...frames.map((x) => x.f.id)],
    errors,
    'artifact/frame IDs',
  );
  const fm = new Map(frames.map((x) => [x.f.id, x]));
  for (const e of evidence) {
    const c = p.cases.find((c) => c.id === e.caseId),
      bc = p.candidates.find((c) => c.id === e.candidate.id);
    if (!c || !bc || !same(e.candidate, c[e.arm])) {
      errors.push(`Evidence candidate/scope mismatch: ${e.id}`);
      continue;
    }
    if (
      e.sourceSha256 !== bc.binding.sourceSha256 ||
      e.outputDigest !== bc.renderDigest
    )
      errors.push('Evidence source/output digest mismatch');
    if (!same(e.capture.environment ?? null, bc.environment ?? null))
      errors.push('Capture/candidate environment mismatch');
    if (
      !c.evidencePlan.some((x) => x.kinds.includes(e.kind)) &&
      !c.controls.some((x) => x.requiredEvidenceKinds.includes(e.kind))
    )
      errors.push('Unplanned evidence kind');
    if (e.kind === 'representative-frames') {
      let previous = -1;
      for (const { frame: f } of e.frames) {
        if (
          f.timeMs <= previous ||
          f.timeMs >= bc.durationMs ||
          f.sourceSha256 !== bc.renderDigest
        )
          errors.push('Representative frame time/output binding invalid');
        if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(f.id))
          errors.push('Non-opaque frame ID');
        previous = f.timeMs;
      }
    } else if (e.kind === 'contact-sheet' || e.kind === 'frame-strip') {
      unique(e.frameIds, errors, 'artifact frame IDs');
      let previous = -1;
      const selected = e.frameIds.map((id) => fm.get(id));
      for (const x of selected) {
        if (!x) {
          errors.push('Unknown artifact frame reference');
          continue;
        }
        if (
          x.parent.caseId !== e.caseId ||
          x.parent.arm !== e.arm ||
          !same(x.parent.candidate, e.candidate) ||
          !same(x.parent.capture, e.capture)
        )
          errors.push('Artifact references frame outside scope/capture');
        if (x.f.timeMs <= previous)
          errors.push('Artifact frames must be strictly chronological');
        previous = x.f.timeMs;
      }
      if (e.kind === 'contact-sheet' && e.labels.length !== e.frameIds.length)
        errors.push('Contact-sheet labels must cover all frames');
      if (e.kind === 'frame-strip') {
        if (e.range.endMs > bc.durationMs)
          errors.push('Frame strip outside candidate duration');
        const count =
          Math.floor((e.range.endMs - e.range.startMs) / e.cadenceMs) + 1;
        if (
          count !== selected.length ||
          selected.some(
            (x, i) =>
              !x ||
              Math.abs(x.f.timeMs - (e.range.startMs + i * e.cadenceMs)) > 1e-6,
          )
        )
          errors.push('Frame strip cadence/range mismatch');
      }
    } else {
      unique(
        e.findings.map((f) => f.id),
        errors,
        'diagnostic findings',
      );
      for (const m of e.measurements) {
        const pd = p.profiles
            .find((x) => x.id === c.profile.id)
            ?.dimensions.find((d) => d.id === m.dimensionId),
          definition = pd?.measurements.find((x) => x.id === m.measurementId);
        if (
          !c.requiredDimensions.includes(m.dimensionId) ||
          !definition ||
          definition.unit !== m.unit
        )
          errors.push('Unregistered diagnostic measurement/unit');
      }
      for (const finding of e.findings)
        for (const id of finding.evidenceIds) {
          const parent =
            evidence.find((x) => x.id === id) ?? fm.get(id)?.parent;
          if (!parent || parent.caseId !== e.caseId || parent.arm !== e.arm)
            errors.push('Unknown/out-of-scope diagnostic evidence');
        }
    }
  }
  return { frames, fm };
}
/** Contextual evidence check without materializing or decoding media. */
export function validateVideoBenchEvidence(
  input: unknown,
  context: VideoBenchProtocolContext & { suite: unknown },
): VideoBenchValidation<VideoBenchEvidence[]> {
  const errors: string[] = [];
  const p = protocol(context.suite, context, errors);
  const evidence = parse(
    z.array(videoBenchEvidenceSchema),
    input,
    errors,
    'evidence',
  );
  if (p && evidence) evidenceChecks(evidence, p, errors);
  return {
    valid: !errors.length,
    errors,
    ...(evidence ? { value: evidence } : {}),
  };
}
// A contract rule, not a benchmark runner or statistical confidence estimator.
function consensus(votes: string[]): string {
  return votes.length && votes.every((x) => x === votes[0])
    ? votes[0]!
    : 'inconclusive';
}
function mappedVerdict(
  r: CreativeReviewRecord,
  d: string,
  m: BlindIdentityMapping,
): string {
  const v = r.dimensions.find((x) => x.dimensionId === d)!.verdict;
  return v === 'A' || v === 'B'
    ? m[v] === 'candidate'
      ? 'improved'
      : 'regressed'
    : v;
}
export function validateVideoBenchReport(
  input: unknown,
  context: VideoBenchReportContext,
): VideoBenchValidation<VideoBenchReport> {
  const errors: string[] = [];
  const p = protocol(context.suite, context, errors);
  const report = parse(videoBenchReportSchema, input, errors, 'report');
  const evidence = parse(
    z.array(videoBenchEvidenceSchema),
    context.evidence,
    errors,
    'evidence',
  );
  const reviews = parse(
    z.array(reviewRecordSchema),
    context.reviews,
    errors,
    'reviews',
  );
  const packs = parse(
    z.array(blindReviewPackSchema),
    context.packs,
    errors,
    'packs',
  );
  const mappings = parse(
    z.array(blindIdentityMappingSchema),
    context.mappings,
    errors,
    'mappings',
  );
  const uses = parse(
    z.array(holdoutUseSchema),
    context.holdoutUses,
    errors,
    'holdoutUses',
  );
  if (
    errors.length ||
    !p ||
    !report ||
    !evidence ||
    !reviews ||
    !packs ||
    !mappings ||
    !uses
  )
    return { valid: false, errors };
  if (report.version === 2) {
    if (
      !context.expectedQualificationFreezeDigest ||
      report.qualificationFreezeDigest !==
        context.expectedQualificationFreezeDigest
    )
      errors.push('Report qualification freeze authority mismatch');
  } else if (
    context.expectedQualificationFreezeDigest ||
    context.requireQualificationFreeze
  ) {
    errors.push('Formal qualification requires Report V2 freeze binding');
  }
  const { suite, candidates, profiles, cases } = p;
  const { fm } = evidenceChecks(evidence, p, errors);
  const em = new Map(evidence.map((e) => [e.id, e]));
  const parent = (id: string) => em.get(id) ?? fm.get(id)?.parent;
  const scoped = (id: string, c: string, arm?: string) => {
    const e = parent(id);
    return !!e && e.caseId === c && (!arm || e.arm === arm);
  };
  if (report.suiteDigest !== context.expectedSuiteDigest)
    errors.push('Report suite digest mismatch');
  if (!same(report.profiles, suite.profiles))
    errors.push('Report profile bindings mismatch');
  const usedCandidates = [
    ...new Set(cases.flatMap((c) => [c.baseline.id, c.candidate.id])),
  ].sort();
  if (!same(report.candidates.map((x) => x.id).sort(), usedCandidates))
    errors.push('Report candidate inventory mismatch');
  const cm = new Map(candidates.map((x) => [x.id, x]));
  for (const b of report.candidates) bound(b, 'candidate', cm, errors);
  unique(
    report.sections.map((x) => x.split),
    errors,
    'report split sections',
  );
  for (const split of ['development', 'holdout', 'negative-control'] as const)
    if (!report.sections.some((s) => s.split === split))
      errors.push('Missing separate split section');
  unique(
    reviews.map((r) => r.id),
    errors,
    'review IDs',
  );
  unique(
    packs.map((x) => x.id),
    errors,
    'review packs',
  );
  unique(
    mappings.map((x) => x.packId),
    errors,
    'private mappings',
  );
  const creative = reviews.filter(
    (r): r is CreativeReviewRecord => r.reviewerType !== 'deterministic',
  );
  const assignments = suite.schedule.flatMap((s) =>
    s.reviews.map((a) => ({ s, a })),
  );
  if (
    creative.length !== assignments.length ||
    packs.length !== assignments.length ||
    mappings.length !== assignments.length
  )
    errors.push('Missing/extra scheduled review, pack or mapping');
  for (const { s, a } of assignments) {
    const matching = creative.filter(
      (r) =>
        r.caseId === s.caseId &&
        r.reviewReplicateId === s.reviewReplicateId &&
        r.reviewerId === a.reviewerId,
    );
    if (matching.length !== 1)
      errors.push('Missing/duplicate scheduled review');
    const pack = packs.find((x) => x.id === a.packId),
      mapping = mappings.find((x) => x.packId === a.packId);
    if (!pack || !mapping) {
      errors.push('Missing blind pack/mapping');
      continue;
    }
    if (
      pack.caseId !== s.caseId ||
      pack.reviewReplicateId !== s.reviewReplicateId ||
      mapping.caseId !== s.caseId ||
      mapping.reviewReplicateId !== s.reviewReplicateId ||
      videoBenchDigest('review-pack', pack) !== a.packDigest ||
      videoBenchDigest('blind-mapping', mapping) !== a.mappingDigest ||
      !blindBundleMatches(pack, evidence, mapping, a.inputBundleDigest)
    )
      errors.push('Blind pack/mapping binding mismatch');
    if (pack.reviewTemplateDigest !== suite.reviewProtocol.reviewTemplateDigest)
      errors.push('Review template mismatch');
    const c = cases.find((c) => c.id === s.caseId)!;
    if (
      !same(
        pack.rubric.map((d) => d.dimensionId).sort(),
        c.requiredDimensions.slice().sort(),
      )
    )
      errors.push('Blind rubric dimension mismatch');
    unique(
      [...pack.evidenceA, ...pack.evidenceB],
      errors,
      'blind evidence aliases',
    );
    unique(
      mapping.aliases.map((a) => a.aliasId),
      errors,
      'private aliases',
    );
    unique(
      mapping.aliases.map((a) => a.sourceEvidenceId),
      errors,
      'private alias sources',
    );
    if (
      !same(
        mapping.aliases.map((a) => a.aliasId).sort(),
        [...pack.evidenceA, ...pack.evidenceB].sort(),
      )
    )
      errors.push('Private alias inventory differs from judge pack');
    for (const position of ['A', 'B'] as const) {
      const ids = pack[position === 'A' ? 'evidenceA' : 'evidenceB'];
      const expected =
        suite.reviewEvidencePlan
          .find((p) => p.caseId === s.caseId)
          ?.arms.find((a) => a.arm === mapping[position])?.evidenceIds ?? [];
      const resolved = ids.map(
        (id) =>
          mapping.aliases.find((a) => a.aliasId === id)?.sourceEvidenceId ?? '',
      );
      if (
        !same(resolved.slice().sort(), expected.slice().sort()) ||
        resolved.some(
          (id) =>
            !scoped(id, s.caseId, mapping[position]) ||
            parent(id)?.kind === 'diagnostic',
        )
      )
        errors.push(
          'Blind pack differs from frozen review evidence plan/cross-arm reuse',
        );
    }
    // Structural leakage detection. Semantic authenticity still requires independent review.
    const secretValues = candidates
      .flatMap((x) => [
        x.id,
        x.projectId,
        x.binding.projectSha256,
        x.binding.sourceSha256!,
        x.renderDigest,
        x.sourceCommit ?? '',
      ])
      .filter((x) => x.length >= 4);
    const judgeText = [
      pack.id,
      pack.caseId,
      pack.reviewReplicateId,
      ...pack.evidenceA,
      ...pack.evidenceB,
      pack.context,
      ...pack.rubric.map((x) => x.instructions),
    ].join(' ');
    if (
      /\b(?:baseline|candidate|branch|git|v\d+\.\d+)\b|[a-f0-9]{40,64}|(?:^|\s)(?:\/|[A-Za-z]:\\)/i.test(
        judgeText,
      ) ||
      secretValues.some((v) => judgeText.includes(v))
    )
      errors.push('A/B identity leakage in blind context/rubric');
    for (const r of matching) {
      if (
        r.reviewerType !== a.reviewerClass ||
        r.identityClass !== a.identityClass ||
        r.packId !== a.packId ||
        r.packDigest !== a.packDigest
      )
        errors.push('Reviewer assignment mismatch');
      if (r.reviewerType === 'external-agent' && !same(r.agent, a.agent))
        errors.push('Agent config differs from frozen assignment');
      if (
        r.receipt.workspacePolicy !== suite.reviewProtocol.workspacePolicy ||
        r.receipt.inputBundleDigest !== a.inputBundleDigest ||
        r.receipt.reviewTemplateDigest !==
          suite.reviewProtocol.reviewTemplateDigest
      )
        errors.push('Isolation receipt mismatch');
      if (
        secretValues.some((v) =>
          r.dimensions.some((d) => d.rationale.includes(v)),
        ) ||
        r.dimensions.some((d) =>
          /\b(?:baseline|candidate|branch|git|v\d+\.\d+)\b|[a-f0-9]{40,64}/i.test(
            d.rationale,
          ),
        )
      )
        errors.push('A/B identity leakage in review rationale');
      unique(
        r.dimensions.map((d) => d.dimensionId),
        errors,
        'review dimensions',
      );
      if (
        !same(
          r.dimensions.map((x) => x.dimensionId).sort(),
          c.requiredDimensions.slice().sort(),
        )
      )
        errors.push('Review dimensions do not cover case');
      for (const d of r.dimensions) {
        unique(d.evidenceIds, errors, 'review evidence');
        if (
          d.evidenceIds.some(
            (id) =>
              !scoped(
                mapping.aliases.find((a) => a.aliasId === id)
                  ?.sourceEvidenceId ?? '',
                s.caseId,
              ) || ![...pack.evidenceA, ...pack.evidenceB].includes(id),
          ) ||
          (['baseline', 'candidate'] as const).some(
            (arm) =>
              !d.evidenceIds.some((id) =>
                scoped(
                  mapping.aliases.find((a) => a.aliasId === id)
                    ?.sourceEvidenceId ?? '',
                  s.caseId,
                  arm,
                ),
              ),
          )
        )
          errors.push('Review references evidence outside case/pack');
        const pd = profiles
          .find((x) => x.id === c.profile.id)
          ?.dimensions.find((x) => x.id === d.dimensionId);
        if (
          !pd ||
          (pd.applicable
            ? d.verdict === 'not-applicable'
            : d.verdict !== 'not-applicable')
        )
          errors.push('Review applicability mismatch');
      }
    }
  }
  for (const r of creative)
    if (
      !assignments.some(
        ({ s, a }) =>
          s.caseId === r.caseId &&
          s.reviewReplicateId === r.reviewReplicateId &&
          a.reviewerId === r.reviewerId,
      )
    )
      errors.push('Unscheduled creative review');
  for (const r of reviews)
    if (r.reviewerType === 'deterministic') {
      const c = cases.find((c) => c.id === r.caseId),
        profile = profiles.find((p) => p.id === c?.profile.id);
      if (r.toolDigest !== suite.evaluatorDigest || !c)
        errors.push('Unbound deterministic reviewer');
      unique(r.evidenceIds, errors, 'deterministic evidence');
      unique(
        r.findings.map((f) => f.targetId),
        errors,
        'deterministic finding targets',
      );
      if (r.evidenceIds.some((id) => !scoped(id, r.caseId, r.arm)))
        errors.push('Deterministic evidence outside arm');
      for (const f of r.findings)
        if (f.gateId && !profile?.technicalGates.some((g) => g.id === f.gateId))
          errors.push('Unknown mechanical technical gate');
    }
  const reportedCases = report.sections.flatMap((s) =>
    s.cases.map((c) => ({ split: s.split, entry: c })),
  );
  unique(
    reportedCases.map((c) => c.entry.case.id),
    errors,
    'reported cases',
  );
  if (
    !same(
      reportedCases.map((c) => c.entry.case.id).sort(),
      cases.map((c) => c.id).sort(),
    )
  )
    errors.push('Missing/extra reported case');
  for (const { split, entry } of reportedCases) {
    const c = cases.find((c) => c.id === entry.case.id);
    if (!c) {
      errors.push('Unknown reported case');
      continue;
    }
    if (
      split !== c.split ||
      !same(
        entry.case,
        suite.cases.find((x) => x.id === c.id),
      )
    )
      errors.push('Authoritative split/case mismatch');
    const schedules = suite.schedule.filter((x) => x.caseId === c.id);
    unique(
      entry.reviewReplicates.map((x) => x.reviewReplicateId),
      errors,
      'reported replicates',
    );
    if (
      !same(
        entry.reviewReplicates.map((x) => x.reviewReplicateId).sort(),
        schedules.map((x) => x.reviewReplicateId).sort(),
      )
    )
      errors.push('Missing/extra replicate or selective inclusion');
    unique(
      entry.arms.map((a) => a.arm),
      errors,
      'case evidence arms',
    );
    for (const arm of entry.arms) {
      if (!same(arm.candidate, c[arm.arm]))
        errors.push('Reported candidate digest/cross-arm mismatch');
      const expected = evidence.filter(
        (e) => e.caseId === c.id && e.arm === arm.arm,
      );
      unique(arm.evidenceIds, errors, 'arm evidence IDs');
      if (
        !same(arm.evidenceIds.slice().sort(), expected.map((e) => e.id).sort())
      )
        errors.push('Selective/missing/cross-arm evidence');
      for (const plan of c.evidencePlan)
        if (plan.kinds.some((k) => !expected.some((e) => e.kind === k)))
          errors.push('Required dimension evidence missing');
    }
    for (const rep of entry.reviewReplicates) {
      const expected = creative
        .filter(
          (r) =>
            r.caseId === c.id && r.reviewReplicateId === rep.reviewReplicateId,
        )
        .map((r) => r.id)
        .sort();
      unique(rep.reviewIds, errors, 'replicate review IDs');
      if (!same(rep.reviewIds.slice().sort(), expected))
        errors.push('Selective/missing replicate reviews');
    }
    unique(
      entry.dimensions.map((x) => x.dimensionId),
      errors,
      'dimension results',
    );
    if (
      !same(
        entry.dimensions.map((x) => x.dimensionId).sort(),
        c.requiredDimensions.slice().sort(),
      )
    )
      errors.push('Missing/extra dimension results');
    for (const d of entry.dimensions) {
      const rs = creative.filter((r) => r.caseId === c.id);
      if (
        rs.some(
          (r) => !r.dimensions.some((x) => x.dimensionId === d.dimensionId),
        ) ||
        rs.some((r) => !mappings.some((m) => m.packId === r.packId))
      )
        continue;
      const groups = schedules.map((s) =>
        rs.filter((r) => r.reviewReplicateId === s.reviewReplicateId),
      );
      const votes = groups.map((g) =>
        g.map((r) =>
          mappedVerdict(
            r,
            d.dimensionId,
            mappings.find((m) => m.packId === r.packId)!,
          ),
        ),
      );
      const result = consensus(votes.map((v) => consensus(v)));
      const refs = [
        ...new Set(
          rs.flatMap((r) =>
            r.dimensions
              .find((x) => x.dimensionId === d.dimensionId)!
              .evidenceIds.map(
                (alias) =>
                  mappings
                    .find((m) => m.packId === r.packId)!
                    .aliases.find((a) => a.aliasId === alias)
                    ?.sourceEvidenceId ?? '',
              ),
          ),
        ),
      ].sort();
      unique(d.evidenceIds, errors, 'result evidence');
      unique(d.reviewIds, errors, 'result reviews');
      if (
        d.result !== result ||
        d.reviewReplicateCount !== schedules.length ||
        d.reviewCount !== rs.length ||
        d.disagreementReviewReplicates !==
          votes.filter((v) => new Set(v).size > 1).length
      )
        errors.push('Result violates equal-weight unanimous contract');
      if (
        !same(d.reviewIds.slice().sort(), rs.map((r) => r.id).sort()) ||
        !same(d.evidenceIds.slice().sort(), refs)
      )
        errors.push('Result evidence/review selection mismatch');
      const raw = rs.map(
        (r) =>
          r.dimensions.find((x) => x.dimensionId === d.dimensionId)!.verdict,
      );
      if (
        d.positionPreferences.A !== raw.filter((v) => v === 'A').length ||
        d.positionPreferences.B !== raw.filter((v) => v === 'B').length
      )
        errors.push('Position bias evidence mismatch');
    }
    const det = reviews
      .filter((r) => r.reviewerType === 'deterministic' && r.caseId === c.id)
      .map((r) => r.id)
      .sort();
    unique(entry.deterministicReviewIds, errors, 'deterministic review IDs');
    if (!same(entry.deterministicReviewIds.slice().sort(), det))
      errors.push('Deterministic review selection mismatch');
    unique(
      entry.controlObservations.map((x) => x.controlId),
      errors,
      'control observations',
    );
    if (
      !same(
        entry.controlObservations.map((x) => x.controlId).sort(),
        c.controls.map((x) => x.id).sort(),
      )
    )
      errors.push('Missing/extra negative-control observation');
    for (const o of entry.controlObservations) {
      const control = c.controls.find((x) => x.id === o.controlId);
      if (!control) continue;
      unique(o.evidenceIds, errors, 'control evidence');
      unique(o.sourceRecordIds, errors, 'control sources');
      const sources = o.sourceRecordIds.map((id) =>
        reviews.find((r) => r.id === id),
      );
      if (sources.some((r) => !r || r.caseId !== c.id))
        errors.push('Unknown/out-of-case control source');
      if (control.target.kind === 'reviewer')
        for (const schedule of schedules)
          if (
            !sources.some(
              (r) =>
                r &&
                r.reviewerType !== 'deterministic' &&
                r.reviewReplicateId === schedule.reviewReplicateId,
            )
          )
            errors.push('Control missing review replicate source');
      const observations = sources.map((r) => {
        if (!r) return 'inconclusive';
        if (control.target.kind === 'reviewer') {
          if (
            r.reviewerType === 'deterministic' ||
            r.reviewerId !== control.target.id
          ) {
            errors.push('Control reviewer target mismatch');
            return 'inconclusive';
          }
          const m = mappings.find((m) => m.packId === r.packId),
            d = r.dimensions.find((d) => d.dimensionId === control.dimensionId);
          if (!m || !d) {
            errors.push('Control source missing dimension/mapping');
            return 'inconclusive';
          }
          if (
            !d.evidenceIds.every((id) =>
              o.evidenceIds.includes(
                m.aliases.find((a) => a.aliasId === id)?.sourceEvidenceId ?? '',
              ),
            )
          )
            errors.push('Control evidence omits source references');
          const v = mappedVerdict(r, control.dimensionId, m);
          return v === 'inconclusive' || v === 'not-applicable'
            ? 'inconclusive'
            : v === (control.arm === 'candidate' ? 'regressed' : 'improved')
              ? 'red'
              : 'not-red';
        }
        if (r.reviewerType !== 'deterministic' || r.arm !== control.arm) {
          errors.push('Control detector/validator source mismatch');
          return 'inconclusive';
        }
        const finding = r.findings.find(
          (f) => f.targetId === control.target.id,
        );
        if (
          !finding ||
          !r.evidenceIds.every((id) => o.evidenceIds.includes(id))
        ) {
          errors.push('Control missing target finding/evidence');
          return 'inconclusive';
        }
        return finding.outcome === 'fail'
          ? 'red'
          : finding.outcome === 'pass'
            ? 'not-red'
            : 'inconclusive';
      });
      if (o.observed !== consensus(observations))
        errors.push('Control observation not supported by source records');
      if (
        o.targetId !== control.target.id ||
        o.evidenceIds.some((id) => {
          const e = parent(id);
          return (
            !e ||
            e.caseId !== c.id ||
            (control.target.kind !== 'reviewer' && e.arm !== control.arm)
          );
        }) ||
        control.requiredEvidenceKinds.some(
          (k) => !o.evidenceIds.some((id) => parent(id)?.kind === k),
        )
      )
        errors.push('Missing/mismatched control target/evidence');
    }
    if (c.split === 'holdout') {
      const contentDigest = benchmarkCaseContentDigest(c, candidates);
      const history = uses.filter((u) => u.contentDigest === contentDigest);
      const current = history.filter(
        (u) =>
          u.state === 'consumed' &&
          same(u.case, entry.case) &&
          u.suiteDigest === report.suiteDigest &&
          u.evaluatorDigest === suite.evaluatorDigest &&
          u.claimId === report.claimId,
      );
      if (history.length !== 1 || current.length !== 1)
        errors.push(
          'Holdout material previously used, retired, renamed or missing current consumption',
        );
    }
  }
  if (holdoutLedgerDigest(uses) !== context.expectedHoldoutLedgerDigest)
    errors.push('Trusted Holdout ledger digest mismatch');
  unique(
    uses.map((u) => u.id),
    errors,
    'Holdout event IDs',
  );
  const consumed = new Map<string, (typeof uses)[number]>(),
    retired = new Set<string>();
  for (let i = 0; i < uses.length; i++) {
    const u = uses[i]!;
    const expectedPrevious =
      i === 0
        ? '0'.repeat(64)
        : canonicalDigest('videobench/holdout-event-v1', uses[i - 1]!);
    if (u.sequence !== i || u.previousEntryDigest !== expectedPrevious)
      errors.push('Holdout append-only event chain mismatch');
    if (u.state === 'consumed') {
      if (
        [...consumed.values()].some((c) => c.contentDigest === u.contentDigest)
      )
        errors.push('Holdout content consumed more than once');
      consumed.set(u.id, u);
    } else {
      const original = consumed.get(u.consumptionId);
      if (
        !original ||
        retired.has(u.consumptionId) ||
        !same(original.case, u.case) ||
        original.contentDigest !== u.contentDigest ||
        original.suiteDigest !== u.suiteDigest ||
        original.evaluatorDigest !== u.evaluatorDigest ||
        original.claimId !== u.claimId
      )
        errors.push(
          'Holdout retirement does not preserve original consumption',
        );
      retired.add(u.consumptionId);
    }
  }
  return { valid: !errors.length, errors, value: report };
}
