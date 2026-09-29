import { z } from 'zod';
import { identity } from './common';
import { text } from './common';
export const narrativeScenePlanSchema = z
  .object({
    id: identity,
    order: z.number().int().nonnegative(),
    title: text,
    purpose: text,
    keyMessage: text,
    claimIds: z.array(identity),
    durationFrames: z.number().int().positive(),
    voiceover: text.optional(),
    transitionIntent: text.optional(),
    visualOpportunity: text.optional(),
  })
  .strict();
export const narrativePlanSchema = z
  .object({
    version: z.literal(1),
    id: identity,
    briefId: identity,
    thesis: text,
    hook: text,
    arc: text,
    scenes: z.array(narrativeScenePlanSchema).min(1).max(1000),
  })
  .strict();
export type NarrativePlan = z.infer<typeof narrativePlanSchema>;
export type NarrativeScenePlan = z.infer<typeof narrativeScenePlanSchema>;
