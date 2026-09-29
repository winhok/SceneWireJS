import { z } from 'zod';
import { identity } from './common';
import { text } from './common';
import { relativePathSchema } from './common';
import { digest } from './common';
export const sourceRecordSchema = z
  .object({
    id: identity,
    kind: z.enum(['repo', 'url', 'file', 'text']),
    title: text,
    locator: text,
    snapshotPath: relativePathSchema.optional(),
    sha256: digest.optional(),
    commitSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
  })
  .strict();
export const sourceClaimSchema = z
  .object({
    id: identity,
    text,
    type: z.enum(['factual', 'creative']),
    sourceIds: z.array(identity),
  })
  .strict();
export const sourcePackSchema = z
  .object({
    version: z.literal(1),
    sources: z.array(sourceRecordSchema),
    claims: z.array(sourceClaimSchema),
  })
  .strict();
export type SourcePack = z.infer<typeof sourcePackSchema>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type SourceClaim = z.infer<typeof sourceClaimSchema>;
