import { z } from 'zod';
import { identity } from './common';
import { digest } from './common';
import { relativePathSchema } from './common';
import { text } from './common';
export const sceneReviewSchema = z
  .object({
    version: z.literal(1),
    sceneId: identity,
    projectSha256: digest,
    sourceSha256: digest.optional(),
    capturePath: relativePathSchema,
    captureSha256: digest,
    reviewer: text,
    reviewedAt: z.iso.datetime(),
    disposition: z.enum(['pass', 'revise']),
    findings: z.array(text),
  })
  .strict();
export type SceneReview = z.infer<typeof sceneReviewSchema>;
