import { type ProductionBrief } from './../contracts/brief';
import { type NarrativePlan } from './../contracts/narrative';
import { type VisualPlan } from '@scenewirejs/director-core';
import { type Validation } from './diagnostics';
import {
  type VideoProject,
  type Clip,
  type NarrationSegment,
} from '@scenewirejs/schema';
import { parse } from './diagnostics';
import { projectSchema } from '@scenewirejs/schema';
import { CURRENT_PROJECT_VERSION } from '@scenewirejs/schema';
import { error } from './diagnostics';
import { isVisualTrack } from '@scenewirejs/schema';
export function validateProductionAssembly(
  projectInput: unknown,
  brief: ProductionBrief,
  narrative: NarrativePlan,
  visual: VisualPlan,
): Validation<VideoProject> {
  const report = parse(projectSchema, projectInput);
  if (!report.value) return report;
  const p = report.value;
  if (p.version !== CURRENT_PROJECT_VERSION)
    error(
      report,
      'project.version',
      'Project version differs from current project format',
    );
  if (
    p.id !== brief.id ||
    p.fps !== brief.canvas.fps ||
    p.canvas.width !== brief.canvas.width ||
    p.canvas.height !== brief.canvas.height
  )
    error(
      report,
      'project.brief',
      'Project identity/canvas differs from brief',
    );
  if (p.scenes.length !== narrative.scenes.length)
    error(report, 'project.coverage', 'Project has extra or missing scenes');
  const sceneById = new Map(p.scenes.map((s) => [s.id, s]));
  const visualBySceneId = new Map<string, VisualPlan['scenes'][number]>();
  for (const scene of visual.scenes)
    if (!visualBySceneId.has(scene.id)) visualBySceneId.set(scene.id, scene);
  const assetById = new Map(p.assets.map((a) => [a.id, a]));
  const narrationBySceneId = new Map<string, NarrationSegment[]>();
  for (const segment of p.narration?.segments ?? []) {
    if (!segment.sceneId) continue;
    const list = narrationBySceneId.get(segment.sceneId) ?? [];
    list.push(segment);
    narrationBySceneId.set(segment.sceneId, list);
  }
  // Sort once and consume half-open narrative ranges; preserve overlapping-layer membership.
  const enabledClips = p.tracks
    .filter(isVisualTrack)
    .filter((t) => !t.muted)
    .flatMap((t) => t.clips)
    .sort((a, b) => a.startFrame - b.startFrame);
  const clipsByNarrativeRange: Clip[][] = [];
  let cursor = 0,
    rangeStart = 0;
  for (const scene of narrative.scenes) {
    const list: Clip[] = [];
    const end = rangeStart + scene.durationFrames;
    while (
      cursor < enabledClips.length &&
      enabledClips[cursor]!.startFrame < end
    ) {
      const clip = enabledClips[cursor++]!;
      if (clip.startFrame >= rangeStart) list.push(clip);
    }
    clipsByNarrativeRange.push(list);
    rangeStart = end;
  }
  let start = 0,
    sceneIndex = 0;
  for (const scene of narrative.scenes) {
    const actual = sceneById.get(scene.id);
    if (
      !actual ||
      actual.startFrame !== start ||
      actual.durationFrames !== scene.durationFrames
    )
      error(
        report,
        'project.duration',
        'Scene timing differs from narrative',
        scene.id,
      );
    const engine = visualBySceneId.get(scene.id)?.engineId;
    const clips = clipsByNarrativeRange[sceneIndex++]!;
    if (!clips.length)
      error(
        report,
        'scene.empty',
        'Scene has no visual implementation',
        scene.id,
      );
    if (
      engine === 'structured' &&
      clips.some((c) => c.component === 'ForeignComposition')
    )
      error(
        report,
        'scene.engine',
        'Structured scene contains foreign composition',
        scene.id,
      );
    if (
      engine !== 'structured' &&
      !clips.some(
        (c) =>
          c.component === 'ForeignComposition' &&
          (() => {
            const asset = assetById.get(c.props.assetId);
            return (
              asset?.type === 'composition' &&
              asset.src === `compositions/${scene.id}/composition.json`
            );
          })(),
      )
    )
      error(
        report,
        'scene.engine',
        'Expected scene composition missing',
        scene.id,
      );
    if (brief.narration === 'voiceover') {
      const segments = narrationBySceneId.get(scene.id) ?? [];
      if (
        segments.length !== 1 ||
        segments[0]?.text !== scene.voiceover ||
        !segments[0]?.audioAssetId ||
        !segments[0]?.words?.length
      )
        error(
          report,
          'narration.coverage',
          'Narration text/audio/timings missing or stale',
          scene.id,
        );
    }
    start += scene.durationFrames;
  }
  return report;
}
