import { id } from '../common';
import { z } from 'zod';
import { color } from './../common';
import { positive } from './../common';
import { frame } from './../common';
import { transformSchema } from './../common';
import { animationSchema } from './../animation';
import { visualEffectsSchema } from './../common';
import { semanticMetadataSchema } from './../authoring';
import { motionSchema } from './../authoring';
import { pathPropsSchema } from './../authoring';
export const textProps = z
  .object({
    text: z.string().max(10000),
    color: color.default('#e7edf7'),
    fontSize: positive.max(300).default(32),
    align: z.enum(['left', 'center', 'right']).default('left'),
    fontFamily: z.enum(['theme', 'monospace']).optional(),
  })
  .strict();
export const shapeProps = z
  .object({
    fill: color.default('#20304a'),
    stroke: color.default('#467baf'),
    radius: z.number().min(0).max(500).default(16),
  })
  .strict();
export const arrowProps = z
  .object({
    color: color.default('#53d5b0'),
    lineWidth: positive.max(100).default(4),
  })
  .strict();
export const baseClip = {
  id,
  startFrame: frame,
  durationFrames: frame.min(1),
  transform: transformSchema,
  animations: z.array(animationSchema).default([]),
  effects: visualEffectsSchema.optional(),
  semantic: semanticMetadataSchema.optional(),
  motion: z.array(motionSchema).max(16).optional(),
};
export const primitiveClipSchema = z.discriminatedUnion('component', [
  z
    .object({ ...baseClip, component: z.literal('Text'), props: textProps })
    .strict(),
  z
    .object({ ...baseClip, component: z.literal('Shape'), props: shapeProps })
    .strict(),
  z
    .object({ ...baseClip, component: z.literal('Arrow'), props: arrowProps })
    .strict(),
  z
    .object({
      ...baseClip,
      component: z.literal('Path'),
      props: pathPropsSchema,
    })
    .strict(),
]);
export type PrimitiveClip = z.infer<typeof primitiveClipSchema>;
