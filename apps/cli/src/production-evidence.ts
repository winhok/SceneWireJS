import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  relativePathSchema,
  type ArtifactDigest,
  type CandidateBinding,
} from '@scenewirejs/production-core';
import { isVisualTrack, type VideoProject } from '@scenewirejs/schema';
import {
  canonicalLocalReference,
  canonicalCompositionBytes,
} from './production-path';
import { readFile } from 'node:fs/promises';
export async function retainedEvidencePath(root: string, path: string) {
  relativePathSchema.parse(path);
  root = await realpath(root);
  const target = await realpath(resolve(root, path));
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('Evidence path escapes production root');
  return target;
}
export async function hashRetainedArtifact(
  root: string,
  path: string,
): Promise<ArtifactDigest> {
  const target = await retainedEvidencePath(root, path);
  if (!(await lstat(target)).isFile())
    throw new Error('Evidence must be a regular file');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(target)) hash.update(bytes);
  return { path, sha256: hash.digest('hex') };
}
/** Candidate assets are enumerated from the project, never from a review record. */
export async function productionCandidate(
  root: string,
  projectPath: string,
  project: VideoProject,
  sceneId: string,
  builds: readonly {
    compositionId: string;
    sourceHash: string;
    bundleHash: string;
  }[] = [],
): Promise<CandidateBinding> {
  const assets: ArtifactDigest[] = [];
  for (const path of [
    ...new Set(
      project.assets
        .filter((a) => a.type !== 'composition')
        .map((a) => canonicalLocalReference(a.src)),
    ),
  ].sort())
    assets.push(await hashRetainedArtifact(root, path));
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('Unknown review scene');
  const compositionIds = new Set(
    project.tracks
      .filter(isVisualTrack)
      .filter((t) => !t.muted)
      .flatMap((t) => t.clips)
      .filter(
        (c) =>
          c.component === 'ForeignComposition' &&
          c.startFrame < scene.startFrame + scene.durationFrames &&
          c.startFrame + c.durationFrames > scene.startFrame,
      )
      .map((c) =>
        c.component === 'ForeignComposition' ? c.props.assetId : '',
      ),
  );
  const manifests = new Set(
    project.assets
      .filter((a) => a.type === 'composition')
      .map((a) => canonicalLocalReference(a.src)),
  );
  const sources = new Map<string, string>();
  let fileCount = 0;
  async function scan(path: string, depth: number) {
    if (depth > 32) throw new Error('Composition source tree too deep');
    const target = await retainedEvidencePath(root, path);
    for (const entry of (await readdir(target, { withFileTypes: true })).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink())
        throw new Error('Composition source tree contains a symlink');
      if (entry.isDirectory()) await scan(child, depth + 1);
      else if (entry.isFile()) {
        if (++fileCount > 10000)
          throw new Error('Composition source tree too large');
        const artifact = await hashRetainedArtifact(root, child);
        sources.set(
          child,
          manifests.has(child)
            ? createHash('sha256')
                .update(
                  canonicalCompositionBytes(
                    await readFile(await retainedEvidencePath(root, child)),
                  ),
                )
                .digest('hex')
            : artifact.sha256,
        );
      } else throw new Error('Composition source tree contains a special file');
    }
  }
  for (const asset of project.assets)
    if (asset.type === 'composition' && compositionIds.has(asset.id))
      await scan(dirname(canonicalLocalReference(asset.src)), 0);
  const orderedSources = [...sources].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return {
    projectSha256: (await hashRetainedArtifact(root, projectPath)).sha256,
    ...(sources.size
      ? {
          sourceSha256: createHash('sha256')
            .update('scenewire-review-source-v1\0')
            .update(
              JSON.stringify({
                sources: orderedSources,
                builds: builds
                  .filter((b) => compositionIds.has(b.compositionId))
                  .map(({ compositionId, sourceHash }) => ({
                    compositionId,
                    sourceHash,
                  }))
                  .sort((a, b) =>
                    a.compositionId < b.compositionId
                      ? -1
                      : a.compositionId > b.compositionId
                        ? 1
                        : 0,
                  ),
              }),
            )
            .digest('hex'),
        }
      : {}),
    assets,
  };
}
