import { frame } from './common';
import { z } from 'zod';
export const easingSchema = z.enum([
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeOutCubic',
  'easeInOutCubic',
]);
export type EasingName = z.infer<typeof easingSchema>;
export const animationPropertySchema = z.enum([
  'opacity',
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'width',
  'height',
  'progress',
]);
export type AnimationProperty = z.infer<typeof animationPropertySchema>;
export const animationSchema = z
  .object({
    property: animationPropertySchema,
    keyframes: z
      .array(
        z
          .object({
            frame,
            value: z.number(),
            easing: easingSchema.default('linear'),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((a, ctx) => {
    a.keyframes.forEach((k, i) => {
      if (i > 0 && k.frame <= a.keyframes[i - 1]!.frame)
        ctx.addIssue({
          code: 'custom',
          message: 'Keyframes must be strictly increasing',
        });
      if (a.property === 'opacity' && (k.value < 0 || k.value > 1))
        ctx.addIssue({
          code: 'custom',
          message: 'Opacity must be between 0 and 1',
        });
      if (
        ['width', 'height', 'scaleX', 'scaleY'].includes(a.property) &&
        k.value <= 0
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Size and scale must be positive',
        });
      if (a.property === 'progress' && (k.value < 0 || k.value > 1))
        ctx.addIssue({
          code: 'custom',
          message: 'Progress must be between 0 and 1',
        });
    });
  });
export type AnimationTrack = z.infer<typeof animationSchema>;
