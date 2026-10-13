import { z } from 'zod';
export const benchIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/);
export const benchTextSchema = z
  .string()
  .min(1)
  .max(10000)
  .refine((v) => !!v.trim());
export const benchmarkDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const digestBindingSchema = z
  .object({ id: benchIdSchema, digest: benchmarkDigestSchema })
  .strict();
export const timeRangeSchema = z
  .object({
    startMs: z.number().nonnegative(),
    endMs: z.number().positive(),
  })
  .strict()
  .refine((v) => v.endMs > v.startMs, 'Nonempty time range required');
export const toolIdentitySchema = z
  .object({ id: benchIdSchema, version: benchTextSchema })
  .strict();
export const benchmarkConfigSchema = z.record(
  benchIdSchema,
  z.union([benchTextSchema, z.number(), z.boolean()]),
);
export const benchmarkArmSchema = z.enum(['baseline', 'candidate']);
export const evidenceKindSchema = z.enum([
  'representative-frames',
  'contact-sheet',
  'frame-strip',
  'diagnostic',
]);
export type DigestBinding = z.infer<typeof digestBindingSchema>;
