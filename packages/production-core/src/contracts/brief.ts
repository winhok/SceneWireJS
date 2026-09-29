import { z } from 'zod';
import { identity } from './common';
import { text } from './common';
export const productionBriefSchema = z
  .object({
    version: z.literal(1),
    id: identity,
    intent: z.enum([
      'product-launch',
      'faceless-explainer',
      'change-explainer',
      'general',
    ]),
    goal: text,
    audience: text,
    language: text,
    targetDurationSeconds: z.number().positive(),
    canvas: z
      .object({
        width: z.number().int().min(1).max(8192),
        height: z.number().int().min(1).max(8192),
        fps: z.union([
          z.literal(24),
          z.literal(25),
          z.literal(30),
          z.literal(60),
        ]),
      })
      .strict(),
    tone: text.optional(),
    narration: z.enum(['voiceover', 'text-led', 'silent']),
    mustInclude: z.array(text).optional(),
    avoid: z.array(text).optional(),
    callToAction: text.optional(),
    referenceNotes: z.array(text).optional(),
  })
  .strict();
export type ProductionBrief = z.infer<typeof productionBriefSchema>;
