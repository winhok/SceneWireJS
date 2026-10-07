import { readFile, realpath, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import {
  productionManifestSchema,
  relativePathSchema,
  validateProductionBrief,
  validateSourcePack,
  validateAssetLedger,
  sceneReviewSchema,
  sceneReviewV2Schema,
  validateSceneReviewV2,
  sameCandidate,
  type CandidateBinding,
  type AssetLedger,
  validateNarrativePlan,
  validateProductionPlans,
  compileProductionSkeleton,
  validateProductionAssembly,
  type ProductionDiagnostic,
} from '@scenewirejs/production-core';
import { parseVisualPlan } from '@scenewirejs/director-core';
import { compositionManifestSchema } from '@scenewirejs/schema';
import { installedEngineRegistry } from './director';
import { scaffold } from './scaffold';
import {
  productionCandidate,
  hashRetainedArtifact,
} from './production-evidence';
import { canonicalLocalReference } from './production-path';
const json = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8'));
function inside(root: string, path: string) {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('Production path escapes root');
  return path;
}
async function retainedPath(root: string, path: string) {
  relativePathSchema.parse(path);
  return inside(root, await realpath(resolve(root, path)));
}
export async function productionCommand(
  command: string,
  file: string,
  args: string[],
) {
  if (command === 'brief-check' || command === 'sources-check') {
    if (args.length) throw new Error('Unexpected arguments');
    return command === 'brief-check'
      ? validateProductionBrief(await json(file))
      : validateSourcePack(await json(file));
  }
  if (command === 'narrative-check') {
    if (args.length !== 4 || args[0] !== '--brief' || args[2] !== '--sources')
      throw new Error(
        'Usage: narrative-check <plan> --brief <brief> --sources <sources>',
      );
    return validateNarrativePlan(
      await json(file),
      await json(args[1]!),
      await json(args[3]!),
    );
  }
  if (
    command === 'production-init' &&
    (args.length !== 2 || args[0] !== '--output')
  )
    throw new Error(
      'Usage: production-init <manifest> --output <new-directory>',
    );
  if (command === 'production-check' && args.length)
    throw new Error('Usage: production-check <manifest>');
  const manifest = productionManifestSchema.parse(await json(file));
  const root = await realpath(dirname(resolve(file)));
  // The canonical project lives at production root; all its local asset references resolve there.
  if (dirname(manifest.project) !== '.')
    throw new Error('Project must be at production root');
  const [briefInput, sourcesInput, narrativeInput, visualInput] =
    await Promise.all(
      [
        manifest.brief,
        manifest.sources,
        manifest.narrativePlan,
        manifest.visualPlan,
      ].map(async (p) => json(await retainedPath(root, p))),
    );
  const registry = installedEngineRegistry();
  const plans = validateProductionPlans(
    briefInput,
    sourcesInput,
    narrativeInput,
    visualInput,
    registry,
  );
  if (!plans.valid) return plans;
  const brief = validateProductionBrief(briefInput).value!,
    sources = validateSourcePack(sourcesInput).value!,
    narrative = plans.value!,
    visual = parseVisualPlan(visualInput);
  const diagnostics: ProductionDiagnostic[] = [...plans.diagnostics];
  for (const source of sources.sources) {
    if (!source.snapshotPath) {
      diagnostics.push({
        severity: 'error',
        code: 'source.retention',
        message: `Retain snapshot for ${source.id}`,
      });
      continue;
    }
    try {
      const bytes = await readFile(
        await retainedPath(root, source.snapshotPath),
      );
      if (
        !source.sha256 ||
        createHash('sha256').update(bytes).digest('hex') !== source.sha256
      )
        diagnostics.push({
          severity: 'error',
          code: 'source.digest',
          message: `Snapshot digest missing or mismatched: ${source.id}`,
        });
    } catch {
      diagnostics.push({
        severity: 'error',
        code: 'source.snapshot',
        message: `Snapshot unavailable: ${source.id}`,
      });
    }
  }
  let assetLedger: AssetLedger | undefined;
  if (manifest.assets) {
    const ledgerReport = validateAssetLedger(
      await json(await retainedPath(root, manifest.assets)),
      sources,
    );
    diagnostics.push(...ledgerReport.diagnostics);
    assetLedger = ledgerReport.value;
    if (assetLedger)
      for (const asset of assetLedger.assets) {
        try {
          const bytes = await readFile(await retainedPath(root, asset.path));
          if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
            throw new Error('SHA-256 mismatch');
        } catch (e) {
          diagnostics.push({
            severity: 'error',
            code: 'asset.digest',
            message: `${asset.id}: ${String(e)}`,
          });
        }
      }
  }
  if (diagnostics.some((d) => d.severity === 'error'))
    return { valid: false, diagnostics };
  if (command === 'production-init') {
    const output = resolve(args[1]!);
    await mkdir(output); // exclusive, no overwrite or symlink destination
    const write = async (path: string, data: unknown) => {
      relativePathSchema.parse(path);
      const target = inside(output, resolve(output, path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(data, null, 2) + '\n', {
        flag: 'wx',
      });
    };
    const skeleton = compileProductionSkeleton(
      brief,
      narrative,
      visual,
      registry,
      { sources, createdAt: new Date().toISOString(), seed: 0 },
    );
    // Inputs are frozen before scene work; failures leave inspectable partial output, never remove user files.
    await write('production.json', manifest);
    for (const [path, data] of [
      [manifest.brief, brief],
      [manifest.sources, sources],
      [manifest.narrativePlan, narrative],
      [manifest.visualPlan, visual],
    ] as const)
      await write(path, data);
    for (const source of sources.sources) {
      const target = resolve(output, source.snapshotPath!);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(
        target,
        await readFile(await retainedPath(root, source.snapshotPath!)),
        { flag: 'wx' },
      );
    }
    if (manifest.assets && assetLedger) {
      await write(manifest.assets, assetLedger);
      for (const asset of assetLedger.assets) {
        const target = inside(output, resolve(output, asset.path));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(
          target,
          await readFile(await retainedPath(root, asset.path)),
          { flag: 'wx' },
        );
      }
    }
    await write(manifest.project, skeleton.project);
    await mkdir(resolve(output, 'compositions'), { recursive: true });
    for (const scene of skeleton.scaffoldRequests) {
      if (scene.directory) {
        await scaffold(scene.engineId, resolve(output, scene.directory));
        await write(`${scene.directory}/.scenewire-scaffold.json`, {
          sceneId: scene.sceneId,
          engineId: scene.engineId,
          status: 'scaffolded',
        });
      } else
        await write(`scenes/${scene.sceneId}/slot.json`, {
          sceneId: scene.sceneId,
          engineId: 'structured',
          status: 'planned',
        });
    }
    return {
      valid: true,
      diagnostics,
      output,
      scenes: skeleton.scaffoldRequests.map((s) => ({
        ...s,
        status: 'scaffolded',
      })),
    };
  }
  const projectPath = await retainedPath(root, manifest.project);
  const assembly = validateProductionAssembly(
    await json(projectPath),
    brief,
    narrative,
    visual,
  );
  diagnostics.push(...assembly.diagnostics);
  if (assetLedger && assembly.value)
    for (const asset of assembly.value.assets)
      if (asset.type === 'audio' || asset.type === 'image') {
        const record = assetLedger.assets.find(
          (a) =>
            a.id === asset.id &&
            a.path === canonicalLocalReference(asset.src) &&
            a.kind === asset.type,
        );
        if (!record)
          diagnostics.push({
            severity: 'error',
            code: 'asset.ledger',
            message: `Missing ledger entry for ${asset.id}`,
          });
      }
  if (assembly.value)
    for (const asset of assembly.value.assets) {
      if (asset.type === 'audio' || asset.type === 'image') {
        try {
          const path = await retainedPath(
            root,
            canonicalLocalReference(asset.src),
          );
          if (
            !(await lstat(path)).isFile() ||
            (await readFile(path)).byteLength === 0
          )
            throw new Error('Empty or non-file asset');
        } catch (e) {
          diagnostics.push({
            severity: 'error',
            code: 'asset.files',
            message: `${asset.id}: ${String(e)}`,
          });
        }
      }
    }
  const scenes: {
    sceneId: string;
    engineId: string;
    status:
      'planned' | 'scaffolded' | 'implemented' | 'renderable' | 'reviewed';
    candidate?: CandidateBinding;
  }[] = [];
  for (const scene of narrative.scenes) {
    const engine = visual.scenes.find((s) => s.id === scene.id)!.engineId;
    let status:
      'planned' | 'scaffolded' | 'implemented' | 'renderable' | 'reviewed' =
      'planned';
    if (engine !== 'structured')
      try {
        const path = `compositions/${scene.id}/composition.json`,
          m = compositionManifestSchema.parse(
            await json(await retainedPath(root, path)),
          );
        status = 'scaffolded';
        if (m.schemaVersion !== 2 || m.engine !== engine)
          throw new Error('Selected engine differs from composition manifest');
        const entry = await realpath(
          resolve(dirname(await retainedPath(root, path)), m.entry),
        );
        inside(root, entry);
        if (!(await lstat(entry)).isFile())
          throw new Error('Composition entry is not a file');
        // The marker is removed only after replacing the generated starter code.
        try {
          await lstat(
            resolve(root, `compositions/${scene.id}/.scenewire-scaffold.json`),
          );
          diagnostics.push({
            severity: 'error',
            code: 'scene.scaffold',
            message: 'Starter scaffold has not been replaced',
            sceneId: scene.id,
          });
        } catch {
          // No scaffold marker: implementation may be complete; render-check decides renderability.
        }
      } catch (e) {
        diagnostics.push({
          severity: 'error',
          code: 'scene.files',
          message: String(e),
          sceneId: scene.id,
        });
      }
    if (
      assembly.value &&
      !diagnostics.some(
        (d) => d.severity === 'error' && (!d.sceneId || d.sceneId === scene.id),
      )
    )
      status = 'implemented';
    scenes.push({ sceneId: scene.id, engineId: engine, status });
  }
  if (assembly.value && !diagnostics.some((d) => d.severity === 'error')) {
    const p = assembly.value,
      frames = p.scenes.flatMap((s) => [
        s.startFrame,
        s.startFrame + Math.floor(s.durationFrames / 2),
        s.startFrame + s.durationFrames - 1,
      ]);
    try {
      const { renderCheck } = await import('@scenewirejs/renderer-web');
      const v2Scenes = new Set<string>();
      for (const scene of scenes) {
        if (visual.version === 2) v2Scenes.add(scene.sceneId);
        else
          try {
            const input = await json(
              await retainedPath(
                root,
                `evidence/reviews/${scene.sceneId}.json`,
              ),
            );
            if (
              typeof input === 'object' &&
              input !== null &&
              'version' in input &&
              input.version === 2
            )
              v2Scenes.add(scene.sceneId);
          } catch {
            /* v1 review handling below preserves existing behavior. */
          }
      }
      const beforeCandidates = new Map(
        await Promise.all(
          scenes
            .filter((s) => v2Scenes.has(s.sceneId))
            .map(
              async (s) =>
                [
                  s.sceneId,
                  await productionCandidate(
                    root,
                    manifest.project,
                    p,
                    s.sceneId,
                  ),
                ] as const,
            ),
        ),
      );
      const renderReport = await renderCheck(
        { project: p, projectRoot: root },
        frames,
      );
      const buildIdentity = (
        builds: (typeof renderReport.performance)[number]['builds'],
      ) =>
        JSON.stringify(
          builds
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
        );
      if (
        v2Scenes.size > 0 &&
        buildIdentity(renderReport.performance[0]!.builds) !==
          buildIdentity(renderReport.performance[1]!.builds)
      )
        throw new Error('Renderer source identity changed between sessions');
      for (const scene of scenes) {
        if (!v2Scenes.has(scene.sceneId)) continue;
        scene.candidate = await productionCandidate(
          root,
          manifest.project,
          p,
          scene.sceneId,
        );
        if (
          !sameCandidate(beforeCandidates.get(scene.sceneId)!, scene.candidate)
        )
          throw new Error('Candidate changed during render-check');
        scene.candidate = await productionCandidate(
          root,
          manifest.project,
          p,
          scene.sceneId,
          renderReport.performance[0]!.builds,
        );
      }
      for (const scene of scenes) scene.status = 'renderable';
      const projectSha256 = createHash('sha256')
        .update(await readFile(projectPath))
        .digest('hex');
      for (const scene of scenes) {
        const reviewPath = `evidence/reviews/${scene.sceneId}.json`;
        let present = false;
        try {
          await lstat(resolve(root, reviewPath));
          present = true;
        } catch {
          /* no scene review yet */
        }
        if (!present) continue;
        try {
          const reviewInput = await json(await retainedPath(root, reviewPath));
          if (
            typeof reviewInput === 'object' &&
            reviewInput !== null &&
            'version' in reviewInput &&
            reviewInput.version === 2
          ) {
            const review = sceneReviewV2Schema.parse(reviewInput);
            const observed = await Promise.all(
              review.evidence.map((e) => hashRetainedArtifact(root, e.path)),
            );
            const report = validateSceneReviewV2(review, {
              candidate: scene.candidate!,
              evidence: observed,
              sceneDurationFrames: narrative.scenes.find(
                (s) => s.id === scene.sceneId,
              )!.durationFrames,
            });
            diagnostics.push(...report.diagnostics);
            if (
              review.sceneId !== scene.sceneId ||
              review.disposition !== 'pass'
            )
              throw new Error('Mismatched or non-passing scene review');
            if (report.valid) scene.status = 'reviewed';
            continue;
          }
          const review = sceneReviewSchema.parse(reviewInput);
          const capture = await readFile(
            await retainedPath(root, review.capturePath),
          );
          const sourcePath =
            scene.engineId === 'structured'
              ? undefined
              : `compositions/${scene.sceneId}/index.ts`;
          const sourceSha256 = sourcePath
            ? createHash('sha256')
                .update(await readFile(await retainedPath(root, sourcePath)))
                .digest('hex')
            : undefined;
          if (
            review.sceneId !== scene.sceneId ||
            review.projectSha256 !== projectSha256 ||
            review.captureSha256 !==
              createHash('sha256').update(capture).digest('hex') ||
            review.sourceSha256 !== sourceSha256 ||
            review.disposition !== 'pass'
          )
            throw new Error('Stale, mismatched or non-passing scene review');
          scene.status = 'reviewed';
        } catch (e) {
          diagnostics.push({
            severity: 'error',
            code: 'review.evidence',
            message: String(e),
            sceneId: scene.sceneId,
          });
        }
      }
    } catch (e) {
      diagnostics.push({
        severity: 'error',
        code: 'production.render',
        message: String(e),
      });
    }
  }
  return {
    valid: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
    scenes,
  };
}
