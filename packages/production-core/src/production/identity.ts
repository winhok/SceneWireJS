import {
  narrationSchema,
  semanticCueSchema,
  type NarrationDocument,
} from '@scenewirejs/schema';
import { z } from 'zod';
import { candidateBindingSchema } from '../contracts/review-v2';
import {
  canonicalDigest,
  bytesDigest,
  assertDigest,
} from '../incremental/digest';
import { renderRangeIdentity } from '../incremental/render-range';
import {
  type ProductionRecipe,
  type RecipeDigest,
  type OutputDigest,
} from './contracts';

export const producerSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .refine((v) => !!v.trim()),
    version: z
      .string()
      .min(1)
      .refine((v) => !!v.trim()),
  })
  .strict();
export const environmentSchema = z
  .object({
    platform: z.string().trim().min(1),
    runtime: z.string().trim().min(1),
    fontsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    rasterizer: z.string().trim().min(1),
  })
  .strict();
/** Complete semantic envelope shared by graph identity and persisted records. */
export function recipeIdentity(
  kind: string,
  recipe: ProductionRecipe,
  dependencies: Record<string, RecipeDigest>,
  reviewCandidate?: unknown,
): RecipeDigest {
  z.string()
    .min(1)
    .refine((v) => !!v.trim())
    .parse(kind);
  producerSchema.parse(recipe.producer);
  Object.values(dependencies).forEach(assertDigest);
  if (recipe.environment) environmentSchema.parse(recipe.environment);
  return canonicalDigest('production/recipe-v1', {
    kind,
    inputs: recipe.inputs,
    producer: recipe.producer,
    dependencies,
    ...(reviewCandidate
      ? { reviewCandidate: candidateIdentity(reviewCandidate) }
      : {}),
    ...(recipe.environment ? { environment: recipe.environment } : {}),
  }) as RecipeDigest;
}
export function outputIdentity(bytes: Uint8Array): OutputDigest {
  return bytesDigest(bytes) as OutputDigest;
}
export function candidateIdentity(candidate: unknown): string {
  const parsed = candidateBindingSchema.parse(candidate);
  if (new Set(parsed.assets.map((a) => a.path)).size !== parsed.assets.length)
    throw new Error('Duplicate candidate asset');
  return canonicalDigest('production/review-candidate-v1', {
    ...parsed,
    assets: [...parsed.assets].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  });
}
/** Reuse the existing logical/raster identity contract, not a second range model. */
export const productionRangeIdentity = renderRangeIdentity;
export interface SemanticCueBinding {
  segmentId: string;
  cueId: string;
  /** Existing aligned phrase text + occurrence, never an absolute timeline position. */
  phrase?: { text: string; occurrence: number };
}
export function semanticCueIdentity(
  narration: NarrationDocument,
  binding: SemanticCueBinding,
): string {
  const document = narrationSchema.parse(narration);
  if (
    new Set(document.segments.map((s) => s.id)).size !==
    document.segments.length
  )
    throw new Error('Duplicate narration segment');
  const segment = document.segments.find((s) => s.id === binding.segmentId);
  if (!segment) throw new Error('Missing narration segment');
  const cues = segment.cues ?? [];
  if (new Set(cues.map((c) => c.id)).size !== cues.length)
    throw new Error('Duplicate narration cue');
  const cue = semanticCueSchema.parse(cues.find((c) => c.id === binding.cueId));
  if (
    binding.phrase &&
    (!Number.isInteger(binding.phrase.occurrence) ||
      binding.phrase.occurrence < 0 ||
      !(segment.phrases ?? []).filter((p) => p.text === binding.phrase!.text)[
        binding.phrase.occurrence
      ])
  )
    throw new Error('Missing phrase binding');
  return canonicalDigest('production/semantic-cue-v1', {
    segmentId: segment.id,
    ...(segment.sceneId ? { sceneId: segment.sceneId } : {}),
    cue: {
      id: cue.id,
      source: cue.source,
      action: cue.action,
      target: cue.target,
      ...(cue.payload ? { payload: cue.payload } : {}),
    },
    ...(binding.phrase ? { phrase: binding.phrase } : { text: segment.text }),
  });
}
