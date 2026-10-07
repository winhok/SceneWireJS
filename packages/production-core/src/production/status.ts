import { inspectGraph } from '../incremental/graph';
import { assertDigest, canonicalDigest } from '../incremental/digest';
import { recipeIdentity, outputIdentity, candidateIdentity } from './identity';
import {
  type ProductionGraph,
  type ProductionArtifactRecord,
  type ProductionStatus,
  type ProductionStaleReason,
  type RecipeDigest,
} from './contracts';

/** Synthetic/product graph validation only. Authored-production adaptation is Phase 2. */
export function orderProductionGraph(graph: ProductionGraph) {
  const entries = inspectGraph(
    graph.artifacts.map((a) => ({
      id: a.id,
      kind: a.kind,
      digest: recipeIdentity(a.kind, a.recipe, {}, a.reviewCandidate),
      dependencies: [...a.dependencies],
    })),
    [],
  );
  const artifacts = new Map(graph.artifacts.map((a) => [a.id, a]));
  return entries.map((e) => artifacts.get(e.id)!);
}
export function productionRecipeDigests(
  graph: ProductionGraph,
): Map<string, RecipeDigest> {
  const result = new Map<string, RecipeDigest>();
  for (const artifact of orderProductionGraph(graph)) {
    result.set(
      artifact.id,
      recipeIdentity(
        artifact.kind,
        artifact.recipe,
        Object.fromEntries(
          [...artifact.dependencies].sort().map((id) => [id, result.get(id)!]),
        ),
        artifact.reviewCandidate,
      ),
    );
  }
  return result;
}
/** Caller supplies freshly read bytes from disposable cache OR durable evidence.
 * No filesystem existence, unverified output digest, or saved boolean establishes reuse. */
export function inspectProductionStatus(
  graph: ProductionGraph,
  records: readonly ProductionArtifactRecord[],
  outputs: ReadonlyMap<string, Uint8Array>,
): ProductionStatus[] {
  const current = productionRecipeDigests(graph);
  const stored = new Map<string, ProductionArtifactRecord>();
  for (const record of records) {
    if (stored.has(record.id) || !record.id.trim() || !record.kind.trim())
      throw new Error('Invalid record ID');
    assertDigest(record.recipeDigest);
    assertDigest(record.outputDigest);
    if (
      recipeIdentity(
        record.kind,
        record.recipe,
        record.dependencyRecipeDigests,
        record.reviewCandidate,
      ) !== record.recipeDigest
    )
      throw new Error('Inconsistent recipe record');
    if (record.reviewCandidate) candidateIdentity(record.reviewCandidate);
    stored.set(record.id, record);
  }
  const statuses = new Map<string, ProductionStatus>();
  for (const artifact of orderProductionGraph(graph)) {
    const record = stored.get(artifact.id),
      digest = current.get(artifact.id)!;
    const reasons: ProductionStaleReason[] = [];
    if (artifact.reviewCandidate) candidateIdentity(artifact.reviewCandidate);
    if (record) {
      if (
        record.kind !== artifact.kind ||
        canonicalDigest('production/inputs-v1', record.recipe.inputs) !==
          canonicalDigest('production/inputs-v1', artifact.recipe.inputs)
      )
        reasons.push({
          code: 'recipe-changed',
          previousDigest: record.recipeDigest,
          currentDigest: digest,
        });
      if (
        canonicalDigest('production/producer-v1', record.recipe.producer) !==
        canonicalDigest('production/producer-v1', artifact.recipe.producer)
      )
        reasons.push({ code: 'producer-changed' });
      if (
        canonicalDigest(
          'production/environment-v1',
          record.recipe.environment ?? null,
        ) !==
        canonicalDigest(
          'production/environment-v1',
          artifact.recipe.environment ?? null,
        )
      )
        reasons.push({ code: 'environment-changed' });
      const oldCandidate = record.reviewCandidate
        ? candidateIdentity(record.reviewCandidate)
        : undefined;
      const newCandidate = artifact.reviewCandidate
        ? candidateIdentity(artifact.reviewCandidate)
        : undefined;
      if (oldCandidate !== newCandidate)
        reasons.push({
          code: 'review-candidate-changed',
          ...(oldCandidate ? { previousDigest: oldCandidate } : {}),
          ...(newCandidate ? { currentDigest: newCandidate } : {}),
        });
      for (const id of [
        ...new Set([
          ...artifact.dependencies,
          ...Object.keys(record.dependencyRecipeDigests),
        ]),
      ].sort()) {
        if (
          record.dependencyRecipeDigests[id] !== current.get(id) ||
          !artifact.dependencies.includes(id)
        )
          reasons.push({
            code: 'dependency-changed',
            dependencyId: id,
            ...(record.dependencyRecipeDigests[id]
              ? { previousDigest: record.dependencyRecipeDigests[id] }
              : {}),
            ...(current.get(id) ? { currentDigest: current.get(id) } : {}),
          });
      }
    }
    for (const id of [...artifact.dependencies].sort()) {
      const status = statuses.get(id)!;
      if (status.status !== 'fresh')
        reasons.push({
          code:
            status.status === 'missing'
              ? 'dependency-missing'
              : 'dependency-changed',
          dependencyId: id,
        });
    }
    const bytes = outputs.get(artifact.id);
    if (record && bytes && outputIdentity(bytes) !== record.outputDigest)
      reasons.push({
        code: 'cache-corrupt',
        previousDigest: record.outputDigest,
        currentDigest: outputIdentity(bytes),
      });
    if (!record || !bytes) reasons.push({ code: 'cache-missing' });
    const unique = [
      ...new Map(reasons.map((r) => [JSON.stringify(r), r])).values(),
    ];
    statuses.set(artifact.id, {
      id: artifact.id,
      recipeDigest: digest,
      ...(record ? { previousRecipeDigest: record.recipeDigest } : {}),
      status: !record || !bytes ? 'missing' : unique.length ? 'stale' : 'fresh',
      reasons: unique,
    });
  }
  return [...statuses.values()];
}
/** Durable review truth remains separate from availability of render cache bytes. */
export function reviewRetention(
  previous: unknown,
  current: unknown,
): 'retained' | 'invalidated' {
  return candidateIdentity(previous) === candidateIdentity(current)
    ? 'retained'
    : 'invalidated';
}
