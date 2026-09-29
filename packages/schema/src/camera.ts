import { frame } from './common';
import { z } from 'zod';
import { easingSchema } from './animation';
import { positive } from './common';
export const cameraAnimationSchema = z
  .object({
    property: z.enum(['x', 'y', 'zoom', 'rotation']),
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
      if (
        (i > 0 && k.frame <= a.keyframes[i - 1]!.frame) ||
        (a.property === 'zoom' && k.value <= 0)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Camera keyframes must increase and zoom must be positive',
        });
    });
  });
export const cameraSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    zoom: positive.default(1),
    rotation: z.number().default(0),
    animations: z.array(cameraAnimationSchema).max(4).default([]),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      new Set(c.animations.map((a) => a.property)).size !== c.animations.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate camera property' });
  });
export type CameraState = z.infer<typeof cameraSchema>;
export type CameraAnimation = z.infer<typeof cameraAnimationSchema>;
