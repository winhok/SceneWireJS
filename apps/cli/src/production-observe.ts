import { readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  productionManifestSchema,
  sourcePackSchema,
  assetLedgerSchema,
  relativePathSchema,
  sceneReviewV2Schema,
  validateSceneReviewV2,
  type SceneReviewV2,
} from '@scenewirejs/production-core';
import {
  projectSchema,
  isVisualTrack,
  compositionManifestSchema,
  resolveCompositionParameters,
} from '@scenewirejs/schema';
import { createPrimitiveRegistry } from '@scenewirejs/runtime';
import { createDeveloperRegistry } from '@scenewirejs/domain-developer';
import { createEducationRegistry } from '@scenewirejs/domain-education';
import { createEditorialRegistry } from '@scenewirejs/domain-editorial';
import { installedEngineRegistry } from './director';
import {
  retainedEvidencePath,
  hashRetainedArtifact,
} from './production-evidence';
import {
  buildProductionGraph,
  type ProductionGraphContext,
} from '../../../packages/production-core/src/production/builder';
import {
  productionStatusResult,
  explainProductionArtifact,
} from '../../../packages/production-core/src/production/explain';
import {
  recipeIdentity,
  outputIdentity,
} from '../../../packages/production-core/src/production/identity';
import { canonicalDigest } from '../../../packages/production-core/src/incremental/digest';
import { type ProductionArtifactRecord } from '../../../packages/production-core/src/production/contracts';
import {
  type ProductionStatusResult,
  type ProductionExplainResult,
} from '../../../packages/production-core/src/production/result-contracts';
import {
  consumerDependencyIdentity,
  dependencyIdentity,
} from '../../../packages/renderer-web/src/bundle/dependencies';
import { actualProducerFingerprints } from './production-fingerprints';

import {
  canonicalLocalReference,
  canonicalCompositionBytes,
} from './production-path';

