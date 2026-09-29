import { z } from 'zod';
import { relativePathSchema } from './common';
export const productionManifestSchema = z
  .object({
    version: z.literal(1),
    brief: relativePathSchema,
    sources: relativePathSchema,
    narrativePlan: relativePathSchema,
    visualPlan: relativePathSchema,
    project: relativePathSchema,
    assets: relativePathSchema.optional(),
  })
  .strict();
export type ProductionManifest = z.infer<typeof productionManifestSchema>;
