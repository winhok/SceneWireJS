import { z } from 'zod';
const text = z.string().min(1);
const time = z.number().nonnegative();
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const frameEvidenceSchema = z
  .object({
    id: text,
    timeMs: time,
    path: text,
    sha256: digestSchema,
    sourceSha256: digestSchema,
    shotId: text.optional(),
    seekMode: z.enum(['fast', 'accurate']),
  })
  .strict();
export type FrameEvidence = z.infer<typeof frameEvidenceSchema>;
