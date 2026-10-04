import { z } from 'zod';
import { identity } from './common';
import {
  artifactDigestSchema,
  candidateBindingSchema,
  reviewEvidenceSchema,
  reviewRangeSchema,
} from './review-v2';
export const repairCheckSchema = artifactDigestSchema
  .extend({
    id: identity,
    role: z.enum(['reproduction', 'targeted', 'neighbor-regression']),
    candidate: candidateBindingSchema,
    result: z.enum(['pass', 'fail']),
  })
  .strict();
export const repairCaseSchema = z
  .object({
    version: z.literal(1),
    id: identity,
    findingIds: z.array(identity).min(1),
    base: candidateBindingSchema,
    candidate: candidateBindingSchema.optional(),
    scope: z
      .object({
        sceneIds: z.array(identity).min(1),
        ranges: z.array(
          z
            .object({
              sceneId: identity,
              startFrame: z.number().int().nonnegative(),
              endFrame: z.number().int().positive(),
            })
            .strict()
            .refine(
              (r) =>
                reviewRangeSchema.safeParse({
                  startFrame: r.startFrame,
                  endFrame: r.endFrame,
                }).success,
              'Invalid repair range',
            ),
        ),
      })
      .strict(),
    method: z.enum([
      'structured-patch',
      'composition-source',
      'plan-revision',
      'asset-replacement',
    ]),
    /** Immutable SceneWirePatchPlan reference; apply remains governed by the existing patch validator. */
    patch: artifactDigestSchema.optional(),
    beforeEvidence: z.array(reviewEvidenceSchema).min(1),
    afterEvidence: z.array(reviewEvidenceSchema),
    checks: z.array(repairCheckSchema),
    status: z.enum(['proposed', 'reproduced', 'applied', 'verified']),
  })
  .strict();
export type RepairCase = z.infer<typeof repairCaseSchema>;
export type RepairCheck = z.infer<typeof repairCheckSchema>;
