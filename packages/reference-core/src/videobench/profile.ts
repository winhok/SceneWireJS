import { z } from 'zod';
import { benchIdSchema, benchTextSchema, evidenceKindSchema } from './common';
export const CORE_DIMENSIONS = [
  'reference-alignment',
  'hierarchy',
  'primary-read',
  'comprehension-timing',
  'composition',
  'scene-diversity',
  'motion-density',
  'motion-continuity',
  'style-consistency',
  'transition-quality',
  'typography',
  'safe-area',
  'determinism',
] as const;
export const coreDimensionIdSchema = z.enum(CORE_DIMENSIONS);
/** Extensions are registered explicitly in a sealed suite; profiles cannot self-authorize them. */
export const dimensionIdSchema = z
  .string()
  .regex(/^(?:[a-z][a-z0-9-]*|x-[a-z0-9-]+\/v[1-9][0-9]*)$/);
/** Mechanical checks are separate from creative measurements and never produce taste verdicts. */
export const technicalGateSchema = z
  .object({
    id: benchIdSchema,
    dimensionId: z.enum(['determinism', 'safe-area']),
    measurementId: benchIdSchema,
    unit: benchTextSchema,
    threshold: z
      .object({
        operator: z.enum(['min', 'max']),
        value: z.number(),
        rationale: benchTextSchema,
      })
      .strict(),
  })
  .strict();
export const evaluationProfileSchema = z
  .object({
    version: z.literal(1),
    id: benchIdSchema,
    grammar: benchIdSchema,
    dimensionVocabularyVersion: z.literal(1),
    technicalGates: z.array(technicalGateSchema),
    dimensions: z
      .array(
        z
          .object({
            id: dimensionIdSchema,
            applicable: z.boolean(),
            interpretation: benchTextSchema,
            requiredEvidence: z.array(evidenceKindSchema),
            measurements: z.array(
              z
                .object({
                  id: benchIdSchema,
                  unit: benchTextSchema,
                  role: z.literal('diagnostic'),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.dimensions.map((d) => d.id)).size !== v.dimensions.length)
      c.addIssue({ code: 'custom', message: 'Duplicate dimension' });
    if (
      new Set(v.technicalGates.map((g) => g.id)).size !==
      v.technicalGates.length
    )
      c.addIssue({ code: 'custom', message: 'Duplicate technical gate' });
    for (const d of v.dimensions) {
      if (
        d.applicable &&
        [
          'comprehension-timing',
          'motion-continuity',
          'transition-quality',
        ].includes(d.id) &&
        !d.requiredEvidence.some(
          (k) => k === 'frame-strip' || k === 'diagnostic',
        )
      )
        c.addIssue({
          code: 'custom',
          message:
            'Temporal dimension requires temporal evidence; sheet/frame alone is insufficient',
        });
      if (d.applicable && !d.requiredEvidence.length)
        c.addIssue({
          code: 'custom',
          message: 'Applicable dimension requires evidence',
        });
      if (
        new Set(d.requiredEvidence).size !== d.requiredEvidence.length ||
        new Set(d.measurements.map((m) => m.id)).size !== d.measurements.length
      )
        c.addIssue({
          code: 'custom',
          message: 'Duplicate evidence/measurement',
        });
    }
  });
export type EvaluationProfile = z.infer<typeof evaluationProfileSchema>;
