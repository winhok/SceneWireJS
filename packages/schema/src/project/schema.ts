import { z } from 'zod';
import { CURRENT_PROJECT_VERSION } from './../version';
import { color } from './../common';
import { videoAssetSchema } from './../assets/video';
import { id } from './../common';
import { localProjectReferenceSchema } from './../common';
import { frame } from './../common';
import { layoutSchema } from './../authoring';
import { trackSchema } from './../track';
import { narrationSchema } from './../narration';
import { cameraSchema } from './../camera';
import { validateProject } from './validation';
export const baseProjectSchema = z
  .object({
    id,
    version: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(CURRENT_PROJECT_VERSION),
    ]),
    metadata: z
      .object({
        title: z.string().min(1),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
      })
      .strict(),
    canvas: z
      .object({
        width: z.number().int().min(1).max(8192),
        height: z.number().int().min(1).max(8192),
        background: color,
      })
      .strict(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
    theme: z
      .object({
        name: z.string(),
        fontFamily: z.string().min(1),
        foreground: color,
        accent: color,
      })
      .strict(),
    seed: z.number().int().nonnegative().optional(),
    assets: z.array(
      z.union([
        videoAssetSchema,
        z
          .object({
            id,
            type: z.enum(['image', 'audio']),
            src: z.string().min(1),
            durationMs: z.number().nonnegative().optional(),
          })
          .strict(),
        z
          .object({
            id,
            type: z.literal('composition'),
            rendererId: id,
            src: localProjectReferenceSchema,
          })
          .strict(),
      ]),
    ),
    scenes: z
      .array(
        z
          .object({
            id,
            name: z.string(),
            startFrame: frame,
            durationFrames: frame.min(1),
            layout: z.union([z.string(), layoutSchema]).optional(),
          })
          .strict(),
      )
      .min(1),
    tracks: z.array(trackSchema),
    markers: z.array(z.object({ id, frame, label: z.string() }).strict()),
    narration: narrationSchema.optional(),
    camera: cameraSchema.optional(),
  })
  .strict();
export type ProjectShape = z.infer<typeof baseProjectSchema>;
export const projectSchema = baseProjectSchema.superRefine(validateProject);
export type VideoProject = z.infer<typeof projectSchema>;
