import { z } from 'zod';
import {
  benchIdSchema,
  benchTextSchema,
  benchmarkDigestSchema,
  digestBindingSchema,
} from './common';
import { dimensionIdSchema } from './profile';
const assignmentSchema = z
  .object({
    reviewerId: benchIdSchema,
    packId: benchIdSchema,
    packDigest: benchmarkDigestSchema,
    mappingDigest: benchmarkDigestSchema,
    inputBundleDigest: benchmarkDigestSchema,
    reviewerClass: z.enum(['human', 'external-agent']),
    identityClass: benchIdSchema,
    agent: z
      .object({
        provider: benchTextSchema,
        model: benchTextSchema,
        configDigest: benchmarkDigestSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => (v.reviewerClass === 'external-agent') === !!v.agent,
    'External agent metadata required exclusively',
  );
export const benchmarkSuiteSchema = z
  .object({
    version: z.literal(1),
    id: benchIdSchema,
    cases: z.array(digestBindingSchema).min(1),
    profiles: z.array(digestBindingSchema).min(1),
    dimensionRegistry: z.array(dimensionIdSchema).min(1),
    rubricDigest: benchmarkDigestSchema,
    configDigest: benchmarkDigestSchema,
    corpusDigest: benchmarkDigestSchema,
    evaluatorDigest: benchmarkDigestSchema,
    replicatePolicy: z
      .object({
        count: z.number().int().positive(),
        weight: z.literal('equal'),
        selection: z.literal('all-scheduled'),
        unit: z.literal('review'),
      })
      .strict(),
    reviewProtocol: z
      .object({
        version: z.literal(1),
        aggregation: z.literal('unanimous-v1'),
        positionPolicy: z.literal('frozen-randomized'),
        creativeReviewersPerReplicate: z.number().int().min(2),
        workspacePolicy: z.enum(['empty', 'sanitized']),
        reviewTemplateDigest: benchmarkDigestSchema,
      })
      .strict(),
    evidenceBundles: z
      .array(
        z
          .object({
            caseId: benchIdSchema,
            arms: z
              .array(
                z
                  .object({
                    arm: z.enum(['baseline', 'candidate']),
                    candidate: digestBindingSchema,
                    evidence: z.array(digestBindingSchema).min(1),
                  })
                  .strict(),
              )
              .length(2),
          })
          .strict(),
      )
      .min(1),
    // Frozen before any reviewer result; diagnostics are never eligible for a creative pack.
    reviewEvidencePlan: z
      .array(
        z
          .object({
            caseId: benchIdSchema,
            arms: z
              .array(
                z
                  .object({
                    arm: z.enum(['baseline', 'candidate']),
                    evidenceIds: z.array(benchIdSchema).min(1),
                  })
                  .strict(),
              )
              .length(2),
          })
          .strict(),
      )
      .min(1),
    schedule: z
      .array(
        z
          .object({
            caseId: benchIdSchema,
            reviewReplicateId: benchIdSchema,
            reviews: z.array(assignmentSchema).min(2),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
/** Append-only consumed/retirement events. The trusted ledger retains history outside current suites. */
export const holdoutUseSchema = z
  .object({
    version: z.literal(1),
    id: benchIdSchema,
    sequence: z.number().int().nonnegative(),
    previousEntryDigest: benchmarkDigestSchema,
    consumptionId: benchIdSchema,
    contentDigest: benchmarkDigestSchema,
    case: digestBindingSchema,
    suiteDigest: benchmarkDigestSchema,
    evaluatorDigest: benchmarkDigestSchema,
    claimId: benchIdSchema,
    state: z.enum(['consumed', 'retired-to-development']),
    usedForTuning: z.boolean(),
    receiptDigest: benchmarkDigestSchema,
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.state === 'retired-to-development') !== v.usedForTuning)
      c.addIssue({ code: 'custom', message: 'Tuned holdout must be retired' });
    if ((v.state === 'consumed') !== (v.id === v.consumptionId))
      c.addIssue({
        code: 'custom',
        message:
          'Holdout retirement must reference an earlier consumption event',
      });
  });
export type BenchmarkSuite = z.infer<typeof benchmarkSuiteSchema>;
export type HoldoutUse = z.infer<typeof holdoutUseSchema>;
