import { z } from 'zod';
import { canonicalDigest } from './digest';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1);
const specSchema = z
  .object({
    projectDigest: digest,
    sourceDigest: digest,
    assetDigests: z.record(text, digest),
    range: z
      .object({
        startFrame: z.number().int().nonnegative(),
        endFrame: z.number().int().positive(),
      })
      .strict()
      .refine((range) => range.endFrame > range.startFrame),
    fps: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    rendererProfile: text,
    captureBackend: text,
    sceneWireVersion: text,
  })
  .strict();
export type RenderRangeSpec = z.infer<typeof specSchema>;
/** Explicit producer-supplied fingerprints; acquisition is outside the foundation. */
const environmentSchema = z
  .object({
    platform: text,
    runtime: text,
    fontsDigest: digest,
    rasterizer: text,
  })
  .strict();
export type RasterEnvironment = z.infer<typeof environmentSchema>;
export function renderRangeIdentity(
  spec: RenderRangeSpec,
  environment: RasterEnvironment,
): { logical: string; raster: string } {
  const parsed = specSchema.parse(spec);
  const fingerprint = environmentSchema.parse(environment);
  const logical = canonicalDigest('render-range/logical-v1', parsed);
  return {
    logical,
    raster: canonicalDigest('render-range/raster-v1', {
      logical,
      environment: fingerprint,
    }),
  };
}
