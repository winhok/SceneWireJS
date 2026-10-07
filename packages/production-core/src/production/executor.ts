import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ArtifactStore, writeAtomic } from '../incremental/store';
import { saveCheckpoint, resumeCheckpoint } from '../incremental/checkpoint';
import { canonicalJson, canonicalDigest } from '../incremental/digest';
import {
  orderProductionGraph,
  productionRecipeDigests,
  inspectProductionStatus,
  reviewRetention,
} from './status';
import { outputIdentity } from './identity';
import { rasterMetrics, type RasterWork } from './media-metrics';
import {
  type ProductionGraph,
  type ProductionArtifact,
  type ProductionArtifactRecord,
} from './contracts';
import {
  type ProductionBuildResult,
  productionBuildResultSchema,
} from './result-contracts';

export interface ArtifactExecutionContext {
  artifact: ProductionArtifact;
  dependencies: ReadonlyMap<
    string,
    { record: ProductionArtifactRecord; bytes: Uint8Array }
  >;
  previousRecord?: ProductionArtifactRecord;
  signal?: AbortSignal;
}
export type ArtifactProducer = (
  context: ArtifactExecutionContext,
) => Promise<Uint8Array>;
export interface ProductionBuildOptions {
  productionId: string;
  graph: ProductionGraph;
  stateDirectory: string;
  producers: ReadonlyMap<string, ArtifactProducer>;
  /** A real media build must validate every completed raster, including reuse. */
  mediaExecution?: true;
  /** Inspect real raster media bytes on rebuilt AND reused outputs. */
  rasterMeasurement?: (
    context: ArtifactExecutionContext,
    bytes: Uint8Array,
  ) => Promise<RasterWork>;
  signal?: AbortSignal;
  /** Actual durable review bindings supplied by the host, never inferred from cache. */
  reviews?: readonly { artifactId: string; candidate: unknown }[];
  onProgress?: (id: string, action: 'reused' | 'rebuilt') => void;
  /** Qualification seam: after full record commit, before index/checkpoint acknowledgement. */
  beforeAcknowledgement?: (record: ProductionArtifactRecord) => Promise<void>;
  /** Qualification seam: after record, index and checkpoint save. */
  afterCommit?: (record: ProductionArtifactRecord) => Promise<void>;
}
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';
export async function loadProductionRecords(
  directory: string,
): Promise<ProductionArtifactRecord[]> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(directory, 'records.json'), 'utf8'));
  } catch (error) {
    if (absent(error)) return [];
    throw error;
  }
  const envelope = value as {
    schemaVersion: number;
    records: ProductionArtifactRecord[];
  };
  if (
    !envelope ||
    envelope.schemaVersion !== 1 ||
    !Array.isArray(envelope.records) ||
    Object.keys(envelope).some((k) => !['schemaVersion', 'records'].includes(k))
  )
    throw new Error('Invalid production record envelope');
  // The shared status validator verifies full recipe identity, digests and duplicates.
  inspectProductionStatus({ artifacts: [] }, envelope.records, new Map());
  return envelope.records;
}
async function acquireBuildLock(path: string) {
  const create = async () => {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.sync();
      return handle;
    } catch (error) {
      await handle.close();
      await unlink(path);
      throw error;
    }
  };
  try {
    return await create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  // Serialize abandoned-lock recovery. A live PID, unknown PID or malformed lock fails closed.
  const recovery = await open(path + '.recovery', 'wx');
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { pid: number };
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0)
      throw new Error('Malformed production lock');
    try {
      process.kill(value.pid, 0);
      throw new Error('Production build is already active');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await unlink(path);
    return await create();
  } finally {
    await recovery.close();
    await unlink(path + '.recovery');
  }
}
/** Local single-writer executor. Dead owner recovery never steals a live process lock. */
export async function buildProduction(
  options: ProductionBuildOptions,
): Promise<ProductionBuildResult> {
  const start = performance.now();
  if (options.mediaExecution && !options.rasterMeasurement)
    throw Error('Actual media execution requires raster validation');
  const graph = structuredClone(options.graph);
  if (!options.productionId.trim()) throw new Error('Production id required');
  for (const artifact of graph.artifacts)
    artifact.dependencies = [...artifact.dependencies].sort();
  const ordered = orderProductionGraph(graph),
    digests = productionRecipeDigests(graph);
  await mkdir(options.stateDirectory, { recursive: true });
  const lockPath = join(options.stateDirectory, 'build.lock');
  const lock = await acquireBuildLock(lockPath);
  try {
    const store = new ArtifactStore(join(options.stateDirectory, 'cache'));
    const records = await loadProductionRecords(options.stateDirectory);
    // Durable records keyed by the existing recipe digest retain commitments across recipe changes.
    for (const artifact of ordered) {
      try {
        const record = JSON.parse(
          await readFile(
            join(
              options.stateDirectory,
              'committed',
              digests.get(artifact.id)!,
              'artifacts',
              encodeURIComponent(artifact.id) + '.json',
            ),
            'utf8',
          ),
        ) as ProductionArtifactRecord;
        inspectProductionStatus({ artifacts: [] }, [record], new Map());
        if (
          record.id !== artifact.id ||
          record.recipeDigest !== digests.get(artifact.id)
        )
          throw new Error('Invalid committed product record');
        const index = records.findIndex((r) => r.id === artifact.id);
        if (index >= 0) {
          const indexed = records[index]!;
          if (
            indexed.recipeDigest === record.recipeDigest &&
            indexed.outputDigest !== record.outputDigest
          )
            throw new Error('Conflicting product record commitments');
          records[index] = record;
        } else records.push(record);
      } catch (error) {
        if (!absent(error)) throw error;
      }
    }
    const identities = new Map<string, string>();
    for (const record of records) {
      if (
        identities.has(record.recipeDigest) &&
        identities.get(record.recipeDigest) !== record.outputDigest
      )
        throw new Error('Conflicting product record commitments');
      identities.set(record.recipeDigest, record.outputDigest);
    }
    const outputs = new Map<string, Uint8Array>();
    for (const record of records) {
      const bytes = await store.get(record.outputDigest);
      if (bytes) outputs.set(record.id, bytes);
      else {
        // Preserve observed corrupt bytes for the shared cache-corrupt diagnostic only.
        try {
          outputs.set(
            record.id,
            await readFile(store.path(record.outputDigest)),
          );
        } catch (error) {
          if (!absent(error)) throw error;
        }
      }
    }
    const statuses = inspectProductionStatus(graph, records, outputs);
    const previous = new Map(records.map((r) => [r.id, r]));
    const inputDigest = canonicalDigest('production/checkpoint-input-v1', {
      productionId: options.productionId,
      recipes: Object.fromEntries(digests),
    });
    const expected = Object.fromEntries(
      records
        .filter((r) => digests.get(r.id) === r.recipeDigest)
        .map((r) => [
          r.id,
          {
            digest: r.outputDigest,
            dependencyDigests: r.dependencyRecipeDigests,
          },
        ]),
    );
    // Never trust a checkpoint without full current records AND freshly verified CAS.
    await resumeCheckpoint(
      join(options.stateDirectory, 'checkpoint.json'),
      inputDigest,
      expected,
      store,
    );
    const committed = new Map<
      string,
      { record: ProductionArtifactRecord; bytes: Uint8Array }
    >();
    const result: ProductionBuildResult = {
      schemaVersion: 1,
      production: { id: options.productionId },
      outcome: 'complete',
      diagnostics: [],
      ...(options.mediaExecution ? { mediaExecution: true as const } : {}),
      artifacts: [],
      artifactsTotal: ordered.length,
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
    };
    for (const review of options.reviews ?? []) {
      const candidate = ordered.find(
        (a) => a.id === review.artifactId,
      )?.reviewCandidate;
      if (
        candidate &&
        reviewRetention(review.candidate, candidate) === 'retained'
      )
        result.reviewsRetained++;
      else result.reviewsInvalidated++;
    }
    for (const artifact of ordered) {
      options.signal?.throwIfAborted();
      const old = previous.get(artifact.id),
        status = statuses.find((s) => s.id === artifact.id)!;
      const dependencies = new Map(
        artifact.dependencies.map((id) => [id, committed.get(id)!]),
      );
      const measure = async (bytes: Uint8Array) =>
        artifact.kind === 'render-range-raster' && options.rasterMeasurement
          ? {
              raster: await options.rasterMeasurement(
                {
                  artifact: structuredClone(artifact),
                  dependencies: structuredClone(dependencies),
                  signal: options.signal,
                },
                bytes,
              ),
            }
          : {};
      if (status.status === 'fresh') {
        const bytes = outputs.get(artifact.id)!;
        committed.set(artifact.id, { record: old!, bytes });
        result.artifactsReused++;
        result.bytesReused += bytes.byteLength;
        result.artifacts.push({
          id: artifact.id,
          action: 'reused',
          outputDigest: old!.outputDigest,
          causes: [],
          kind: artifact.kind,
          ...(await measure(bytes)),
        });
        options.onProgress?.(artifact.id, 'reused');
        continue;
      }
      const producer = options.producers.get(artifact.kind);
      if (!producer) {
        result.outcome = 'blocked';
        result.diagnostics.push({
          code: 'unsupported-producer',
          artifactId: artifact.id,
        });
        break;
      }
      const bytes = Buffer.from(
        await producer({
          artifact: structuredClone(artifact),
          dependencies: structuredClone(dependencies),
          previousRecord: old && structuredClone(old),
          signal: options.signal,
        }),
      );
      options.signal?.throwIfAborted();
      const measurement = await measure(bytes);
      const outputDigest = outputIdentity(bytes);
      let identityCommitment = old;
      const identityPath = join(
        options.stateDirectory,
        'committed',
        digests.get(artifact.id)!,
        'record.json',
      );
      try {
        identityCommitment = JSON.parse(
          await readFile(identityPath, 'utf8'),
        ) as ProductionArtifactRecord;
        inspectProductionStatus(
          { artifacts: [] },
          [identityCommitment],
          new Map(),
        );
        if (identityCommitment.recipeDigest !== digests.get(artifact.id))
          throw new Error('Invalid recipe commitment');
      } catch (error) {
        if (!absent(error)) throw error;
      }
      // Recipe commitment also covers semantically identical recipes with distinct artifact IDs.
      if (
        identityCommitment &&
        identityCommitment.recipeDigest === digests.get(artifact.id) &&
        identityCommitment.outputDigest !== outputDigest
      ) {
        const diagnosticDigest = await store.put(bytes);
        await writeAtomic(
          join(options.stateDirectory, 'conflict.json'),
          Buffer.from(
            canonicalJson({
              artifactId: artifact.id,
              recipeDigest: identityCommitment.recipeDigest,
              previousOutputDigest: identityCommitment.outputDigest,
              conflictingOutputDigest: diagnosticDigest,
            }),
          ),
        );
        result.outcome = 'blocked';
        result.diagnostics.push({
          code: 'conflicting-output',
          artifactId: artifact.id,
        });
        break;
      }
      await store.put(bytes);
      if (!(await store.get(outputDigest)))
        throw new Error('CAS verification failed');
      const record: ProductionArtifactRecord = {
        id: artifact.id,
        kind: artifact.kind,
        recipe: artifact.recipe,
        recipeDigest: digests.get(artifact.id)!,
        dependencyRecipeDigests: Object.fromEntries(
          artifact.dependencies.map((id) => [id, digests.get(id)!]),
        ),
        outputDigest,
        ...(artifact.reviewCandidate
          ? { reviewCandidate: artifact.reviewCandidate }
          : {}),
      };
      if (
        !identityCommitment ||
        identityCommitment.recipeDigest !== record.recipeDigest
      )
        await writeAtomic(identityPath, Buffer.from(canonicalJson(record)));
      await writeAtomic(
        join(
          options.stateDirectory,
          'committed',
          record.recipeDigest,
          'artifacts',
          encodeURIComponent(record.id) + '.json',
        ),
        Buffer.from(canonicalJson(record)),
      );
      await options.beforeAcknowledgement?.(structuredClone(record));
      previous.set(artifact.id, record);
      await writeAtomic(
        join(options.stateDirectory, 'records.json'),
        Buffer.from(
          canonicalJson({
            schemaVersion: 1,
            records: [...previous.values()].sort((a, b) =>
              a.id.localeCompare(b.id),
            ),
          }),
        ),
      );
      committed.set(artifact.id, { record, bytes });
      await saveCheckpoint(join(options.stateDirectory, 'checkpoint.json'), {
        version: 1,
        inputDigest,
        completed: [...committed.values()].map(({ record: r }) => ({
          id: r.id,
          digest: r.outputDigest,
          dependencyDigests: r.dependencyRecipeDigests,
        })),
      });
      result.artifactsRebuilt++;
      result.bytesWritten += bytes.byteLength;
      result.artifacts.push({
        id: artifact.id,
        action: 'rebuilt',
        outputDigest,
        causes: status.reasons,
        kind: artifact.kind,
        ...measurement,
      });
      options.onProgress?.(artifact.id, 'rebuilt');
      await options.afterCommit?.(structuredClone(record));
    }
    Object.assign(result, rasterMetrics(result.artifacts));
    result.cacheHitRatio =
      result.artifactsReused /
        (result.artifactsReused + result.artifactsRebuilt) || 0;
    result.elapsedMs = performance.now() - start;
    return productionBuildResultSchema.parse(result) as ProductionBuildResult;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
