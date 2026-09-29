import { z } from 'zod';
import { id } from './../common';
import { localProjectReferenceSchema } from './../common';
export const normalizedCropSchema = z
  .object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict()
  .refine(
    (c) => c.x + c.width <= 1 && c.y + c.height <= 1,
    'video.crop.invalid',
  );
export type NormalizedCrop = z.infer<typeof normalizedCropSchema>;
export const videoPropsSchema = z
  .object({
    assetId: id,
    sourceInMs: z.number().nonnegative(),
    playbackRate: z.number().min(0.25).max(4),
    fit: z.enum(['contain', 'cover', 'fill']),
    crop: normalizedCropSchema.optional(),
    placement: z.enum(['background', 'foreground', 'replace-scene']),
  })
  .strict();
export const videoAssetSchema = z
  .object({
    id,
    type: z.literal('video'),
    src: localProjectReferenceSchema,
    durationMs: z.number().positive(),
  })
  .strict();
export type VideoAsset = z.infer<typeof videoAssetSchema>;
export type VideoProps = z.infer<typeof videoPropsSchema>;
/** Logical media-relative time; never depends on decoder or previous frame. */
export function videoSourceTimeMs(
  clip: { startFrame: number; props: VideoProps },
  projectFrame: number,
  fps: number,
) {
  return (
    clip.props.sourceInMs +
    ((projectFrame - clip.startFrame) / fps) * 1000 * clip.props.playbackRate
  );
}
export function videoSourceOutMs(
  clip: { durationFrames: number; props: VideoProps },
  fps: number,
) {
  return (
    clip.props.sourceInMs +
    (clip.durationFrames / fps) * 1000 * clip.props.playbackRate
  );
}
