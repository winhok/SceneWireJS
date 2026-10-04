import { assertDigest } from './digest';
export interface ArtifactNode {
  id: string;
  kind: string;
  digest: string;
  dependencies: string[];
}
export interface ArtifactRecord extends ArtifactNode {
  producer: { id: string; version: string };
  dependencyDigests: Record<string, string>;
}
export interface StalenessEntry {
  id: string;
  kind: string;
  currentDigest: string;
  dependencyDigests: Record<string, string>;
  producer?: ArtifactRecord['producer'];
  status: 'fresh' | 'stale' | 'missing';
  reasons: string[];
}
export function inspectGraph(
  nodes: readonly ArtifactNode[],
  records: readonly ArtifactRecord[],
): StalenessEntry[] {
  const graph = new Map<string, ArtifactNode>();
  for (const node of nodes) {
    assertDigest(node.digest);
    if (!node.id.trim() || !node.kind.trim() || graph.has(node.id))
      throw new Error('Invalid or duplicate artifact ID');
    if (new Set(node.dependencies).size !== node.dependencies.length)
      throw new Error('Duplicate dependency');
    graph.set(node.id, node);
  }
  const stored = new Map<string, ArtifactRecord>();
  for (const record of records) {
    assertDigest(record.digest);
    if (
      stored.has(record.id) ||
      !record.id.trim() ||
      !record.kind.trim() ||
      new Set(record.dependencies).size !== record.dependencies.length ||
      Object.keys(record.dependencyDigests).length !==
        record.dependencies.length ||
      record.dependencies.some(
        (id) => !Object.hasOwn(record.dependencyDigests, id),
      ) ||
      !record.producer.id.trim() ||
      !record.producer.version.trim()
    )
      throw new Error('Invalid artifact record');
    Object.values(record.dependencyDigests).forEach(assertDigest);
    stored.set(record.id, record);
  }
  const visiting = new Set<string>();
  const done = new Map<string, StalenessEntry>();
  function visit(id: string): void {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error('Artifact dependency cycle');
    const node = graph.get(id);
    if (!node) throw new Error('Missing dependency: ' + id);
    visiting.add(id);
    [...node.dependencies].sort().forEach(visit);
    visiting.delete(id);
    const record = stored.get(id);
    const reasons: string[] = [];
    const dependencyDigests = Object.fromEntries(
      [...node.dependencies].sort().map((dep) => [dep, graph.get(dep)!.digest]),
    );
    if (record) {
      if (record.digest !== node.digest || record.kind !== node.kind)
        reasons.push('artifact changed');
      if (
        Object.keys(record.dependencyDigests).length !==
          node.dependencies.length ||
        record.dependencies.length !== node.dependencies.length ||
        record.dependencies.some((dep) => !node.dependencies.includes(dep))
      )
        reasons.push('dependency set changed');
      for (const dep of [...node.dependencies].sort()) {
        if (record.dependencyDigests[dep] !== graph.get(dep)!.digest)
          reasons.push('dependency changed: ' + dep);
        if (done.get(dep)!.status !== 'fresh')
          reasons.push('dependency unavailable: ' + dep);
      }
    }
    done.set(id, {
      id,
      kind: node.kind,
      currentDigest: node.digest,
      dependencyDigests,
      ...(record ? { producer: record.producer } : {}),
      status: !record ? 'missing' : reasons.length ? 'stale' : 'fresh',
      reasons,
    });
  }
  [...graph.keys()].sort().forEach(visit);
  return [...done.values()];
}
