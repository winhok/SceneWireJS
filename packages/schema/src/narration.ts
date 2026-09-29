import { z } from 'zod';
import { id } from './common';
import { frame } from './common';
export const wordTimingSchema = z
  .object({
    text: z.string(),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
  })
  .strict()
  .refine((w) => w.endMs >= w.startMs, 'Word end precedes start');
export const legacyNarrationSchema = z
  .object({
    segments: z.array(
      z
        .object({
          id,
          text: z.string(),
          sceneId: id.optional(),
          audioAssetId: id.optional(),
          startFrame: frame.optional(),
          durationFrames: frame.min(1).optional(),
          words: z.array(wordTimingSchema).optional(),
          cues: z
            .array(
              z
                .object({
                  id,
                  atMs: z.number().nonnegative(),
                  type: z.enum([
                    'show',
                    'hide',
                    'highlight',
                    'connect',
                    'focus',
                    'camera',
                  ]),
                  targetId: id,
                  payload: z.record(z.string(), z.unknown()).optional(),
                })
                .strict(),
            )
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();
export const cueTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clip'), clipId: id }).strict(),
  z.object({ kind: z.literal('node'), clipId: id, nodeId: id }).strict(),
  z.object({ kind: z.literal('edge'), clipId: id, edgeId: id }).strict(),
  z
    .object({
      kind: z.literal('semantic'),
      clipId: id.optional(),
      role: id.optional(),
      entity: id.optional(),
      concept: id.optional(),
      tag: id.optional(),
    })
    .strict()
    .refine(
      (t) => !!(t.role || t.entity || t.concept || t.tag),
      'Semantic query cannot be empty',
    ),
]);
export type CueTarget = z.infer<typeof cueTargetSchema>;
export const semanticCueSchema = z
  .object({
    id,
    source: z.enum(['manual', 'tts', 'alignment', 'ai', 'component']),
    action: z.enum([
      'show',
      'hide',
      'highlight',
      'connect',
      'focus',
      'camera',
      'animate',
    ]),
    target: cueTargetSchema,
    atMs: z.number().nonnegative().optional(),
    range: z
      .object({
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
      })
      .strict()
      .refine((r) => r.endMs > r.startMs, 'Cue range must be positive')
      .optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(
    (c) => (c.atMs !== undefined) !== (c.range !== undefined),
    'Specify exactly one cue time or range',
  );
export type SemanticCue = z.infer<typeof semanticCueSchema>;
export const phraseTimingSchema = wordTimingSchema;
export const phraseMappingSchema = z
  .object({
    phrase: z.string().min(1),
    target: cueTargetSchema,
    action: semanticCueSchema.shape.action,
    durationMs: z.number().positive().optional(),
  })
  .strict();
export const narrationSchema = z
  .object({
    segments: z.array(
      z
        .object({
          id,
          text: z.string(),
          sceneId: id.optional(),
          audioAssetId: id.optional(),
          audioClipId: id.optional(),
          startFrame: frame.optional(),
          durationFrames: frame.min(1).optional(),
          words: z.array(wordTimingSchema).optional(),
          phrases: z.array(phraseTimingSchema).optional(),
          cues: z
            .array(
              z.union([
                semanticCueSchema,
                legacyNarrationSchema.shape.segments.element.shape.cues.unwrap()
                  .element,
              ]),
            )
            .optional(),
          phraseMappings: z.array(phraseMappingSchema).optional(),
          subtitleMode: z.enum(['phrase', 'active-word']).optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type NarrationDocument = z.infer<typeof narrationSchema>;
export type WordTiming = z.infer<typeof wordTimingSchema>;
