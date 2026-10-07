import {
  type ProductionStatus,
  type ProductionStaleReason,
  type ProductionBuildReport,
} from './contracts';
import { z } from 'zod';
import { digest } from '../contracts/common';
import { rasterMetrics, type RasterWork } from './media-metrics';

export interface ProductionStatusArtifact extends ProductionStatus {
  kind: string;
  dependencies: readonly string[];
  scene?: { id: string; startFrame: number; endFrame: number };
  /** Candidate validity only; never a disposition or invented approval. */
  reviewRetention?: 'retained' | 'invalidated' | 'unbound';
}
export interface ProductionStatusResult {
  schemaVersion: 1;
  production: { id: string };
  artifacts: ProductionStatusArtifact[];
  summary: { fresh: number; stale: number; missing: number };
}
export interface ProductionCause {
  artifactId: string;
  reason: ProductionStaleReason;
}
export interface ProductionExplainResult {
  schemaVersion: 1;
  production: { id: string };
  artifact: ProductionStatusArtifact;
  directCauses: ProductionCause[];
  /** Unique upstream causes, with explicit edges preserved by dependencyId. */
  transitiveCauses: ProductionCause[];
  affectedDirectDependencies: string[];
  unaffected: ProductionStatusArtifact[];
  unaffectedScope: {
    policy: 'adjacent-scenes-and-shared-dependency-peers';
    limit: 12;
    truncated: boolean;
  };
}

const reasonSchema = z
  .object({
    code: z.enum([
      'recipe-changed',
      'dependency-changed',
      'dependency-missing',
      'producer-changed',
      'environment-changed',
      'cache-missing',
      'cache-corrupt',
      'review-candidate-changed',
    ]),
    dependencyId: z.string().min(1).optional(),
    previousDigest: digest.optional(),
    currentDigest: digest.optional(),
  })
  .strict();
const artifactSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    status: z.enum(['fresh', 'stale', 'missing']),
    recipeDigest: digest,
    previousRecipeDigest: digest.optional(),
    reasons: z.array(reasonSchema),
    dependencies: z.array(z.string().min(1)),
    scene: z
      .object({
        id: z.string().min(1),
        startFrame: z.number().int().nonnegative(),
        endFrame: z.number().int().positive(),
      })
      .strict()
      .refine((s) => s.endFrame > s.startFrame)
      .optional(),
    reviewRetention: z.enum(['retained', 'invalidated', 'unbound']).optional(),
  })
  .strict();
const productionSchema = z.object({ id: z.string().min(1) }).strict();
/** Internal consumer schemas; no public exports are added in Phase 2. */
export const productionStatusResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    production: productionSchema,
    artifacts: z.array(artifactSchema),
    summary: z
      .object({
        fresh: z.number().int().nonnegative(),
        stale: z.number().int().nonnegative(),
        missing: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.artifacts.map((a) => a.id)).size !== value.artifacts.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate artifact' });
    for (const status of ['fresh', 'stale', 'missing'] as const)
      if (
        value.artifacts.filter((a) => a.status === status).length !==
        value.summary[status]
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Inconsistent status summary',
        });
  });
const causeSchema = z
  .object({ artifactId: z.string().min(1), reason: reasonSchema })
  .strict();
export const productionExplainResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    production: productionSchema,
    artifact: artifactSchema,
    directCauses: z.array(causeSchema),
    transitiveCauses: z.array(causeSchema),
    affectedDirectDependencies: z.array(z.string().min(1)),
    unaffected: z.array(artifactSchema).max(12),
    unaffectedScope: z
      .object({
        policy: z.literal('adjacent-scenes-and-shared-dependency-peers'),
        limit: z.literal(12),
        truncated: z.boolean(),
      })
      .strict(),
  })
  .strict();

/** Execution truth; raster receipts require media validation, never graph prediction. */
export interface ProductionBuildResult extends ProductionBuildReport {
  schemaVersion: 1;
  production: { id: string };
  outcome: 'complete' | 'blocked';
  mediaExecution?: true;
  diagnostics: {
    code: 'unsupported-producer' | 'conflicting-output';
    artifactId: string;
  }[];
  artifacts: {
    id: string;
    kind?: string;
    action: 'reused' | 'rebuilt';
    outputDigest: string;
    causes: ProductionStaleReason[];
    raster?: RasterWork;
  }[];
}
const count = z.number().int().nonnegative();
export const productionBuildResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    production: productionSchema,
    outcome: z.enum(['complete', 'blocked']),
    mediaExecution: z.literal(true).optional(),
    diagnostics: z.array(
      z
        .object({
          code: z.enum(['unsupported-producer', 'conflicting-output']),
          artifactId: z.string().min(1),
        })
        .strict(),
    ),
    artifacts: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: z.string().min(1).optional(),
          action: z.enum(['reused', 'rebuilt']),
          outputDigest: digest,
          causes: z.array(reasonSchema),
          raster: z
            .object({ startFrame: count, endFrame: count })
            .strict()
            .refine((r) => r.endFrame > r.startFrame)
            .optional(),
        })
        .strict(),
    ),
    artifactsTotal: count,
    artifactsReused: count,
    artifactsRebuilt: count,
    rangesReused: count,
    rangesRendered: count,
    framesReused: count,
    framesRendered: count,
    bytesReused: count,
    bytesWritten: count,
    reviewsRetained: count,
    reviewsInvalidated: count,
    cacheHitRatio: z.number().min(0).max(1),
    elapsedMs: z.number().nonnegative(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const completed = v.artifactsReused + v.artifactsRebuilt;
    const measured = rasterMetrics(v.artifacts);
    if (
      v.mediaExecution &&
      v.artifacts.some(
        (a) =>
          !a.kind || (a.kind === 'render-range-raster') !== Boolean(a.raster),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Every completed media raster requires a verified receipt',
      });
    if (
      completed > v.artifactsTotal ||
      (v.outcome === 'complete' && completed !== v.artifactsTotal) ||
      v.cacheHitRatio !== (v.artifactsReused / completed || 0) ||
      v.artifacts.length !== completed ||
      new Set(v.artifacts.map((a) => a.id)).size !== completed ||
      v.artifacts.filter((a) => a.action === 'reused').length !==
        v.artifactsReused ||
      v.artifacts.filter((a) => a.action === 'rebuilt').length !==
        v.artifactsRebuilt ||
      (v.outcome === 'complete') !== (v.diagnostics.length === 0) ||
      Object.entries(measured).some(
        ([key, value]) => v[key as keyof typeof measured] !== value,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent execution metrics',
      });
  });
