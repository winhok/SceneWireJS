import { type ProductionBrief } from './../contracts/brief';
import { type NarrativePlan } from './../contracts/narrative';
import { type VisualPlan, type VisualPlanV2 } from '@scenewirejs/director-core';
import { type EngineRegistry } from '@scenewirejs/director-core';
import { type SourcePack } from './../contracts/source';
import { validateProductionPlans } from './../validation/plans';
import { projectSchema } from '@scenewirejs/schema';
import { CURRENT_PROJECT_VERSION } from '@scenewirejs/schema';
export interface SkeletonScene {
  sceneId: string;
  engineId: string;
  directory?: string;
  manifestPath?: string;
}
export function compileProductionSkeleton(
  brief: ProductionBrief,
  narrative: NarrativePlan,
  visual: VisualPlan | VisualPlanV2,
  registry: EngineRegistry,
  options: { sources: SourcePack; createdAt: string; seed: number },
) {
  const report = validateProductionPlans(
    brief,
    options.sources,
    narrative,
    visual,
    registry,
  );
  if (!report.valid) throw new Error(JSON.stringify(report.diagnostics));
  const visualBySceneId = new Map(visual.scenes.map((s) => [s.id, s]));
  let startFrame = 0;
  const scenes = narrative.scenes.map((s) => {
    const scene = {
      id: s.id,
      name: s.title,
      startFrame,
      durationFrames: s.durationFrames,
    };
    startFrame += s.durationFrames;
    return scene;
  });
  const scaffoldRequests: SkeletonScene[] = scenes.map((s) => {
    const engineId = visualBySceneId.get(s.id)!.engineId;
    return {
      sceneId: s.id,
      engineId,
      ...(engineId === 'structured'
        ? {}
        : {
            directory: `compositions/${s.id}`,
            manifestPath: `compositions/${s.id}/composition.json`,
          }),
    };
  });
  const requestBySceneId = new Map(scaffoldRequests.map((r) => [r.sceneId, r]));
  const direction = visual.direction;
  const project = projectSchema.parse({
    id: brief.id,
    version: CURRENT_PROJECT_VERSION,
    metadata: {
      title: brief.goal,
      createdAt: options.createdAt,
      updatedAt: options.createdAt,
    },
    canvas: {
      width: brief.canvas.width,
      height: brief.canvas.height,
      background: direction?.palette.background ?? '#101827',
    },
    fps: brief.canvas.fps,
    seed: options.seed,
    theme: {
      name: 'production',
      fontFamily: direction?.typography.family ?? 'sans-serif',
      foreground: direction?.palette.foreground ?? '#ffffff',
      accent: direction?.palette.accent ?? '#53d5b0',
    },
    assets: scaffoldRequests
      .filter((r) => r.manifestPath)
      .map((r) => ({
        id: `asset-${r.sceneId}`,
        type: 'composition',
        rendererId: registry.getEngine(r.engineId)!.rendererId,
        src: r.manifestPath,
      })),
    scenes,
    tracks: [
      {
        id: `visual-${brief.id}`,
        name: 'Production',
        type: 'visual',
        clips: scenes.flatMap((s) => {
          const request = requestBySceneId.get(s.id)!;
          return request.engineId === 'structured'
            ? []
            : [
                {
                  id: `clip-${s.id}`,
                  component: 'ForeignComposition',
                  startFrame: s.startFrame,
                  durationFrames: s.durationFrames,
                  transform: {},
                  props: {
                    assetId: `asset-${s.id}`,
                    placement: 'replace-scene',
                  },
                },
              ];
        }),
      },
    ],
    markers: scenes.map((s) => ({
      id: `marker-${s.id}`,
      frame: s.startFrame,
      label: s.name,
    })),
  });
  return { project, scaffoldRequests };
}
