import { z } from 'zod';
import { localProjectReferenceSchema } from './../common';
export const compositionParameterValueSchema = z.union([
  z.string().max(8000),
  z.number(),
  z.boolean(),
]);
export const compositionParameterValuesSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (
      value &&
      typeof value === 'object' &&
      Object.keys(value).some((k) =>
        ['__proto__', 'constructor', 'prototype'].includes(k),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Unsafe parameter name' });
  })
  .pipe(
    z.record(
      z
        .string()
        .min(1)
        .max(128)
        .refine((k) => !['__proto__', 'constructor', 'prototype'].includes(k)),
      compositionParameterValueSchema,
    ),
  );
export const compositionParameterSchema = z
  .discriminatedUnion('type', [
    z
      .object({ type: z.literal('string'), default: z.string().max(8000) })
      .strict(),
    z
      .object({
        type: z.literal('number'),
        default: z.number(),
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .strict(),
    z.object({ type: z.literal('boolean'), default: z.boolean() }).strict(),
    z
      .object({
        type: z.literal('color'),
        default: z.string().regex(/^#[\da-fA-F]{6}$/),
      })
      .strict(),
    z
      .object({
        type: z.literal('enum'),
        default: z.string(),
        values: z.array(z.string()).min(1),
      })
      .strict(),
  ])
  .superRefine((p, ctx) => {
    if (p.type === 'enum' && !p.values.includes(p.default))
      ctx.addIssue({ code: 'custom', message: 'Default must belong to enum' });
    if (
      p.type === 'number' &&
      ((p.min !== undefined && p.default < p.min) ||
        (p.max !== undefined && p.default > p.max) ||
        (p.min !== undefined && p.max !== undefined && p.min > p.max))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid numeric bounds/default',
      });
  });
export const manifestBase = {
  renderer: z.string().min(1),
  entry: localProjectReferenceSchema,
  transparent: z.boolean().default(true),
  permissions: z.object({ network: z.literal(false) }).strict(),
};
export const compositionManifestSchema = z.discriminatedUnion('schemaVersion', [
  z.object({ schemaVersion: z.literal(1), ...manifestBase }).strict(),
  z
    .object({
      schemaVersion: z.literal(2),
      ...manifestBase,
      engine: z.string().min(1).optional(),
      parameters: z
        .record(
          z
            .string()
            .min(1)
            .max(128)
            .refine(
              (k) => !['__proto__', 'constructor', 'prototype'].includes(k),
            ),
          compositionParameterSchema,
        )
        .optional(),
    })
    .strict(),
]);
export function resolveCompositionParameters(
  manifest: z.infer<typeof compositionManifestSchema>,
  overrides: z.infer<typeof compositionParameterValuesSchema> = {},
) {
  const values = compositionParameterValuesSchema.parse(overrides);
  const definitions =
    manifest.schemaVersion === 2 ? (manifest.parameters ?? {}) : {};
  for (const key of Object.keys(values))
    if (!Object.hasOwn(definitions, key))
      throw new Error(`Unknown composition parameter: ${key}`);
  const result: Record<string, string | number | boolean> = {};
  for (const [key, definition] of Object.entries(definitions)) {
    const value = Object.hasOwn(values, key)
      ? values[key]!
      : definition.default;
    const valid =
      definition.type === 'number'
        ? typeof value === 'number' &&
          (definition.min === undefined || value >= definition.min) &&
          (definition.max === undefined || value <= definition.max)
        : definition.type === 'boolean'
          ? typeof value === 'boolean'
          : definition.type === 'color'
            ? typeof value === 'string' && /^#[\da-fA-F]{6}$/.test(value)
            : definition.type === 'enum'
              ? typeof value === 'string' && definition.values.includes(value)
              : typeof value === 'string';
    if (!valid) throw new Error(`Invalid composition parameter: ${key}`);
    result[key] = value;
  }
  return Object.freeze(result);
}
export type CompositionManifest = z.infer<typeof compositionManifestSchema>;
