import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  symlink,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { type VideoProject } from '@scenewirejs/schema';
import { validateRenderRange } from '@scenewirejs/renderer-core';
import { WebRendererSession } from '@scenewirejs/renderer-web';
import {
  renderSilentRange,
  concatSilentChunks,
} from '../../../packages/renderer-web/src/export/chunk';
import { mixProjectAudio } from '../../../packages/renderer-web/src/export/audio';
import { runEncoder } from '../../../packages/renderer-web/src/export/encoder';
import { validateSilentPicture } from '../../../packages/renderer-web/src/export/validation';
import { canonicalJson } from '../../../packages/production-core/src/incremental/digest';
import type {
  ArtifactExecutionContext,
  ArtifactProducer,
} from '../../../packages/production-core/src/production/executor';
import type { RasterWork } from '../../../packages/production-core/src/production/media-metrics';
import type { ProductionGraph } from '../../../packages/production-core/src/production/contracts';
import { relativePathSchema } from '@scenewirejs/production-core';

const duration = (project: VideoProject) =>
  Math.max(...project.scenes.map((s) => s.startFrame + s.durationFrames));
async function temporary<T>(run: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(
    join(tmpdir(), 'scenewire-production-media-'),
  );
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function rangeFor(context: ArtifactExecutionContext): RasterWork {
  const range = inputs(context.artifact.recipe.inputs)
    .range as unknown as RasterWork;
  if (!range) throw Error('Raster range ownership missing');
  return validateRenderRange(range, range.endFrame);
}
function inputs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Media recipe object required');
  return value as Record<string, unknown>;
}

