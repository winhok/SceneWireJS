import { z } from 'zod';
import {
  candidateBindingSchema,
  candidateIdentity,
  rasterEnvironmentSchema,
} from '@scenewirejs/production-core';
import { benchIdSchema, benchmarkDigestSchema } from './common';
/** Existing production binding owns project/source/assets; renderDigest is outputIdentity(bytes). */
export const benchmarkCandidateSchema = z
  .object({
    version: z.literal(1),
    id: benchIdSchema,
    projectId: benchIdSchema,
    binding: candidateBindingSchema.refine(
      (v) => !!v.sourceSha256,
      'Source digest required',
    ),
    productionCandidateDigest: benchmarkDigestSchema,
    renderDigest: benchmarkDigestSchema,
    durationMs: z.number().positive(),
    productionGraphDigest: benchmarkDigestSchema.optional(),
    sourceCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    rasterSensitive: z.boolean(),
    environment: rasterEnvironmentSchema.optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.binding.assets.map((a) => a.path)).size !==
      v.binding.assets.length
    ) {
      c.addIssue({ code: 'custom', message: 'Duplicate asset paths' });
      return;
    }
    if (candidateIdentity(v.binding) !== v.productionCandidateDigest)
      c.addIssue({
        code: 'custom',
        message: 'Existing production candidate digest mismatch',
      });
    if (v.rasterSensitive && !v.environment)
      c.addIssue({
        code: 'custom',
        message: 'Raster-sensitive candidate requires environment',
      });
  });
export type BenchmarkCandidate = z.infer<typeof benchmarkCandidateSchema>;
