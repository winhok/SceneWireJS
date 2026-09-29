import { z } from 'zod';
export const educationComponentTypeSchema = z.enum([
  'Thermometer',
  'Flame',
  'Droplet',
  'Steam',
  'Magnifier',
  'HeatWave',
  'CutawayDiagram',
  'ScientificChart',
  'Annotation',
]);
export type EducationComponentType = z.infer<
  typeof educationComponentTypeSchema
>;
const label = z.string().max(300).optional();
const emphasis = z.boolean().default(false);
const intensity = z.number().min(0).max(1);
export const thermometerPropsSchema = z
  .object({
    value: z.number().default(200),
    min: z.number().default(0),
    max: z.number().default(300),
    unit: z.enum(['C', 'F']).default('C'),
    label,
    emphasis,
  })
  .strict()
  .refine(
    (p) => p.min < p.max && p.value >= p.min && p.value <= p.max,
    'Temperature must be within min < max',
  );
export const flamePropsSchema = z
  .object({ intensity: intensity.default(0.7), label, emphasis })
  .strict();
export const dropletPropsSchema = z
  .object({
    state: z
      .enum(['resting', 'boiling', 'levitating', 'evaporating'])
      .default('resting'),
    size: z.number().positive().max(1).default(0.8),
    emphasis,
  })
  .strict();
export const steamPropsSchema = z
  .object({
    density: intensity.default(0.6),
    direction: z.enum(['up', 'left', 'right']).default('up'),
    emphasis,
  })
  .strict();
export const heatWavePropsSchema = z
  .object({
    intensity: intensity.default(0.7),
    direction: z.enum(['up', 'down', 'left', 'right']).default('up'),
    count: z.number().int().min(1).max(12).default(4),
    emphasis,
  })
  .strict();
export const magnifierPropsSchema = z
  .object({
    label,
    magnification: z.number().min(1).max(20).default(3),
    emphasis,
  })
  .strict();
export const cutawayDiagramPropsSchema = z
  .object({
    showVaporLayer: z.boolean().default(true),
    surfaceLabel: z.string().max(100).default('HOT SURFACE'),
    vaporLabel: z.string().max(100).default('INSULATING VAPOR'),
    dropletLabel: z.string().max(100).default('WATER DROPLET'),
    emphasis: z.enum(['droplet', 'vapor', 'surface']).optional(),
  })
  .strict();
const point = z.object({ x: z.number(), y: z.number() }).strict();
export const scientificChartPropsSchema = z
  .object({
    title: label,
    xLabel: label,
    yLabel: label,
    points: z.array(point).min(2).max(200),
    annotations: z
      .array(point.extend({ label: z.string().max(100) }).strict())
      .max(20)
      .optional(),
    schematic: z.boolean().default(true),
    emphasis,
  })
  .strict();
export const annotationPropsSchema = z
  .object({
    text: z.string().min(1).max(300),
    style: z.enum(['label', 'circle', 'underline', 'arrow']).default('label'),
    emphasis,
  })
  .strict();
