import {
  type EngineRegistry,
  parseVisualPlan,
} from '@scenewirejs/director-core';
import { compileChoreography } from '@scenewirejs/compiler';
import {
  resolveSemanticTargets,
  resolveProjectLayouts,
  type ComponentRegistry,
} from '@scenewirejs/runtime';
import {
  isVisualTrack,
  isAudioTrack,
  type VideoProject,
  type NarrationSegment,
} from '@scenewirejs/schema';
import { productionBriefSchema } from '../contracts/brief';
import { sourcePackSchema } from '../contracts/source';
import {
  sceneReviewV2Schema,
  type SceneReviewV2,
} from '../contracts/review-v2';
import { assetLedgerSchema } from '../contracts/asset-ledger';
import { validateProductionPlans } from '../validation/plans';
import { validateProductionAssembly } from '../validation/assembly';
import { validateAssetLedger } from '../validation/asset-ledger';
import {
  assertDigest,
  canonicalDigest,
  canonicalJson,
} from '../incremental/digest';
import { type RasterEnvironment } from '../incremental/render-range';
import {
  productionRangeIdentity,
  semanticCueIdentity,
  producerSchema,
  environmentSchema,
} from './identity';
import { orderProductionGraph } from './status';
import {
  visualSystemSchema,
  type ProductionGraph,
  type ProductionArtifact,
  type FiniteJson,
} from './contracts';

/** Observations are freshly hashed by the host, never taken from cached records.
 * Composition sourceDigest binds its complete source tree and immutable dependency/runtime inputs.
 * resourceIds declares all composition resource dependencies (including fonts).
 */
