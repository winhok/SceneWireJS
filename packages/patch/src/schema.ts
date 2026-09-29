import { compositionParameterValuesSchema } from '@scenewirejs/schema';
import { z } from 'zod';
import { isSafeJSON } from './json';
import {
  componentTypes,
  transformSchema,
  visualEffectsSchema,
  motionSchema,
  semanticMetadataSchema,
  cameraAnimationSchema,
  phraseMappingSchema,
  semanticCueSchema,
  projectSchema,
} from '@scenewirejs/schema';
const id = z.string().min(1).max(128);
const frame = z.number().int().nonnegative();
const props = z.record(z.string(), z.json());
const transformPatchSchema = z
  .object({
    x: transformSchema.shape.x.unwrap().optional(),
    y: transformSchema.shape.y.unwrap().optional(),
    width: transformSchema.shape.width.unwrap().optional(),
    height: transformSchema.shape.height.unwrap().optional(),
    scaleX: transformSchema.shape.scaleX.unwrap().optional(),
    scaleY: transformSchema.shape.scaleY.unwrap().optional(),
    rotation: transformSchema.shape.rotation.unwrap().optional(),
    opacity: transformSchema.shape.opacity.unwrap().optional(),
    zIndex: transformSchema.shape.zIndex.unwrap().optional(),
  })
  .strict();
const nonempty = (value: object) => Object.keys(value).length > 0;
export const semanticSelectorSchema = z
  .object({
    kind: z.literal('semantic'),
    clipId: id.optional(),
    role: id.optional(),
    entity: id.optional(),
    concept: id.optional(),
    tag: id.optional(),
    component: z.enum(componentTypes).optional(),
    match: z.enum(['one', 'many']).default('one'),
  })
  .strict()
  .refine(
    (t) =>
      !!(t.clipId || t.role || t.entity || t.concept || t.tag || t.component),
    'Empty semantic selector',
  );
const clipTarget = z.object({ kind: z.literal('clip'), clipId: id }).strict();
export const clipTargetSchema = z.union([clipTarget, semanticSelectorSchema]);
const sceneTarget = z
  .object({ kind: z.literal('scene'), sceneId: id })
  .strict();
export const editTargetSchema = z.union([
  z.object({ kind: z.literal('project') }).strict(),
  sceneTarget,
  clipTargetSchema,
  z.object({ kind: z.literal('narration-segment'), segmentId: id }).strict(),
]);
const component = z.enum(componentTypes);
export const patchOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('update-composition-params'),
      target: clipTargetSchema,
      parameters: compositionParameterValuesSchema.refine(
        (p) => Object.keys(p).length > 0,
        'Empty parameters',
      ),
    })
    .strict(),
  z
    .object({
      op: z.literal('update-clip'),
      target: clipTargetSchema,
      patch: z
        .object({
          props: props.optional(),
          transform: transformPatchSchema.optional(),
          effects: visualEffectsSchema.partial().optional(),
          motion: z.array(motionSchema).max(16).optional(),
        })
        .strict()
        .refine(nonempty, 'Empty clip patch'),
    })
    .strict(),
  z
    .object({
      op: z.literal('retime-clip'),
      target: clipTargetSchema,
      startFrame: frame.optional(),
      durationFrames: frame.min(1).optional(),
      shiftFrames: z.number().int().optional(),
    })
    .strict()
    .refine(
      (o) =>
        o.shiftFrames !== undefined
          ? o.startFrame === undefined && o.durationFrames === undefined
          : o.startFrame !== undefined || o.durationFrames !== undefined,
      'Use shiftFrames or absolute timing, never both',
    ),
  z
    .object({
      op: z.literal('update-scene'),
      target: sceneTarget,
      patch: projectSchema.shape.scenes.element
        .pick({
          name: true,
          startFrame: true,
          durationFrames: true,
          layout: true,
        })
        .partial()
        .strict()
        .refine(nonempty, 'Empty scene patch'),
    })
    .strict(),
  z
    .object({
      op: z.literal('set-theme'),
      theme: z.enum(['dark-tech', 'paper-sketch', 'editorial']),
    })
    .strict(),
  z
    .object({
      op: z.literal('update-camera'),
      patch: z
        .object({
          x: z.number().optional(),
          y: z.number().optional(),
          zoom: z.number().positive().optional(),
          rotation: z.number().optional(),
          animations: z.array(cameraAnimationSchema).max(4).optional(),
        })
        .strict()
        .refine(nonempty, 'Empty camera patch'),
    })
    .strict(),
  z
    .object({
      op: z.literal('update-narration'),
      segmentId: id,
      patch: z
        .object({
          text: z.string().optional(),
          phraseMappings: z.array(phraseMappingSchema).optional(),
          cues: z.array(semanticCueSchema).optional(),
          subtitleMode: z.enum(['phrase', 'active-word']).optional(),
        })
        .strict()
        .refine(nonempty, 'Empty narration patch'),
    })
    .strict(),
  z
    .object({
      op: z.literal('add-component'),
      sceneId: id,
      trackId: id.optional(),
      component,
      id: id.optional(),
      startFrame: frame.optional(),
      durationFrames: frame.min(1).optional(),
      props: props.optional(),
      transform: transformPatchSchema.optional(),
      semantic: semanticMetadataSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal('delete-component'), clipId: id }).strict(),
  z
    .object({
      op: z.literal('replace-component'),
      clipId: id,
      component,
      props: props.optional(),
      preserve: z
        .object({
          timing: z.boolean().optional(),
          transform: z.boolean().optional(),
          semantic: z.boolean().optional(),
          motion: z.boolean().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
const planObjectSchema = z
  .object({
    version: z.literal(1),
    id,
    description: z.string().max(2000).optional(),
    operations: z.array(patchOperationSchema).min(1).max(100),
  })
  .strict();
export const patchPlanSchema = z
  .custom<z.input<typeof planObjectSchema>>(
    isSafeJSON,
    'Only safe plain JSON data is allowed',
  )
  .pipe(planObjectSchema);
export type SceneWirePatchPlan = z.input<typeof patchPlanSchema>;
export type PatchOperation = z.input<typeof patchOperationSchema>;
export type ParsedPatchOperation = z.output<typeof patchOperationSchema>;
export type EditTarget = z.input<typeof editTargetSchema>;
export type ClipTarget = z.input<typeof clipTargetSchema>;
