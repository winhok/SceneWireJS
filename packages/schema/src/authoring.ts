import { z } from 'zod';
const id = z.string().min(1).max(128);
export const semanticMetadataSchema = z
  .object({
    role: z.string().min(1).max(200).optional(),
    entity: z.string().min(1).max(200).optional(),
    concept: z.string().min(1).max(200).optional(),
    tags: z.array(z.string().min(1).max(100)).max(32).optional(),
  })
  .strict();
export type SemanticMetadata = z.infer<typeof semanticMetadataSchema>;
const layoutBase = {
  clipIds: z.array(id).min(1).max(100),
  padding: z.number().nonnegative().default(48),
  gap: z.number().nonnegative().default(24),
};
export const layoutSchema = z.discriminatedUnion('type', [
  z.object({ ...layoutBase, type: z.literal('absolute') }).strict(),
  z.object({ ...layoutBase, type: z.literal('centered') }).strict(),
  z
    .object({
      ...layoutBase,
      type: z.literal('stack'),
      direction: z.enum(['horizontal', 'vertical']).default('vertical'),
    })
    .strict(),
  z
    .object({
      ...layoutBase,
      type: z.literal('grid'),
      columns: z.number().int().min(1).max(12).default(2),
    })
    .strict(),
  z
    .object({
      ...layoutBase,
      type: z.literal('split'),
      direction: z.enum(['horizontal', 'vertical']).default('horizontal'),
      ratio: z
        .tuple([
          z.number().min(0.001).max(1000),
          z.number().min(0.001).max(1000),
        ])
        .default([0.42, 0.58]),
    })
    .strict(),
]);
export type StructuredLayout = z.infer<typeof layoutSchema>;
export const motionPresetSchema = z.enum([
  'fade',
  'slide',
  'scale',
  'reveal',
  'draw',
  'stagger',
  'bounce',
  'float',
  'wiggle',
  'shake',
  'pulse',
  'rise',
  'drift',
  'evaporate',
]);
export const motionSchema = z
  .object({
    preset: motionPresetSchema,
    startFrame: z.number().int().nonnegative().default(0),
    durationFrames: z.number().int().min(2).max(18000),
    amplitude: z.number().nonnegative().max(4096).default(24),
    frequency: z.number().positive().max(20).default(1),
    direction: z.enum(['left', 'right', 'up', 'down']).default('up'),
    staggerIndex: z.number().int().nonnegative().max(100).default(0),
    staggerFrames: z.number().int().nonnegative().max(600).default(6),
  })
  .strict();
export type MotionIntent = z.infer<typeof motionSchema>;
export const motionProperties = (
  preset: MotionIntent['preset'],
  direction: MotionIntent['direction'] = 'up',
): string[] => {
  switch (preset) {
    case 'fade':
    case 'stagger':
      return ['opacity'];
    case 'reveal':
    case 'draw':
      return ['progress'];
    case 'scale':
    case 'pulse':
      return ['scaleX', 'scaleY'];
    case 'wiggle':
      return ['rotation'];
    case 'shake':
      return ['x'];
    case 'bounce':
    case 'float':
    case 'rise':
      return ['y'];
    case 'evaporate':
      return ['y', 'opacity', 'scaleX', 'scaleY'];
    default:
      return [direction === 'left' || direction === 'right' ? 'x' : 'y'];
  }
};
export const pathPropsSchema = z
  .object({
    points: z
      .array(
        z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(2)
      .max(512),
    color: z
      .string()
      .regex(/^#[\da-fA-F]{6}$/)
      .default('#53d5b0'),
    lineWidth: z.number().positive().max(100).default(4),
    closed: z.boolean().default(false),
  })
  .strict();