const json = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8'));
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';
/** Durable review availability is freshly checked independently of candidate retention. */
export async function validateDurableReview(
  root: string,
  project: ReturnType<typeof projectSchema.parse>,
  review: SceneReviewV2,
) {
  const bytes = await readFile(
    await retainedEvidencePath(root, `evidence/reviews/${review.sceneId}.json`),
  );
  const current = sceneReviewV2Schema.parse(JSON.parse(bytes.toString('utf8')));
  if (
    canonicalDigest('production/review-read-v1', current) !==
    canonicalDigest('production/review-read-v1', review)
  )
    throw Error('Durable review changed during observation');
  const evidence = await Promise.all(
    review.evidence.map(async (e) => {
      try {
        return await hashRetainedArtifact(root, e.path);
      } catch (error) {
        if (!missing(error)) throw error;
        return { path: e.path, sha256: '' };
      }
    }),
  );
  return {
    bytes,
    report: validateSceneReviewV2(review, {
      candidate: review.candidate,
      evidence,
      sceneDurationFrames: project.scenes.find((s) => s.id === review.sceneId)!
        .durationFrames,
    }),
  };
}
async function optionalJson(root: string, path: string) {
  try {
    return await json(await retainedEvidencePath(root, path));
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}
/** Internal observation transport, not an executor/store. Output locations are relative to production root. */
export interface ProductionObservationFile {
  schemaVersion: 1;
  artifacts: { record: ProductionArtifactRecord; output: string }[];
}
export async function readAuthoredProduction(
  manifestFile: string,
  profileFile: string,
  capturedProfile?: Uint8Array,
) {
  const manifest = productionManifestSchema.parse(await json(manifestFile));
  if (dirname(manifest.project) !== '.')
    throw new Error('Project must be at production root');
  const root = dirname(resolve(manifestFile));
  const sourceFiles = new Map<string, Uint8Array>();
  const sourceFile = async (path: string) => {
    let bytes = sourceFiles.get(path);
    if (!bytes) {
      bytes = await readFile(await retainedEvidencePath(root, path));
      sourceFiles.set(path, bytes);
    }
    return bytes;
  };
  const load = async (path: string) =>
    JSON.parse(Buffer.from(await sourceFile(path)).toString('utf8')) as unknown;
  sourceFiles.set(
    relative(root, resolve(manifestFile)),
    await readFile(resolve(manifestFile)),
  );
  try {
    await sourceFile('package.json');
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const [brief, sourcesInput, narrative, visual, projectInput] =
    await Promise.all(
      [
        manifest.brief,
        manifest.sources,
        manifest.narrativePlan,
        manifest.visualPlan,
        manifest.project,
      ].map(load),
    );
  const project = projectSchema.parse(projectInput),
    sources = sourcePackSchema.parse(sourcesInput);
  for (const asset of project.assets)
    asset.src = canonicalLocalReference(asset.src);
  for (const source of sources.sources) {
    if (
      !source.snapshotPath ||
      outputIdentity(await sourceFile(source.snapshotPath)) !== source.sha256
    )
      throw new Error(`Source snapshot missing or mismatched: ${source.id}`);
  }
  const assets = manifest.assets
    ? assetLedgerSchema.parse(await load(manifest.assets))
    : undefined;
  const assetDigests: Record<string, string> = {};
  for (const asset of project.assets.filter((a) => a.type !== 'composition'))
    assetDigests[asset.id] = outputIdentity(await sourceFile(asset.src));
  for (const asset of assets?.assets ?? []) {
    const digest = outputIdentity(await sourceFile(asset.path));
    if (
      digest !== asset.sha256 ||
      (assetDigests[asset.id] && assetDigests[asset.id] !== digest)
    )
      throw new Error(`Asset digest mismatch: ${asset.id}`);
    assetDigests[asset.id] = digest;
  }
  const profileBytes = capturedProfile
    ? Buffer.from(capturedProfile)
    : await readFile(resolve(profileFile));
  const profile = JSON.parse(profileBytes.toString('utf8')) as Omit<
    ProductionGraphContext,
    'registry' | 'componentRegistry'
  > & { visualSystem?: unknown };
  const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  // Reuse the renderer's read-only dependency-byte identity, never Vite bundle/process identity.
  const runtime = await dependencyIdentity(cliRoot, [
    '@scenewirejs/compiler',
    '@scenewirejs/runtime',
    '@scenewirejs/domain-developer',
    '@scenewirejs/domain-education',
    '@scenewirejs/domain-editorial',
  ]);
  const actualProducers = await actualProducerFingerprints(cliRoot);
  const environment = { ...profile.environment };
  const producer = {
    id: `${profile.producer.id}:${canonicalDigest('production/host-runtime-v1', runtime)}`,
    version: profile.producer.version,
  };
  const compositions: {
    assetId: string;
    sourceDigest: string;
    resourceIds: string[];
  }[] = [];
  for (const asset of project.assets)
    if (asset.type === 'composition') {
      const composition = compositionManifestSchema.parse(
        await load(asset.src),
      );
      composition.entry = canonicalLocalReference(composition.entry);
      if (composition.renderer !== asset.rendererId)
        throw new Error('Composition renderer mismatch');
      const directory = dirname(asset.src),
        entries: [string, string][] = [];
      let count = 0;
      async function scan(path: string, depth: number) {
        if (depth > 32) throw new Error('Composition source tree too deep');
        const target = await retainedEvidencePath(root, path);
        for (const entry of await readdir(target, { withFileTypes: true })) {
          if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
          if (entry.isSymbolicLink())
            throw new Error('Composition source symlink');
          const child = `${path}/${entry.name}`;
          if (entry.isDirectory()) await scan(child, depth + 1);
          else if (entry.isFile()) {
            if (++count > 10000)
              throw new Error('Composition source tree too large');
            // The manifest is semantic JSON, organizational entry filename is represented by module keys below.
            entries.push([
              relative(directory, child),
              outputIdentity(
                child === asset.src
                  ? canonicalCompositionBytes(await sourceFile(child))
                  : await sourceFile(child),
              ),
            ]);
          } else throw new Error('Composition special file');
        }
      }
      await scan(directory, 0);
      await retainedEvidencePath(
        root,
        canonicalLocalReference(`${directory}/${composition.entry}`),
      );
      for (const clip of project.tracks
        .filter(isVisualTrack)
        .flatMap((t) => t.clips))
        if (
          'component' in clip &&
          clip.component === 'ForeignComposition' &&
          clip.props.assetId === asset.id
        )
          resolveCompositionParameters(composition, clip.props.parameters);
      // The existing bundler confines local imports to this composition's source tree.
      // Bind ledger provenance for resources actually retained in that tree; source bytes
      // already bind undeclared local images/fonts. Project media clips are scoped by the builder.
      const retainedResources = new Set(
        entries.map(([path]) => `${directory}/${path}`),
      );
      const resourceIds = [
        ...new Set([
          ...project.assets
            .filter(
              (a) => a.type !== 'composition' && retainedResources.has(a.src),
            )
            .map((a) => a.id),
          ...(assets?.assets
            .filter((a) => retainedResources.has(a.path))
            .map((a) => a.id) ?? []),
        ]),
      ].sort();
      const dependencies = await consumerDependencyIdentity(root, []);
      compositions.push({
        assetId: asset.id,
        sourceDigest: canonicalDigest('production/composition-source-v1', {
          manifest: composition,
          sources: entries.sort(([a], [b]) => (a < b ? -1 : 1)),
          dependencies,
        }),
        resourceIds,
      });
    }
  const reviews = [];
  for (const scene of project.scenes) {
    const value = await optionalJson(root, `evidence/reviews/${scene.id}.json`);
    if (value !== undefined && (value as { version: number }).version === 2)
      reviews.push(sceneReviewV2Schema.parse(value));
  }
  const graph = buildProductionGraph(
    {
      brief,
      sources,
      narrative,
      visual,
      project,
      assets,
      visualSystem: profile.visualSystem,
      assetDigests,
      compositions,
      reviews,
    },
    {
      ...profile,
      producer,
      ...Object.fromEntries(
        (['rasterProducer', 'audioProducer', 'finalProducer'] as const).map(
          (key) => [
            key,
            {
              id: actualProducers[key].id,
              version: canonicalDigest(
                'production/actual-producer-profile-v1',
                {
                  actual: actualProducers[key],
                  declared: profile[key] ?? null,
                },
              ),
            },
          ],
        ),
      ),
      environment,
      registry: installedEngineRegistry(),
      componentRegistry: [
        ...createPrimitiveRegistry(),
        ...createDeveloperRegistry(),
        ...createEducationRegistry(),
        ...createEditorialRegistry(),
      ],
    },
  );
  const validatedReviews = [];
  for (const review of reviews) {
    const { report } = await validateDurableReview(root, project, review);
    if (report.valid) validatedReviews.push(review);
  }
  return {
    root,
    project,
    graph,
    reviews,
    validatedReviews,
    sourceFiles,
    profileBytes,
  };
}
export async function observeProduction(
  manifestFile: string,
  profileFile: string,
  recordsFile?: string,
): Promise<ProductionStatusResult> {
  const { root, project, graph, reviews } = await readAuthoredProduction(
    manifestFile,
    profileFile,
  );
  const records: ProductionArtifactRecord[] = [],
    outputs = new Map<string, Uint8Array>();
  const observation = recordsFile
    ? await json(resolve(recordsFile))
    : await optionalJson(root, '.scenewire/production/records.json');
  if (observation !== undefined) {
    const envelope = observation as ProductionObservationFile;
    if (
      envelope.schemaVersion !== 1 ||
      !Array.isArray(envelope.artifacts) ||
      Object.keys(envelope).some(
        (k) => !['schemaVersion', 'artifacts'].includes(k),
      )
    )
      throw new Error('Invalid production observation envelope');
    for (const entry of envelope.artifacts) {
      if (
        !entry.record ||
        Object.keys(entry).some((k) => !['record', 'output'].includes(k))
      )
        throw new Error('Invalid production observation');
      relativePathSchema.parse(entry.output);
      records.push(entry.record);
      try {
        const path = await retainedEvidencePath(root, entry.output);
        if (!(await lstat(path)).isFile())
          throw new Error('Output must be a regular file');
        outputs.set(entry.record.id, await readFile(path));
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  }
  for (const review of reviews) {
    const artifact = graph.artifacts.find(
      (a) => a.id === `scene:${review.sceneId}:review`,
    )!;
    // Durable review truth overrides disposable observation entries. No record is written.
    const bytes = await readFile(
      await retainedEvidencePath(
        root,
        `evidence/reviews/${review.sceneId}.json`,
      ),
    );
    const oldCandidate = review.candidate;
    const record = {
      id: artifact.id,
      kind: artifact.kind,
      recipe: artifact.recipe,
      dependencyRecipeDigests: {},
      reviewCandidate: oldCandidate,
      recipeDigest: recipeIdentity(
        artifact.kind,
        artifact.recipe,
        {},
        oldCandidate,
      ),
      outputDigest: outputIdentity(bytes),
    };
    const index = records.findIndex((r) => r.id === artifact.id);
    if (index >= 0) records.splice(index, 1);
    records.push(record);
    const evidence = await Promise.all(
      review.evidence.map(async (e) => {
        try {
          return await hashRetainedArtifact(root, e.path);
        } catch (error) {
          if (!missing(error)) throw error;
          return { path: e.path, sha256: '' };
        }
      }),
    );
    const report = validateSceneReviewV2(review, {
      candidate: oldCandidate,
      evidence,
      sceneDurationFrames: project.scenes.find((s) => s.id === review.sceneId)!
        .durationFrames,
    });
    if (report.valid) outputs.set(artifact.id, bytes);
    else outputs.delete(artifact.id);
  }
  return productionStatusResult(project.id, graph, records, outputs, reviews);
}

export function formatProductionStatus(result: ProductionStatusResult): string {
  return (
    `Production: ${result.production.id}\n` +
    result.artifacts
      .map(
        (a) =>
          `${a.status.toUpperCase()} ${a.id}${a.reviewRetention ? ` (review ${a.reviewRetention})` : ''}\n` +
          a.reasons
            .map(
              (r) =>
                `  ${r.code}${r.dependencyId ? `: ${r.dependencyId}` : ''}\n`,
            )
            .join(''),
      )
      .join('')
  );
}
export function formatProductionExplain(
  result: ProductionExplainResult,
): string {
  const causes = (values: ProductionExplainResult['directCauses']) =>
    values
      .map(
        (c) =>
          `  ${c.artifactId}: ${c.reason.code}${c.reason.dependencyId ? `: ${c.reason.dependencyId}` : ''}\n`,
      )
      .join('') || '  none\n';
  return `${result.artifact.id}\n${result.artifact.status.toUpperCase()}\nDirect causes:\n${causes(result.directCauses)}Transitive causes:\n${causes(result.transitiveCauses)}Unaffected (verified fresh):\n${result.unaffected.map((a) => `  ${a.id}\n`).join('') || '  none\n'}`;
}
export async function productionObserveCommand(
  command: string,
  file: string,
  args: string[],
) {
  let artifactId: string | undefined,
    profile: string | undefined,
    records: string | undefined,
    jsonMode = false;
  const remaining = [...args];
  if (command === 'production-explain') artifactId = remaining.shift();
  const seen = new Set<string>();
  while (remaining.length) {
    const flag = remaining.shift()!;
    if (seen.has(flag)) throw new Error(`Duplicate flag: ${flag}`);
    seen.add(flag);
    if (flag === '--json') jsonMode = true;
    else if (flag === '--profile' || flag === '--records') {
      const value = remaining.shift();
      if (!value || value.startsWith('--'))
        throw new Error(`Missing value: ${flag}`);
      if (flag === '--profile') profile = value;
      else records = value;
    } else throw new Error(`Unexpected argument: ${flag}`);
  }
  if (
    !profile ||
    (command === 'production-explain' &&
      (!artifactId || artifactId.startsWith('--')))
  )
    throw new Error(
      `Usage: scenewire ${command} <manifest>${command === 'production-explain' ? ' <artifact-id>' : ''} --profile <semantic-profile.json> [--records <observations.json>] [--json]`,
    );
  const status = await observeProduction(file, profile, records);
  const result =
    command === 'production-explain'
      ? explainProductionArtifact(status, artifactId!)
      : status;
  return jsonMode
    ? JSON.stringify(result) + '\n'
    : 'artifact' in result
      ? formatProductionExplain(result)
      : formatProductionStatus(result);
}
