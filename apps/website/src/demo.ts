import type {
  ProductionStatusResult,
  ProductionExplainResult,
} from '../../../packages/production-core/src/production/result-contracts';
import type { RecipeDigest } from '../../../packages/production-core/src/production/contracts';
const digest = (character: string) => character.repeat(64) as RecipeDigest;
export const fixtureProvenance = {
  source: 'Website-authored illustrative fixture, not renderer execution',
  schemaVersion: 1,
  reviewedSchemaRevision: '29215fecdf302aa705c7b8a6caaa5efa943742a4',
  qualification: 'pending',
} as const;
export function statusFixture(edited: boolean): ProductionStatusResult {
  const artifacts = ['A', 'B', 'C'].map((id, index) => ({
    id: `raster:${id}`,
    kind: 'render-range-raster',
    status: edited && id === 'B' ? ('stale' as const) : ('fresh' as const),
    recipeDigest: digest(edited && id === 'B' ? 'd' : String(index + 1)),
    reasons:
      edited && id === 'B'
        ? [
            {
              code: 'recipe-changed' as const,
              previousDigest: digest('2'),
              currentDigest: digest('d'),
            },
          ]
        : [],
    dependencies: [`range:${id}`],
    scene: { id, startFrame: index * 180, endFrame: (index + 1) * 180 },
    reviewRetention:
      edited && id === 'B' ? ('invalidated' as const) : ('retained' as const),
  }));
  return {
    schemaVersion: 1,
    production: { id: 'website-illustration' },
    artifacts,
    summary: { fresh: edited ? 2 : 3, stale: edited ? 1 : 0, missing: 0 },
  };
}
export const explainFixture: ProductionExplainResult = {
  schemaVersion: 1,
  production: { id: 'website-illustration' },
  artifact: {
    id: 'final-media',
    kind: 'final-media',
    status: 'stale',
    recipeDigest: digest('e'),
    reasons: [{ code: 'dependency-changed', dependencyId: 'raster:B' }],
    dependencies: ['raster:A', 'raster:B', 'raster:C', 'audio-mix'],
  },
  directCauses: [
    {
      artifactId: 'final-media',
      reason: { code: 'dependency-changed', dependencyId: 'raster:B' },
    },
  ],
  transitiveCauses: [
    {
      artifactId: 'raster:B',
      reason: {
        code: 'recipe-changed',
        previousDigest: digest('2'),
        currentDigest: digest('d'),
      },
    },
  ],
  affectedDirectDependencies: ['raster:B'],
  unaffected: statusFixture(true).artifacts.filter(
    (artifact) => artifact.status === 'fresh',
  ),
  unaffectedScope: {
    policy: 'adjacent-scenes-and-shared-dependency-peers',
    limit: 12,
    truncated: false,
  },
};

// Phase 3 blocked-build envelope: no synthetic rendering metrics are invented.
export const blockedBuildFixture = {
  schemaVersion: 1,
  production: { id: 'website-illustration' },
  outcome: 'blocked',
  diagnostics: [{ code: 'unsupported-producer', artifactId: 'raster:A' }],
  artifacts: [],
  artifactsTotal: 3,
  artifactsReused: 0,
  artifactsRebuilt: 0,
  rangesReused: 0,
  rangesRendered: 0,
  framesReused: 0,
  framesRendered: 0,
  bytesReused: 0,
  bytesWritten: 0,
  reviewsRetained: 0,
  reviewsInvalidated: 0,
  cacheHitRatio: 0,
  elapsedMs: 0,
} as const;
