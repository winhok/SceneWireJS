import { z } from 'zod';
import {
  benchIdSchema,
  benchTextSchema,
  digestBindingSchema,
  benchmarkDigestSchema,
  evidenceKindSchema,
  timeRangeSchema,
  benchmarkArmSchema,
} from './common';
import { dimensionIdSchema } from './profile';
export const benchmarkSplitSchema = z.enum([
  'development',
  'holdout',
  'negative-control',
]);
export const readIntentSchema = z
  .object({
    version: z.literal(1),
    id: benchIdSchema,
    timeRange: timeRangeSchema,
    target: benchTextSchema,
    meaning: benchTextSchema,
    cueId: benchIdSchema.optional(),
  })
  .strict();
export const negativeControlSchema = z
  .object({
    id: benchIdSchema,
    failure: z.enum([
      'frozen-section',
      'black-tail',
      'hard-transition-discontinuity',
      'text-outside-safe-region',
      'obvious-overlap',
      'timing-cue-offset',
      'motion-jump',
      'candidate-identity-mismatch',
      'missing-evidence',
      'ab-identity-leakage',
    ]),
    arm: benchmarkArmSchema,
    dimensionId: dimensionIdSchema,
    target: z
      .object({
        kind: z.enum(['detector', 'reviewer', 'validator']),
        id: benchIdSchema,
      })
      .strict(),
    expected: z.literal('red'),
    requiredEvidenceKinds: z.array(evidenceKindSchema).min(1),
  })
  .strict();
export const benchmarkCaseSchema = z
  .object({
    version: z.literal(1),
    id: benchIdSchema,
    purpose: benchTextSchema,
    profile: digestBindingSchema,
    inputs: z.array(
      z
        .object({
          id: benchIdSchema,
          sha256: benchmarkDigestSchema,
          role: z.enum(['input', 'reference']),
          referenceEvidenceId: benchIdSchema.optional(),
        })
        .strict(),
    ),
    baseline: digestBindingSchema,
    candidate: digestBindingSchema,
    requiredDimensions: z.array(dimensionIdSchema).min(1),
    evidencePlan: z
      .array(
        z
          .object({
            dimensionId: dimensionIdSchema,
            kinds: z.array(evidenceKindSchema).min(1),
          })
          .strict(),
      )
      .min(1),
    split: benchmarkSplitSchema,
    readIntents: z.array(readIntentSchema),
    controls: z.array(negativeControlSchema),
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.split === 'negative-control') !== !!v.controls.length)
      c.addIssue({
        code: 'custom',
        message:
          'Negative-control split requires explicit controls exclusively',
      });
    for (const ids of [
      v.inputs.map((x) => x.id),
      v.requiredDimensions,
      v.evidencePlan.map((x) => x.dimensionId),
      v.readIntents.map((x) => x.id),
      v.controls.map((x) => x.id),
    ])
      if (new Set(ids).size !== ids.length)
        c.addIssue({
          code: 'custom',
          message: 'Duplicate case IDs/dimensions',
        });
    if (v.baseline.id === v.candidate.id)
      c.addIssue({
        code: 'custom',
        message: 'Comparison requires distinct candidate IDs',
      });
  });
export type ReadIntent = z.infer<typeof readIntentSchema>;
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>;