export interface AuthoredGraphInput {
  brief: unknown;
  sources: unknown;
  narrative: unknown;
  visual: unknown;
  project: unknown;
  assets?: unknown;
  visualSystem?: unknown;
  assetDigests: Readonly<Record<string, string>>;
  compositions: readonly {
    assetId: string;
    sourceDigest: string;
    resourceIds: readonly string[];
  }[];
  reviews?: readonly SceneReviewV2[];
}
export interface ProductionGraphContext {
  registry: EngineRegistry;
  componentRegistry: ComponentRegistry;
  producer: { id: string; version: string };
  /** Actual raster producer, independent of logical/compiler and CLI presentation. */
  rasterProducer?: { id: string; version: string };
  audioProducer?: { id: string; version: string };
  finalProducer?: { id: string; version: string };
  environment: RasterEnvironment;
  rendererProfile: string;
  captureBackend: string;
}
const operationalKeys = new Set([
  'attemptId',
  'workerId',
  'leaseId',
  'queueId',
  'heartbeatTimestamp',
  'heartbeatAt',
  'host',
  'hostname',
  'cwd',
  'temporaryPath',
  'tempDirectory',
  'wallClock',
]);
const json = (value: unknown): FiniteJson => {
  const parsed = JSON.parse(canonicalJson(value)) as FiniteJson;
  const inspect = (value: FiniteJson) => {
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (operationalKeys.has(key))
          throw new Error(
            `Operational metadata cannot enter a production recipe: ${key}`,
          );
        inspect(child);
      }
    }
  };
  inspect(parsed);
  return parsed;
};
const byId = <T extends { id: string }>(values: readonly T[]) =>
  [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${label}`);
}
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}
/** Validate current authored contracts before projecting. No authored document is rewritten. */
export function buildProductionGraph(
  input: AuthoredGraphInput,
  context: ProductionGraphContext,
): ProductionGraph {
  const producer = producerSchema.parse(context.producer);
  const rasterEnvironment = environmentSchema.parse(context.environment);
  const brief = productionBriefSchema.parse(input.brief),
    sources = sourcePackSchema.parse(input.sources);
  // Narrative order is explicitly authored; canonicalize enumeration by that semantic order.
  const narrativeInput = input.narrative as { scenes?: { order: number }[] };
  const plans = validateProductionPlans(
    brief,
    sources,
    {
      ...narrativeInput,
      scenes: [...(narrativeInput.scenes ?? [])].sort(
        (a, b) => a.order - b.order,
      ),
    },
    input.visual,
    context.registry,
  );
  if (!plans.valid || !plans.value)
    throw new Error(
      `Invalid production plans: ${JSON.stringify(plans.diagnostics)}`,
    );
  const narrative = plans.value,
    visual = parseVisualPlan(input.visual);
  const assembly = validateProductionAssembly(
    input.project,
    brief,
    narrative,
    visual,
  );
  if (!assembly.valid || !assembly.value)
    throw new Error(
      `Invalid production assembly: ${JSON.stringify(assembly.diagnostics)}`,
    );
  const project: VideoProject = assembly.value;
  const ledger =
    input.assets === undefined
      ? undefined
      : assetLedgerSchema.parse(input.assets);
  if (ledger && !validateAssetLedger(ledger, sources).valid)
    throw new Error('Invalid asset ledger');
  const system =
    input.visualSystem === undefined
      ? undefined
      : visualSystemSchema.parse(input.visualSystem);
  unique(
    input.compositions.map((c) => c.assetId),
    'composition',
  );
  unique(
    (input.reviews ?? []).map((r) => r.sceneId),
    'scene review',
  );
  for (const id of Object.keys(input.assetDigests)) {
    required(
      project.assets.find((a) => a.id === id) ??
        ledger?.assets.find((a) => a.id === id),
      `asset ${id}`,
    );
    assertDigest(input.assetDigests[id]!);
  }
  for (const asset of project.assets) {
    if (asset.type !== 'composition') {
      const digest = required(
        input.assetDigests[asset.id],
        `observed asset ${asset.id}`,
      );
      const entry = ledger?.assets.find((a) => a.id === asset.id);
      if (entry && (entry.path !== asset.src || entry.sha256 !== digest))
        throw new Error(`Asset ledger mismatch: ${asset.id}`);
    } else
      required(
        input.compositions.find((c) => c.assetId === asset.id),
        `composition ${asset.id}`,
      );
  }
  for (const composition of input.compositions) {
    assertDigest(composition.sourceDigest);
    if (
      required(
        project.assets.find((a) => a.id === composition.assetId),
        'composition asset',
      ).type !== 'composition'
    )
      throw new Error('Not a composition asset');
    unique(composition.resourceIds, 'composition resource');
    for (const id of composition.resourceIds)
      required(input.assetDigests[id], `composition resource ${id}`);
  }
  for (const source of sources.sources)
    required(source.sha256, `source digest ${source.id}`);
  for (const scene of narrative.scenes) unique(scene.claimIds, 'scene claim');
  for (const claim of sources.claims) unique(claim.sourceIds, 'claim source');
  for (const asset of ledger?.assets ?? [])
    unique(asset.derivedFromAssetIds ?? [], 'asset provenance');
  const segments = project.narration?.segments ?? [];
  unique(
    segments.map((s) => s.id),
    'narration segment',
  );
  for (const segment of segments)
    unique(
      (segment.cues ?? []).map((c) => c.id),
      'semantic cue',
    );
  // Use the actual compiler for validation and resolved visual facts; no competing cue resolver.
  const choreography = compileChoreography({
    project,
    componentRegistry: context.componentRegistry,
  });
  const artifacts: ProductionArtifact[] = [];
  const add = (
    id: string,
    kind: string,
    inputs: unknown,
    dependencies: string[] = [],
    environment?: RasterEnvironment,
  ) => {
    artifacts.push({
      id,
      kind,
      dependencies: dependencies.sort(),
      recipe: {
        inputs: json(inputs),
        producer: { ...producer },
        ...(environment ? { environment: { ...rasterEnvironment } } : {}),
      },
    });
  };
  const sceneId = (id: string) => `scene:${id}`;
  for (const source of byId(sources.sources)) {
    const semantic = Object.fromEntries(
      Object.entries(source).filter(
        ([key]) => key !== 'snapshotPath' && key !== 'locator',
      ),
    );
    const locator = source.locator;
    add(`source:${source.id}`, 'source-provenance', {
      ...semantic,
      ...(['repo', 'url'].includes(source.kind) ? { locator } : {}),
    });
  }
  for (const claim of byId(sources.claims))
    add(
      `claim:${claim.id}`,
      'source-claim',
      { ...claim, sourceIds: [...claim.sourceIds].sort() },
      claim.sourceIds.map((id) => `source:${id}`),
    );
  const assetNode = (id: string): string => {
    const node = `asset:${id}`;
    if (artifacts.some((a) => a.id === node)) return node;
    const asset = required(
      project.assets.find((a) => a.id === id) ??
        ledger?.assets.find((a) => a.id === id),
      `asset ${id}`,
    );
    const entry = ledger?.assets.find((a) => a.id === id);
    // Mark before recursion so a cycle is rejected by graph validation, rather than overflowing.
    add(node, 'asset', {
      id,
      type: 'type' in asset ? asset.type : asset.kind,
      digest: required(input.assetDigests[id], `asset digest ${id}`),
      ...('durationMs' in asset
        ? { durationMs: asset.durationMs ?? null }
        : {}),
    });
    const dependencies = (entry?.derivedFromAssetIds ?? []).map(assetNode);
    if (entry?.originSourceId)
      dependencies.push(`source:${entry.originSourceId}`);
    artifacts.find((a) => a.id === node)!.dependencies = dependencies.sort();
    return node;
  };
  const shared = {
    canvas: project.canvas,
    fps: project.fps,
    theme: project.theme,
    seed: project.seed ?? 0,
    camera: project.camera ?? null,
    direction: visual.direction ?? null,
    visualBrief: visual.brief,
    ...(system ? { visualSystem: system } : {}),
    brief: {
      intent: brief.intent,
      goal: brief.goal,
      audience: brief.audience,
      language: brief.language,
      tone: brief.tone ?? null,
      mustInclude: brief.mustInclude ?? [],
      avoid: brief.avoid ?? [],
      callToAction: brief.callToAction ?? null,
      referenceNotes: brief.referenceNotes ?? [],
    },
    narrative: {
      thesis: narrative.thesis,
      hook: narrative.hook,
      arc: narrative.arc,
    },
  };
  add('visual-system', 'visual-system', shared);
  for (const composition of [...input.compositions].sort((a, b) =>
    a.assetId < b.assetId ? -1 : 1,
  ))
    add(
      `composition:${composition.assetId}`,
      'composition-source',
      { id: composition.assetId, sourceDigest: composition.sourceDigest },
      composition.resourceIds.map(assetNode),
    );
  const visualTracks = project.tracks
    .filter(isVisualTrack)
    .filter((t) => !t.muted);
  const audioClips = project.tracks
    .filter(isAudioTrack)
    .flatMap((t) => t.clips);
  for (const scene of byId(project.scenes)) {
    const id = sceneId(scene.id),
      end = scene.startFrame + scene.durationFrames;
    const overlaps = (c: { startFrame: number; durationFrames: number }) =>
      c.startFrame < end && c.startFrame + c.durationFrames > scene.startFrame;
    // Equal-z painter order is semantic: preserve visual track/clip order, not filesystem order.
    const layouts = new Map(
      resolveProjectLayouts(project).map((c) => [c.id, c]),
    );
    const clips = visualTracks.flatMap((t) =>
      t.clips.filter(overlaps).map((c) => layouts.get(c.id)!),
    );
    const clipIds = new Set(clips.map((c) => c.id));
    const relevant = segments.filter((segment) => {
      const linked = audioClips.find((c) => c.id === segment.audioClipId);
      const timed = {
        startFrame: linked?.startFrame ?? segment.startFrame ?? 0,
        durationFrames: linked?.durationFrames ?? segment.durationFrames ?? 0,
      };
      return (
        (segment.subtitleMode && overlaps(timed)) ||
        segment.sceneId === scene.id ||
        [
          ...(segment.cues ?? []).map((c) =>
            'targetId' in c
              ? { kind: 'clip' as const, clipId: c.targetId }
              : c.target,
          ),
          ...(segment.phraseMappings ?? []).map((m) => m.target),
        ].some((target) =>
          resolveSemanticTargets(project, target).some((t) =>
            clipIds.has(t.clipId),
          ),
        )
      );
    });
    const intent = (segment: NarrationSegment) => ({
      id: segment.id,
      text: segment.text,
      subtitleMode: segment.subtitleMode ?? null,
      phraseMappings: segment.phraseMappings ?? [],
      cues: (segment.cues ?? []).map((cue) =>
        'targetId' in cue
          ? {
              id: cue.id,
              action: cue.type,
              targetId: cue.targetId,
              payload: cue.payload ?? null,
            }
          : {
              id: cue.id,
              digest: semanticCueIdentity(project.narration!, {
                segmentId: segment.id,
                cueId: cue.id,
              }),
            },
      ),
    });
    const resolved = {
      clipStates: choreography.clipStates.filter((s) =>
        clipIds.has(s.sourceClipId),
      ),
      generatedAnimations: choreography.generatedAnimations
        .filter((a) => clipIds.has(a.sourceClipId))
        .map((a) => ({
          sourceClipId: a.sourceClipId,
          track: a.track,
          ...(a.primitiveId ? { primitiveId: a.primitiveId } : {}),
        })),
      generatedSubtitles: choreography.generatedSubtitles.filter(overlaps),
    };
    const dependencies = new Set<string>(['visual-system']);
    const plan = required(
      narrative.scenes.find((s) => s.id === scene.id),
      'narrative scene',
    );
    plan.claimIds.forEach((c) => dependencies.add(`claim:${c}`));
    for (const clip of clips)
      if ('assetId' in clip.props) {
        const assetId = clip.props.assetId;
        const asset = required(
          project.assets.find((a) => a.id === assetId),
          'clip asset',
        );
        dependencies.add(
          asset.type === 'composition'
            ? `composition:${asset.id}`
            : assetNode(asset.id),
        );
      }
    // Provenance/resource closure is also part of the review candidate, independent of cache.
    const closure = new Set<string>();
    const visit = (dep: string) => {
      if (closure.has(dep)) return;
      closure.add(dep);
      const a = required(
        artifacts.find((a) => a.id === dep),
        `semantic dependency ${dep}`,
      );
      a.dependencies.forEach(visit);
    };
    [...dependencies].sort().forEach(visit);
    const supportScenes = project.scenes
      .filter((s) =>
        clips.some(
          (c) =>
            c.startFrame < s.startFrame + s.durationFrames &&
            c.startFrame + c.durationFrames > s.startFrame,
        ),
      )
      .map((s) => ({ ...s, startFrame: s.startFrame - scene.startFrame }));
    const relativeClips = clips.map((c) => ({
      ...c,
      startFrame: c.startFrame - scene.startFrame,
    }));
    const scenePlan = Object.fromEntries(
      Object.entries(plan).filter(([key]) => key !== 'order'),
    );
    const semantic = {
      scene: { ...scene, startFrame: 0 },
      narrative: { ...scenePlan, claimIds: [...plan.claimIds].sort() },
      visual: required(
        visual.scenes.find((s) => s.id === scene.id),
        'visual scene',
      ),
      clips: relativeClips,
      supportScenes: byId(supportScenes),
      narration: byId(relevant).map(intent),
    };
    add(id, 'scene-authored', semantic, [...dependencies]);
    const candidateInputs = {
      semantic,
      resolved: {
        ...resolved,
        clipStates: resolved.clipStates.map((s) => ({
          ...s,
          startFrame: s.startFrame - scene.startFrame,
          endFrame: s.endFrame - scene.startFrame,
        })),
        generatedSubtitles: resolved.generatedSubtitles.map((c) => ({
          ...c,
          startFrame: c.startFrame - scene.startFrame,
        })),
      },
      dependencies: [...closure].sort().map((dep) => ({
        id: dep,
        kind: artifacts.find((a) => a.id === dep)!.kind,
        inputs: artifacts.find((a) => a.id === dep)!.recipe.inputs,
        dependencies: [
          ...artifacts.find((a) => a.id === dep)!.dependencies,
        ].sort(),
      })),
      producer,
    };
    const candidate = {
      projectSha256: canonicalDigest(
        'production/scene-candidate-v1',
        candidateInputs,
      ),
      sourceSha256: canonicalDigest(
        'production/scene-source-v1',
        [...closure].sort().map((dep) => ({
          id: dep,
          kind: artifacts.find((a) => a.id === dep)!.kind,
          inputs: artifacts.find((a) => a.id === dep)!.recipe.inputs,
          dependencies: [
            ...artifacts.find((a) => a.id === dep)!.dependencies,
          ].sort(),
        })),
      ),
      // CandidateBinding paths are stable semantic references, not host filesystem locations.
      assets: [...closure]
        .filter((dep) => dep.startsWith('asset:'))
        .sort()
        .map((dep) => ({
          path: `assets/${encodeURIComponent(dep.slice(6))}`,
          sha256: input.assetDigests[dep.slice(6)]!,
        })),
    };
    add(`${id}:candidate`, 'scene-candidate', { candidate }, [id]);
    const range = { startFrame: scene.startFrame, endFrame: end };
    const rangeSpec = {
      projectDigest: candidate.projectSha256,
      sourceDigest: candidate.sourceSha256,
      assetDigests: Object.fromEntries(
        candidate.assets.map((a) => [a.path, a.sha256]),
      ),
      range,
      fps: project.fps,
      width: project.canvas.width,
      height: project.canvas.height,
      rendererProfile: context.rendererProfile,
      captureBackend: context.captureBackend,
      sceneWireVersion: context.producer.version,
    };
    const identities = productionRangeIdentity(rangeSpec, context.environment);
    add(
      `${id}:range:logical`,
      'render-range-logical',
      { spec: rangeSpec, logicalIdentity: identities.logical, resolved },
      [`${id}:candidate`],
    );
    add(
      `${id}:range:raster`,
      'render-range-raster',
      { logicalIdentity: identities.logical, range },
      [`${id}:range:logical`],
      context.environment,
    );
    if (context.rasterProducer)
      artifacts.at(-1)!.recipe.producer = producerSchema.parse(
        context.rasterProducer,
      );
    add(`${id}:review`, 'scene-review-binding', { sceneId: scene.id }, []);
    artifacts.at(-1)!.reviewCandidate = candidate;
  }
  for (const review of input.reviews ?? []) {
    sceneReviewV2Schema.parse(review);
    required(
      project.scenes.find((s) => s.id === review.sceneId),
      'review scene',
    );
  }
  const audioTracks = project.tracks
    .filter(isAudioTrack)
    .filter((t) => !t.muted);
  const audioDependencies = [
    ...new Set(
      audioTracks.flatMap((t) => t.clips.map((c) => assetNode(c.assetId))),
    ),
  ];
  add(
    'audio:mix',
    'audio-mix',
    {
      fps: project.fps,
      durationFrames: Math.max(
        ...project.scenes.map((s) => s.startFrame + s.durationFrames),
      ),
      tracks: byId(audioTracks).map((t) => ({
        id: t.id,
        type: t.type,
        clips: byId(t.clips),
      })),
    },
    audioDependencies,
  );
  if (context.audioProducer)
    artifacts.at(-1)!.recipe.producer = producerSchema.parse(
      context.audioProducer,
    );
  add(
    'final-media',
    'final-media',
    { fps: project.fps, canvas: project.canvas },
    [
      'audio:mix',
      ...byId(project.scenes).map((s) => `${sceneId(s.id)}:range:raster`),
    ],
  );
  if (context.finalProducer)
    artifacts.at(-1)!.recipe.producer = producerSchema.parse(
      context.finalProducer,
    );
  return { artifacts: orderProductionGraph({ artifacts }) };
}
