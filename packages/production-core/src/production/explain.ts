import { type SceneReviewV2 } from '../contracts/review-v2';
import {
  type ProductionGraph,
  type ProductionArtifactRecord,
} from './contracts';
import { inspectProductionStatus, reviewRetention } from './status';
import {
  type ProductionStatusResult,
  type ProductionExplainResult,
  type ProductionCause,
} from './result-contracts';

export function productionStatusResult(
  productionId: string,
  graph: ProductionGraph,
  records: readonly ProductionArtifactRecord[],
  outputs: ReadonlyMap<string, Uint8Array>,
  reviews: readonly SceneReviewV2[] = [],
): ProductionStatusResult {
  if (!productionId.trim()) throw new Error('Missing production ID');
  const nodes = new Map(graph.artifacts.map((a) => [a.id, a]));
  const sceneRanges = graph.artifacts
    .filter((a) => a.kind === 'scene-authored')
    .map((a) => {
      const logical = nodes.get(`${a.id}:range:logical`);
      const inputs = logical?.recipe.inputs as
        | { spec?: { range?: { startFrame: number; endFrame: number } } }
        | undefined;
      return { id: a.id, range: inputs?.spec?.range };
    });
  const artifacts = inspectProductionStatus(graph, records, outputs).map(
    (status) => {
      const node = nodes.get(status.id)!;
      const review = reviews.find(
        (r) => `scene:${r.sceneId}:review` === node.id,
      );
      const scene = sceneRanges.find(
        (s) => status.id === s.id || status.id.startsWith(`${s.id}:`),
      );
      return {
        ...status,
        kind: node.kind,
        dependencies: [...node.dependencies].sort(),
        ...(scene?.range ? { scene: { id: scene.id, ...scene.range } } : {}),
        ...(node.reviewCandidate
          ? {
              reviewRetention: review
                ? reviewRetention(review.candidate, node.reviewCandidate)
                : ('unbound' as const),
            }
          : {}),
      };
    },
  );
  return {
    schemaVersion: 1,
    production: { id: productionId },
    artifacts,
    summary: {
      fresh: artifacts.filter((a) => a.status === 'fresh').length,
      stale: artifacts.filter((a) => a.status === 'stale').length,
      missing: artifacts.filter((a) => a.status === 'missing').length,
    },
  };
}

export function explainProductionArtifact(
  result: ProductionStatusResult,
  artifactId: string,
): ProductionExplainResult {
  const nodes = new Map(result.artifacts.map((a) => [a.id, a]));
  const artifact = nodes.get(artifactId);
  if (!artifact) throw new Error(`Unknown production artifact: ${artifactId}`);
  const directCauses = artifact.reasons.map((reason) => ({
    artifactId,
    reason,
  }));
  const transitive = new Map<string, ProductionCause>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id) || id === artifactId) return;
    visited.add(id);
    const node = nodes.get(id);
    if (!node) return; // Removed previous dependency is represented by its direct cause.
    for (const reason of node.reasons) {
      const cause = { artifactId: id, reason };
      transitive.set(JSON.stringify(cause), cause);
      if (reason.dependencyId) visit(reason.dependencyId);
    }
  };
  directCauses.forEach((c) => {
    if (c.reason.dependencyId) visit(c.reason.dependencyId);
  });
  const affectedDirectDependencies = [
    ...new Set(
      artifact.reasons.flatMap((r) => (r.dependencyId ? [r.dependencyId] : [])),
    ),
  ].sort();
  // Neighboring authored scene nodes and same-kind direct-dependency peers; bounded and positive byte proof.
  const scenes = result.artifacts
    .filter((a) => a.kind === 'scene-authored')
    .sort(
      (a, b) =>
        (a.scene?.startFrame ?? 0) - (b.scene?.startFrame ?? 0) ||
        (a.id < b.id ? -1 : 1),
    );
  const dependsOn = (
    id: string,
    target: string,
    seen = new Set<string>(),
  ): boolean => {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (
      nodes.get(id)?.dependencies.some((dep) => dependsOn(dep, target, seen)) ??
      false
    );
  };
  const ownScene =
    scenes.find(
      (s) => artifact.id === s.id || artifact.id.startsWith(`${s.id}:`),
    ) ?? scenes.find((s) => dependsOn(s.id, artifact.id));
  const index = ownScene ? scenes.indexOf(ownScene) : -1;
  const neighborIds = new Set(
    index < 0
      ? []
      : [scenes[index - 1]?.id, scenes[index + 1]?.id].filter(
          (id): id is string => !!id,
        ),
  );
  const peers = result.artifacts
    .filter(
      (a) =>
        a.id !== artifact.id &&
        a.status === 'fresh' &&
        (neighborIds.has(a.id) ||
          (a.kind === artifact.kind &&
            a.dependencies.some((d) => artifact.dependencies.includes(d)))),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    schemaVersion: 1,
    production: result.production,
    artifact,
    directCauses,
    transitiveCauses: [...transitive.values()].sort((a, b) =>
      JSON.stringify(a) < JSON.stringify(b) ? -1 : 1,
    ),
    affectedDirectDependencies,
    unaffected: peers.slice(0, 12),
    unaffectedScope: {
      policy: 'adjacent-scenes-and-shared-dependency-peers',
      limit: 12,
      truncated: peers.length > 12,
    },
  };
}
