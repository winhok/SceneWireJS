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

/** Only IEEE-754 arithmetic roundoff is snapped, never probe uncertainty. */
export function mediaPlayableFrames(
  durationMs: number,
  sourceInMs: number,
  playbackRate: number,
  projectFps: number,
  terminalPartialFrame = false,
): number {
  if (
    ![durationMs, sourceInMs, playbackRate, projectFps].every(
      Number.isFinite,
    ) ||
    durationMs < 0 ||
    sourceInMs < 0 ||
    playbackRate <= 0 ||
    projectFps <= 0
  )
    throw new Error('Invalid media time inputs');
  const frames = Math.max(
    0,
    ((durationMs - sourceInMs) * projectFps) / (1000 * playbackRate),
  );
  const nearest = Math.round(frames);
  const snapped =
    Math.abs(frames - nearest) <=
    Number.EPSILON * Math.max(1, Math.abs(frames)) * 8
      ? nearest
      : frames;
  if (!terminalPartialFrame) return Math.floor(snapped);
  // Audio pads only the asset's terminal partial project frame. An offset
  // cannot create a fresh rounding allowance (or hide a real range overflow).
  const totalFrames = (durationMs * projectFps) / (1000 * playbackRate);
  const totalNearest = Math.round(totalFrames);
  const totalSnapped =
    Math.abs(totalFrames - totalNearest) <=
    Number.EPSILON * Math.max(1, Math.abs(totalFrames)) * 8
      ? totalNearest
      : totalFrames;
  const available = Math.max(
    0,
    Math.ceil(totalSnapped) - (sourceInMs * projectFps) / (1000 * playbackRate),
  );
  const availableNearest = Math.round(available);
  return Math.floor(
    Math.abs(available - availableNearest) <=
      Number.EPSILON * Math.max(1, Math.abs(available)) * 8
      ? availableNearest
      : available,
  );
}
export function mediaRangeDetails(
  durationMs: number,
  sourceInMs: number,
  playbackRate: number,
  projectFps: number,
  requestedFrameCount: number,
  terminalPartialFrame = false,
) {
  const sourceOut =
    sourceInMs + (requestedFrameCount * 1000 * playbackRate) / projectFps;
  return {
    sourceIn: sourceInMs,
    sourceOut,
    availableDuration: durationMs,
    requestedFrameCount,
    maxPlayableFrames: mediaPlayableFrames(
      durationMs,
      sourceInMs,
      playbackRate,
      projectFps,
      terminalPartialFrame,
    ),
    projectFps,
    playbackRate,
    delta: sourceOut - durationMs,
  };
}
