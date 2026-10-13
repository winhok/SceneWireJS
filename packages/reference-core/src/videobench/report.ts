import { z } from 'zod';
import {
  benchIdSchema,
  benchmarkDigestSchema,
  digestBindingSchema,
  benchmarkArmSchema,
} from './common';
import { benchmarkSplitSchema } from './case';
import { dimensionIdSchema } from './profile';
export const creativeResultSchema = z.enum([
  'improved',
  'regressed',
  'equivalent',
  'inconclusive',
  'not-applicable',
]);
export const dimensionResultSchema = z
  .object({
    dimensionId: dimensionIdSchema,
    result: creativeResultSchema,
    evidenceIds: z.array(benchIdSchema).min(1),
    reviewIds: z.array(benchIdSchema).min(1),
    reviewReplicateCount: z.number().int().positive(),
    reviewCount: z.number().int().positive(),
    disagreementReviewReplicates: z.number().int().nonnegative(),
    positionPreferences: z
      .object({
        A: z.number().int().nonnegative(),
        B: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export const videoBenchReportV1Schema = z
  .object({
    version: z.literal(1),
    id: benchIdSchema,
    claimId: benchIdSchema,
    suiteDigest: benchmarkDigestSchema,
    candidates: z.array(digestBindingSchema).min(2),
    profiles: z.array(digestBindingSchema).min(1),
    sections: z
      .array(
        z
          .object({
            split: benchmarkSplitSchema,
            cases: z.array(
              z
                .object({
                  case: digestBindingSchema,
                  arms: z
                    .array(
                      z
                        .object({
                          arm: benchmarkArmSchema,
                          candidate: digestBindingSchema,
                          evidenceIds: z.array(benchIdSchema).min(1),
                        })
                        .strict(),
                    )
                    .length(2),
                  evidencePairCount: z.literal(1),
                  reviewReplicates: z
                    .array(
                      z
                        .object({
                          reviewReplicateId: benchIdSchema,
                          reviewIds: z.array(benchIdSchema).min(2),
                        })
                        .strict(),
                    )
                    .min(1),
                  dimensions: z.array(dimensionResultSchema).min(1),
                  deterministicReviewIds: z.array(benchIdSchema),
                  controlObservations: z.array(
                    z
                      .object({
                        controlId: benchIdSchema,
                        targetId: benchIdSchema,
                        observed: z.enum(['red', 'not-red', 'inconclusive']),
                        sourceRecordIds: z.array(benchIdSchema).min(1),
                        evidenceIds: z.array(benchIdSchema).min(1),
                      })
                      .strict(),
                  ),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .length(3),
  })
  .strict();
export const videoBenchReportV2Schema = videoBenchReportV1Schema
  .extend({
    version: z.literal(2),
    qualificationFreezeDigest: benchmarkDigestSchema,
  })
  .strict();
export const videoBenchReportSchema = z.discriminatedUnion('version', [
  videoBenchReportV1Schema,
  videoBenchReportV2Schema,
]);
export type VideoBenchReportV1 = z.infer<typeof videoBenchReportV1Schema>;
export type VideoBenchReportV2 = z.infer<typeof videoBenchReportV2Schema>;
export type VideoBenchReport = z.infer<typeof videoBenchReportSchema>;