export interface MediaProducerOptions {
  project: VideoProject;
  projectRoot: string;
  graph: ProductionGraph;
  /** Captured input bytes; only declared authored files/resources, never build cache. */
  sourceFiles: ReadonlyMap<string, Uint8Array>;
  /** Re-observe the authored closure. The host must read actual source and asset bytes. */
  verifyInputs(
    root: string,
  ): Promise<{ project: VideoProject; graph: ProductionGraph }>;
  onInvocation?(event: {
    artifactId: string;
    kind: string;
    range?: RasterWork;
  }): void;
  onFrame?(artifactId: string, frame: number): void;
}
/** Actual bounded producers above the existing renderer and encoder; no full-film cut path. */
export function createMediaProducers(
  options: MediaProducerOptions,
): Map<string, ArtifactProducer> {
  const project = structuredClone(options.project);
  let projectRoot = options.projectRoot;
  const sourceFiles = new Map(
    [...options.sourceFiles].map(([path, bytes]) => [
      relativePathSchema.parse(path),
      Buffer.from(bytes),
    ]),
  );
  const expectedGraph = canonicalJson(options.graph),
    expectedProject = canonicalJson(project);
  const verify = async (root: string) => {
    const current = await options.verifyInputs(root);
    if (
      canonicalJson(current.graph) !== expectedGraph ||
      canonicalJson(current.project) !== expectedProject
    )
      throw Error(
        'Authored media inputs changed or do not match the production graph',
      );
  };
  const semantic: ArtifactProducer = async ({ artifact }) =>
    Buffer.from(
      canonicalJson({
        kind: artifact.kind,
        inputs: artifact.recipe.inputs,
        ...(artifact.reviewCandidate
          ? { candidate: artifact.reviewCandidate }
          : {}),
      }),
    );
  const producers = new Map<string, ArtifactProducer>(
    [
      'source-provenance',
      'source-claim',
      'asset',
      'visual-system',
      'composition-source',
      'scene-authored',
      'scene-candidate',
      'semantic-cue',
      'render-range-logical',
      'scene-review-binding',
    ].map((kind) => [kind, semantic]),
  );
  producers.set('render-range-raster', async (context) =>
    temporary(async (directory) => {
      const range = validateRenderRange(rangeFor(context), duration(project));
      const logical = [...context.dependencies.values()].find(
        (d) => d.record.kind === 'render-range-logical',
      );
      if (!logical) throw Error('Verified logical range required');
      const spec = inputs(logical.record.recipe.inputs).spec as {
        range: RasterWork;
        rendererProfile: string;
        captureBackend: string;
        fps: number;
        width: number;
        height: number;
      };
      if (
        canonicalJson(spec.range) !== canonicalJson(range) ||
        spec.fps !== project.fps ||
        spec.width !== project.canvas.width ||
        spec.height !== project.canvas.height ||
        !['preview', 'deterministic-export'].includes(spec.rendererProfile) ||
        !['playwright-element', 'cdp-page'].includes(spec.captureBackend)
      )
        throw Error('Unsupported or mismatched raster profile');
      const signal = context.signal ?? new AbortController().signal;
      const session = new WebRendererSession({
        project,
        projectRoot,
        signal,
        profile: spec.rendererProfile as 'preview' | 'deterministic-export',
        captureBackend: spec.captureBackend as
          'playwright-element' | 'cdp-page',
        mediaDecodeMode: 'sequential-export',
      });
      const output = join(directory, 'range.mp4');
      let frames = 0;
      options.onInvocation?.({
        artifactId: context.artifact.id,
        kind: context.artifact.kind,
        range,
      });
      try {
        await session.prepare();
        await session.beginMediaRange(range);
        await renderSilentRange(
          session,
          { ...range, id: context.artifact.id },
          output,
          signal,
          async (frame) => {
            frames++;
            options.onFrame?.(context.artifact.id, frame);
          },
        );
        if (frames !== range.endFrame - range.startFrame)
          throw Error('Incomplete raster execution');
        await validateSilentPicture(output, project, frames, signal);
        return await readFile(output);
      } finally {
        await session.dispose();
      }
    }),
  );
  producers.set('audio-mix', async (context) =>
    temporary(async (directory) => {
      options.onInvocation?.({
        artifactId: context.artifact.id,
        kind: context.artifact.kind,
      });
      const output = join(directory, 'audio.wav');
      await mixProjectAudio(
        project,
        projectRoot,
        { startFrame: 0, endFrame: duration(project) },
        output,
        context.signal ?? new AbortController().signal,
      );
      return await readFile(output);
    }),
  );
  producers.set('final-media', async (context) =>
    temporary(async (directory) => {
      const signal = context.signal ?? new AbortController().signal;
      const ranges = [...context.dependencies.values()]
        .filter((d) => d.record.kind === 'render-range-raster')
        .map((d) => ({
          ...d,
          range: rangeFor({
            ...context,
            artifact: { ...context.artifact, recipe: d.record.recipe },
          }),
        }))
        .sort((a, b) => a.range.startFrame - b.range.startFrame);
      let end = 0;
      const files: string[] = [];
      for (const [index, raster] of ranges.entries()) {
        if (raster.range.startFrame !== end)
          throw Error(
            'Raster ownership must partition timeline without gaps or overlap',
          );
        end = raster.range.endFrame;
        const file = join(directory, `chunk-${index}.mp4`);
        await writeFile(file, raster.bytes);
        await validateSilentPicture(
          file,
          project,
          raster.range.endFrame - raster.range.startFrame,
          signal,
        );
        files.push(file);
      }
      if (end !== duration(project))
        throw Error('Incomplete final raster coverage');
      const audio = [...context.dependencies.values()].filter(
        (d) => d.record.kind === 'audio-mix',
      );
      if (audio.length !== 1)
        throw Error('Exactly one verified audio mix required');
      options.onInvocation?.({
        artifactId: context.artifact.id,
        kind: context.artifact.kind,
      });
      const { video } = await concatSilentChunks(files, directory, signal);
      const wav = join(directory, 'audio.wav'),
        output = join(directory, 'final.mp4');
      await writeFile(wav, audio[0]!.bytes);
      await runEncoder(
        [
          '-i',
          video,
          '-i',
          wav,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-ar',
          '48000',
          '-t',
          String(end / project.fps),
          '-map_metadata',
          '-1',
          '-fflags',
          '+bitexact',
          '-flags:a',
          '+bitexact',
          '-movflags',
          '+faststart',
          '-y',
          output,
        ],
        signal,
      );
      await validateSilentPicture(output, project, end, signal);
      return await readFile(output);
    }),
  );
  for (const kind of ['render-range-raster', 'audio-mix', 'final-media']) {
    const producer = producers.get(kind)!;
    producers.set(kind, async (context) => {
      const expected = options.graph.artifacts.find(
        (a) => a.id === context.artifact.id,
      );
      if (
        !expected ||
        canonicalJson(expected) !== canonicalJson(context.artifact)
      )
        throw Error('Media artifact does not match bound production graph');
      await verify(options.projectRoot);
      return temporary(async (snapshotRoot) => {
        for (const [path, bytes] of sourceFiles) {
          const output = join(snapshotRoot, path);
          await mkdir(dirname(output), { recursive: true });
          await writeFile(output, bytes, { flag: 'wx' });
        }
        // Installed dependency closure remains independently fingerprinted. Authored bytes are copied.
        const modules = join(options.projectRoot, 'node_modules');
        if (
          await access(modules).then(
            () => true,
            () => false,
          )
        )
          await symlink(modules, join(snapshotRoot, 'node_modules'), 'dir');
        await verify(snapshotRoot);
        projectRoot = snapshotRoot;
        try {
          const bytes = await producer(context);
          await verify(snapshotRoot);
          await verify(options.projectRoot);
          return bytes;
        } finally {
          projectRoot = options.projectRoot;
        }
      });
    });
  }
  return producers;
}
/** Count verified completed raster workload, including reused bytes, independently of prediction. */
export async function measureMediaRaster(
  context: ArtifactExecutionContext,
  bytes: Uint8Array,
): Promise<RasterWork> {
  const range = rangeFor(context);
  const dependency = [...context.dependencies.values()].find(
    (d) => d.record.kind === 'render-range-logical',
  );
  if (!dependency) throw Error('Logical range required for measurement');
  const spec = inputs(dependency.record.recipe.inputs).spec as {
    fps: number;
    width: number;
    height: number;
    range: RasterWork;
  };
  if (canonicalJson(spec.range) !== canonicalJson(range))
    throw Error('Range measurement mismatch');
  await temporary(async (directory) => {
    const file = join(directory, 'range.mp4');
    await writeFile(file, bytes);
    await validateSilentPicture(
      file,
      {
        fps: spec.fps,
        canvas: { width: spec.width, height: spec.height },
      } as VideoProject,
      range.endFrame - range.startFrame,
      context.signal ?? new AbortController().signal,
    );
  });
  return range;
}
