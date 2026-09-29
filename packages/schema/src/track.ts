import { z } from 'zod';
import { id } from './common';
import { frame } from './common';
import { clipSchema } from './clips/domain';
import { type VideoProject } from './project/schema';
import { type Clip } from './clips/domain';
export const audioClipSchema = z
  .object({
    id,
    assetId: id,
    startFrame: frame,
    durationFrames: frame.min(1),
    sourceOffsetMs: z.number().nonnegative().default(0),
    gain: z.number().min(0).max(4).default(1),
    fadeInFrames: frame.default(0),
    fadeOutFrames: frame.default(0),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.fadeInFrames > c.durationFrames || c.fadeOutFrames > c.durationFrames)
      ctx.addIssue({
        code: 'custom',
        message: 'Audio fade exceeds clip duration',
      });
  });
export type AudioClip = z.infer<typeof audioClipSchema>;
export const trackBase = {
  id,
  name: z.string(),
  locked: z.boolean().default(false),
  muted: z.boolean().default(false),
};
export const trackSchema = z.union([
  z
    .object({
      ...trackBase,
      type: z.enum(['visual', 'subtitle']),
      clips: z.array(clipSchema),
    })
    .strict(),
  z
    .object({
      ...trackBase,
      type: z.enum(['voice', 'music', 'sfx']),
      clips: z.array(audioClipSchema),
    })
    .strict(),
]);
export type Track = z.infer<typeof trackSchema>;
export type VisualTrack = Extract<Track, { type: 'visual' | 'subtitle' }>;
export type AudioTrack = Extract<Track, { type: 'voice' | 'music' | 'sfx' }>;
export function isVisualTrack(track: Track): track is VisualTrack {
  return track.type === 'visual' || track.type === 'subtitle';
}
export function isAudioTrack(track: Track): track is AudioTrack {
  return !isVisualTrack(track);
}
export function visualClips(project: VideoProject): Clip[] {
  return project.tracks.filter(isVisualTrack).flatMap((t) => t.clips);
}
