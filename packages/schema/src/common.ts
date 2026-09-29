import { z } from 'zod';
export const id = z.string().min(1).max(128);
export const localProjectReferenceSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !/[\\:?#%\x00-\x1f]/.test(value) &&
      !value.startsWith('/') &&
      value.split('/').every((part) => part !== '..' && part !== ''),
    'Use a local project-relative reference',
  );
export const frame = z.number().int().nonnegative();
export const positive = z.number().positive();
export const color = z
  .string()
  .regex(/^#[\da-fA-F]{6}$/, 'Use a six-digit hex color');
export const visualEffectsSchema = z
  .object({ blurPx: z.number().min(0).max(40).optional() })
  .strict();
export type VisualEffects = z.infer<typeof visualEffectsSchema>;
export const DEFAULT_TRANSFORM = Object.freeze({
  x: 0,
  y: 0,
  width: 300,
  height: 100,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  zIndex: 0,
});
export const transformSchema = z
  .object({
    x: z.number().default(DEFAULT_TRANSFORM.x),
    y: z.number().default(DEFAULT_TRANSFORM.y),
    width: positive.default(DEFAULT_TRANSFORM.width),
    height: positive.default(DEFAULT_TRANSFORM.height),
    scaleX: positive.default(DEFAULT_TRANSFORM.scaleX),
    scaleY: positive.default(DEFAULT_TRANSFORM.scaleY),
    rotation: z.number().default(DEFAULT_TRANSFORM.rotation),
    opacity: z.number().min(0).max(1).default(DEFAULT_TRANSFORM.opacity),
    zIndex: z.number().int().default(DEFAULT_TRANSFORM.zIndex),
  })
  .strict();
export type Transform = z.infer<typeof transformSchema>;

export function isDefaultTransform(transform: Transform): boolean {
  return (Object.keys(DEFAULT_TRANSFORM) as (keyof Transform)[]).every(
    (key) => transform[key] === DEFAULT_TRANSFORM[key],
  );
}
