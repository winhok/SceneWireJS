import { z } from 'zod';
import { canonicalDigest } from '@scenewirejs/production-core';
import {
  freezeReviewEvaluator,
  candidateCatalogDigest,
  reviewTemplateDigest,
} from './videobench-review.js';

import {
  videoBenchDigest,
  videoBenchBinding,
  benchmarkCandidateSchema,
  validateBenchmarkSuite,
} from '@scenewirejs/reference-core';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const bindingsSchema = z
  .object({
    sourceHead: z.string().regex(/^[a-f0-9]{40}$/),
    evaluatorImplementationDigest: digest,
    deterministicDiagnosticConfigDigest: digest,
    developmentCorpusDigest: digest,
    developmentContentDigests: z.array(digest).min(1),
    reviewerIdentityBindings: z
      .array(
        z
          .object({
            reviewerId: z.string().min(1),
            identityClass: z.string().min(1),
            identityCommitment: digest,
            independentOfDevelopment: z.literal(true),
            ownerIsReviewer: z.literal(false),
          })
          .strict(),
      )
      .min(2),
    formalHoldoutMaterials: z
      .array(
        z
          .object({
            contentDigest: digest,
            materialDigest: digest,
          })
          .strict(),
      )
      .min(3)
      .max(5),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.formalHoldoutMaterials.some((m) =>
        value.developmentContentDigests.includes(m.contentDigest),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Development content cannot enter formal holdout',
      });
    if (
      new Set(value.formalHoldoutMaterials.map((x) => x.contentDigest)).size !==
      value.formalHoldoutMaterials.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Duplicate formal holdout material',
      });
  });
export type QualificationBindings = z.infer<typeof bindingsSchema>;
type Protocol = Parameters<typeof freezeReviewEvaluator>[0];

/** Host-only qualification identity; no holdout content or expected winners. */
export function freezeQualificationEvaluator(
  protocol: Protocol,
  hostRuntimeDigest: string,
  bindings: QualificationBindings,
) {
  const checked = bindingsSchema.parse(bindings);
  const catalog = z
    .object({
      version: z.literal(1),
      candidates: z.array(benchmarkCandidateSchema).min(2),
    })
    .strict()
    .parse(protocol.trust.catalog);
  const valid = validateBenchmarkSuite(protocol.suite, {
    expectedSuiteDigest: protocol.trust.suiteDigest,
    candidates: catalog.candidates,
    cases: protocol.request.cases,
    profiles: protocol.request.profiles,
  });
  if (!valid.valid)
    throw Error(
      'Evaluator freeze mutation or inconsistent current protocol authority: ' +
        valid.errors.join('; '),
    );
  if (
    videoBenchDigest('suite', protocol.suite) !== protocol.trust.suiteDigest ||
    candidateCatalogDigest(protocol.trust.catalog) !==
      protocol.trust.catalogDigest ||
    (protocol.catalog &&
      candidateCatalogDigest(protocol.catalog) !==
        protocol.trust.catalogDigest) ||
    reviewTemplateDigest(protocol.template) !==
      protocol.suite.reviewProtocol.reviewTemplateDigest ||
    protocol.request.profiles.some(
      (profile) =>
        !protocol.suite.profiles.some(
          (binding) =>
            binding.id === profile.id &&
            binding.digest === videoBenchBinding('profile', profile).digest,
        ),
    ) ||
    protocol.request.bundles.some(
      (bundle) =>
        !protocol.trust.evidenceSeals.some(
          (seal) =>
            seal.caseId === bundle.caseId &&
            seal.arm === bundle.arm &&
            seal.evidenceDigest === bundle.evidenceDigest,
        ),
    )
  )
    throw Error(
      'Evaluator freeze mutation or inconsistent current protocol authority',
    );
  const scheduled = protocol.suite.schedule.flatMap((s) => s.reviews);
  const identityIds = checked.reviewerIdentityBindings.map((r) => r.reviewerId);
  if (
    new Set(identityIds).size !== identityIds.length ||
    new Set(checked.reviewerIdentityBindings.map((r) => r.identityCommitment))
      .size !== identityIds.length ||
    new Set(checked.reviewerIdentityBindings.map((r) => r.identityClass))
      .size !== identityIds.length ||
    checked.reviewerIdentityBindings.some(
      (r) =>
        !scheduled.some(
          (a) =>
            a.reviewerId === r.reviewerId &&
            a.identityClass === r.identityClass,
        ),
    ) ||
    scheduled.some(
      (a) =>
        !checked.reviewerIdentityBindings.some(
          (r) =>
            r.reviewerId === a.reviewerId &&
            r.identityClass === a.identityClass,
        ),
    )
  )
    throw Error(
      'Reviewer identity binding must exactly cover distinct scheduled identities',
    );
  const artifact = {
    version: 1 as const,
    runtime: freezeReviewEvaluator(protocol, hostRuntimeDigest).artifact,
    qualification: checked,
    reviewReplicateCount: protocol.suite.replicatePolicy.count,
  };
  return {
    artifact,
    digest: canonicalDigest('videobench/qualification-freeze-v1', artifact),
  };
}

/** Recompute against current host inputs, rather than trusting a self-asserted seal. */
export function verifyQualificationFreeze(
  frozen: ReturnType<typeof freezeQualificationEvaluator>,
  expectedDigest: string,
  protocol: Protocol,
  hostRuntimeDigest: string,
  bindings: QualificationBindings,
) {
  digest.parse(expectedDigest);
  if (
    canonicalDigest('videobench/qualification-freeze-v1', frozen.artifact) !==
      expectedDigest ||
    frozen.digest !== expectedDigest ||
    freezeQualificationEvaluator(protocol, hostRuntimeDigest, bindings)
      .digest !== expectedDigest
  )
    throw Error(
      'Evaluator freeze mutation or qualification checkpoint mismatch',
    );
  return frozen;
}

/** Parse untrusted files and verify against separately retained current host inputs. */
export function verifyQualificationReportInputs(
  frozenInput: unknown,
  expectedDigest: string,
  protocol: Protocol,
  currentInputs: unknown,
) {
  const inputs = z
    .object({
      hostRuntimeDigest: digest,
      bindings: bindingsSchema,
    })
    .strict()
    .parse(currentInputs);
  const current = freezeQualificationEvaluator(
    protocol,
    inputs.hostRuntimeDigest,
    inputs.bindings,
  );
  const envelope = z
    .object({ artifact: z.unknown(), digest })
    .strict()
    .parse(frozenInput);
  if (
    canonicalDigest('videobench/qualification-freeze-v1', envelope.artifact) !==
      expectedDigest ||
    envelope.digest !== expectedDigest ||
    current.digest !== expectedDigest
  )
    throw Error(
      'Evaluator freeze mutation or qualification checkpoint mismatch',
    );
  return current;
}

/** Create an artifact candidate; governance declaration/identity authenticity stays with the owner. */
export function createQualificationFreezeFromInputs(
  protocol: Protocol,
  currentInputs: unknown,
) {
  const inputs = z
    .object({ hostRuntimeDigest: digest, bindings: bindingsSchema })
    .strict()
    .parse(currentInputs);
  return freezeQualificationEvaluator(
    protocol,
    inputs.hostRuntimeDigest,
    inputs.bindings,
  );
}
