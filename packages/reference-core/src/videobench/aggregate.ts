import type { VideoBenchReportContext } from './validation';
import { validateVideoBenchReport, videoBenchBinding } from './validation';
import { benchmarkSuiteSchema } from './suite';
import { benchmarkCaseSchema } from './case';
import { benchmarkCandidateSchema } from './candidate';
import { reviewRecordSchema, blindIdentityMappingSchema } from './review';
import type { CreativeReviewRecord } from './review';
import type { VideoBenchReport } from './report';
import { z } from 'zod';

const unanimous = <T extends string>(votes: T[]): T | 'inconclusive' =>
  votes.length && votes.every((v) => v === votes[0])
    ? votes[0]!
    : 'inconclusive';
/** Derive every dimension from all scheduled records, then apply the frozen contextual validator.
 * Receipt authenticity is enforced by the host before calling this pure derivation. */
export function aggregateVideoBenchReport(
  id: string,
  claimId: string,
  context: VideoBenchReportContext,
): VideoBenchReport {
  if (
    context.requireQualificationFreeze &&
    !context.expectedQualificationFreezeDigest
  )
    throw Error('Formal qualification requires a trusted qualification freeze');
  const suite = benchmarkSuiteSchema.parse(context.suite);
  const cases = z.array(benchmarkCaseSchema).parse(context.cases);
  const candidates = z
    .array(benchmarkCandidateSchema)
    .parse(context.candidates);
  const reviews = z.array(reviewRecordSchema).parse(context.reviews);
  const mappings = z.array(blindIdentityMappingSchema).parse(context.mappings);
  const creative = reviews.filter(
    (r): r is CreativeReviewRecord => r.reviewerType !== 'deterministic',
  );
  const mapped = (r: CreativeReviewRecord, dimension: string) => {
    const v = r.dimensions.find((d) => d.dimensionId === dimension)?.verdict;
    const m = mappings.find((m) => m.packId === r.packId);
    if (!v || !m) throw Error('Missing dimension/private mapping');
    return v === 'A' || v === 'B'
      ? m[v] === 'candidate'
        ? 'improved'
        : 'regressed'
      : v;
  };
  const report: VideoBenchReport = {
    ...(context.expectedQualificationFreezeDigest
      ? {
          version: 2 as const,
          qualificationFreezeDigest: context.expectedQualificationFreezeDigest,
        }
      : { version: 1 as const }),
    id,
    claimId,
    suiteDigest: context.expectedSuiteDigest,
    candidates: candidates
      .filter((x) =>
        cases.some((c) => c.baseline.id === x.id || c.candidate.id === x.id),
      )
      .map((c) => videoBenchBinding('candidate', c)),
    profiles: suite.profiles,
    sections: (['development', 'holdout', 'negative-control'] as const).map(
      (split) => ({
        split,
        cases: cases
          .filter((c) => c.split === split)
          .map((c) => {
            const schedules = suite.schedule.filter((s) => s.caseId === c.id);
            const rs = creative.filter((r) => r.caseId === c.id);
            const resolve = (r: CreativeReviewRecord, aliases: string[]) =>
              aliases.map((a) => {
                const source = mappings
                  .find((m) => m.packId === r.packId)
                  ?.aliases.find((x) => x.aliasId === a)?.sourceEvidenceId;
                if (!source) throw Error('Unknown alias');
                return source;
              });
            return {
              case: videoBenchBinding('case', c),
              arms: suite.evidenceBundles
                .find((b) => b.caseId === c.id)!
                .arms.map((a) => ({
                  arm: a.arm,
                  candidate: a.candidate,
                  evidenceIds: a.evidence.map((e) => e.id),
                })),
              evidencePairCount: 1 as const,
              reviewReplicates: schedules.map((s) => ({
                reviewReplicateId: s.reviewReplicateId,
                reviewIds: rs
                  .filter((r) => r.reviewReplicateId === s.reviewReplicateId)
                  .map((r) => r.id),
              })),
              dimensions: c.requiredDimensions.map((dimensionId) => {
                const votes = schedules.map((s) =>
                  rs
                    .filter((r) => r.reviewReplicateId === s.reviewReplicateId)
                    .map((r) => mapped(r, dimensionId)),
                );
                const raw = rs.map(
                  (r) =>
                    r.dimensions.find((d) => d.dimensionId === dimensionId)!
                      .verdict,
                );
                return {
                  dimensionId,
                  result: unanimous(votes.map(unanimous)),
                  evidenceIds: [
                    ...new Set(
                      rs.flatMap((r) =>
                        resolve(
                          r,
                          r.dimensions.find(
                            (d) => d.dimensionId === dimensionId,
                          )!.evidenceIds,
                        ),
                      ),
                    ),
                  ].sort(),
                  reviewIds: rs.map((r) => r.id),
                  reviewReplicateCount: schedules.length,
                  reviewCount: rs.length,
                  disagreementReviewReplicates: votes.filter(
                    (v) => new Set(v).size > 1,
                  ).length,
                  positionPreferences: {
                    A: raw.filter((v) => v === 'A').length,
                    B: raw.filter((v) => v === 'B').length,
                  },
                };
              }),
              deterministicReviewIds: reviews
                .filter(
                  (r) =>
                    r.reviewerType === 'deterministic' && r.caseId === c.id,
                )
                .map((r) => r.id),
              controlObservations: c.controls.map((control) => {
                const sources = reviews.filter(
                  (r) =>
                    r.caseId === c.id &&
                    (control.target.kind === 'reviewer'
                      ? r.reviewerType !== 'deterministic' &&
                        r.reviewerId === control.target.id
                      : r.reviewerType === 'deterministic' &&
                        r.arm === control.arm),
                );
                const observations = sources.map((r) => {
                  if (r.reviewerType === 'deterministic') {
                    const f = r.findings.find(
                      (f) => f.targetId === control.target.id,
                    );
                    return f?.outcome === 'fail'
                      ? 'red'
                      : f?.outcome === 'pass'
                        ? 'not-red'
                        : 'inconclusive';
                  }
                  const v = mapped(r, control.dimensionId);
                  return v === 'inconclusive' || v === 'not-applicable'
                    ? 'inconclusive'
                    : v ===
                        (control.arm === 'candidate' ? 'regressed' : 'improved')
                      ? 'red'
                      : 'not-red';
                });
                return {
                  controlId: control.id,
                  targetId: control.target.id,
                  observed: unanimous(observations),
                  sourceRecordIds: sources.map((r) => r.id),
                  evidenceIds: [
                    ...new Set(
                      sources.flatMap((r) =>
                        r.reviewerType === 'deterministic'
                          ? r.evidenceIds
                          : resolve(
                              r,
                              r.dimensions.find(
                                (d) => d.dimensionId === control.dimensionId,
                              )!.evidenceIds,
                            ),
                      ),
                    ),
                  ],
                };
              }),
            };
          }),
      }),
    ),
  };
  const checked = validateVideoBenchReport(report, context);
  if (!checked.valid) throw Error(checked.errors.join('; '));
  return report;
}
