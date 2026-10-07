import { z } from 'zod';
import { type RasterEnvironment } from '../incremental/render-range';
import { type CandidateBinding } from '../contracts/review-v2';
import { canonicalJson } from '../incremental/digest';

export type FiniteJson =
  | null
  | boolean
  | number
  | string
  | FiniteJson[]
  | { [key: string]: FiniteJson };
export type RecipeDigest = string & { readonly recipeDigest: unique symbol };
export type OutputDigest = string & { readonly outputDigest: unique symbol };
export interface ProductionRecipe {
  inputs: FiniteJson;
  producer: { id: string; version: string };
  /** Omitted for logical artifacts; only semantic raster fields are accepted. */
  environment?: RasterEnvironment;
}
export interface ProductionArtifact {
  id: string;
  /** Semantic kind participates in production/recipe-v1 identity. */
  kind: string;
  dependencies: readonly string[];
  recipe: ProductionRecipe;
  reviewCandidate?: CandidateBinding;
}
export interface ProductionGraph {
  artifacts: readonly ProductionArtifact[];
}
export interface ProductionArtifactRecord {
  id: string;
  /** Semantic kind participates in production/recipe-v1 identity. */
  kind: string;
  recipeDigest: RecipeDigest;
  outputDigest: OutputDigest;
  recipe: ProductionRecipe;
  dependencyRecipeDigests: Record<string, RecipeDigest>;
  reviewCandidate?: CandidateBinding;
}
export type StaleReasonCode =
  | 'recipe-changed'
  | 'dependency-changed'
  | 'dependency-missing'
  | 'producer-changed'
  | 'environment-changed'
  | 'cache-missing'
  | 'cache-corrupt'
  | 'review-candidate-changed';
export interface ProductionStaleReason {
  code: StaleReasonCode;
  dependencyId?: string;
  previousDigest?: string;
  currentDigest?: string;
}
export interface ProductionStatus {
  id: string;
  status: 'fresh' | 'stale' | 'missing';
  recipeDigest: RecipeDigest;
  previousRecipeDigest?: RecipeDigest;
  reasons: ProductionStaleReason[];
}
/** Execution metrics, not inferred savings. Retention never means review PASS. */
export interface ProductionBuildReport {
  artifactsTotal: number;
  artifactsReused: number;
  artifactsRebuilt: number;
  rangesReused: number;
  rangesRendered: number;
  framesReused: number;
  framesRendered: number;
  bytesReused: number;
  /** Bytes produced and committed by rebuilt artifacts, including existing CAS blobs. */
  bytesWritten: number;
  reviewsRetained: number;
  reviewsInvalidated: number;
  cacheHitRatio: number;
  elapsedMs: number;
  estimatedSavedMs?: number;
}
const profile = z
  .record(z.string().min(1), z.unknown())
  .superRefine((value, ctx) => {
    try {
      canonicalJson(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Finite JSON profile required' });
    }
  })
  .transform((value) => value as { [key: string]: FiniteJson });
/** Descriptive, combinable profiles. No engine or closed style taxonomy. */
export const visualSystemSchema = z
  .object({
    id: z.string().min(1),
    family: z.string().min(1),
    primaryStyle: z.string().min(1),
    influences: z.array(z.string().min(1)),
    palette: profile,
    typography: profile,
    motionGrammar: profile,
    transitionGrammar: profile,
    texture: profile,
    depth: profile,
    brandAssets: z.record(
      z.string().min(1),
      z.string().regex(/^[a-f0-9]{64}$/),
    ),
    safeZones: profile,
    sharedDirection: profile,
  })
  .strict();
export type VisualSystem = z.infer<typeof visualSystemSchema>;
