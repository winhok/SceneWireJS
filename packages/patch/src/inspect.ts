import { videoDiagnostics } from '@scenewirejs/schema';
import {
  projectSchema,
  visualClips,
  isAudioTrack,
  type VideoProject,
  type Clip,
  type CueTarget,
} from '@scenewirejs/schema';
import {
  compileProject,
  resolveSemanticTargets,
  resolveCamera,
  type ComponentRegistry,
} from '@scenewirejs/runtime';
import { compileChoreography } from '@scenewirejs/compiler';
import {
  editTargetSchema,
  semanticSelectorSchema,
  type EditTarget,
} from './schema';
export interface PatchIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  targetId?: string;
  operationIndex?: number;
}
export class PatchError extends Error {
  constructor(public readonly issues: PatchIssue[]) {
    super(issues.map((i) => i.message).join('; '));
  }
}
export function fail(code: string, message: string, targetId?: string): never {
  throw new PatchError([
    { severity: 'error', code, message, ...(targetId ? { targetId } : {}) },
  ]);
}
export function duration(project: VideoProject) {
  return Math.max(
    ...project.scenes.map((s) => s.startFrame + s.durationFrames),
  );
}
export function searchSemantic(project: VideoProject, input: unknown) {
  const q = semanticSelectorSchema.parse(input);
  return structuredClone(
    visualClips(project)
      .filter(
        (c) =>
          (!q.clipId || c.id === q.clipId) &&
          (!q.component || c.component === q.component) &&
          (!q.role || c.semantic?.role === q.role) &&
          (!q.entity || c.semantic?.entity === q.entity) &&
          (!q.concept || c.semantic?.concept === q.concept) &&
          (!q.tag || c.semantic?.tags?.includes(q.tag)),
      )
      .map((c) => ({
        clipId: c.id,
        component: c.component,
        semantic: c.semantic,
      })),
  );
}
export function resolveEditTarget(
  project: VideoProject,
  input: EditTarget,
): string[] {
  const t = editTargetSchema.parse(input);
  let ids: string[] = [];
  switch (t.kind) {
    case 'project':
      ids = [project.id];
      break;
    case 'scene':
      ids = project.scenes.filter((s) => s.id === t.sceneId).map((s) => s.id);
      break;
    case 'clip':
      ids = visualClips(project)
        .filter((c) => c.id === t.clipId)
        .map((c) => c.id);
      break;
    case 'narration-segment':
      ids =
        project.narration?.segments
          .filter((s) => s.id === t.segmentId)
          .map((s) => s.id) ?? [];
      break;
    case 'semantic':
      ids = searchSemantic(project, t).map((c) => c.clipId);
      break;
  }
  if (!ids.length)
    fail('target.missing', `Target matched no objects: ${JSON.stringify(t)}`);
  if (t.kind === 'semantic' && t.match === 'one' && ids.length !== 1)
    fail(
      'target.ambiguous',
      `Expected one clip, matched ${ids.length}: ${ids.join(', ')}`,
    );
  return ids;
}
export function clipReferences(project: VideoProject, clipId: string) {
  const refs: {
    kind: 'layout' | 'cue' | 'phrase-mapping';
    id: string;
    segmentId?: string;
  }[] = [];
  for (const s of project.scenes)
    if (typeof s.layout === 'object' && s.layout.clipIds.includes(clipId))
      refs.push({ kind: 'layout', id: s.id });
  const matches = (t: CueTarget) =>
    resolveSemanticTargets(project, t).some((r) => r.clipId === clipId);
  for (const s of project.narration?.segments ?? []) {
    for (const c of s.cues ?? [])
      if ('targetId' in c ? c.targetId === clipId : matches(c.target))
        refs.push({ kind: 'cue', id: c.id, segmentId: s.id });
    for (const [i, m] of (s.phraseMappings ?? []).entries())
      if (matches(m.target))
        refs.push({
          kind: 'phrase-mapping',
          id: `${s.id}:${i}`,
          segmentId: s.id,
        });
  }
  return refs;
}
export function inspectClip(project: VideoProject, clipId: string) {
  resolveEditTarget(project, { kind: 'clip', clipId });
  const c = visualClips(project).find((c) => c.id === clipId)!;
  return structuredClone({
    ...c,
    endFrame: c.startFrame + c.durationFrames,
    ...(c.component === 'Video'
      ? {
          sourceWindow: {
            ...c.props,
            sourceOutMs:
              c.props.sourceInMs +
              (c.durationFrames / project.fps) * 1000 * c.props.playbackRate,
            projectStartMs: (c.startFrame / project.fps) * 1000,
            projectEndMs:
              ((c.startFrame + c.durationFrames) / project.fps) * 1000,
          },
        }
      : {}),
    references: clipReferences(project, clipId),
  });
}
const compact = (c: Clip) => ({
  id: c.id,
  component: c.component,
  startFrame: c.startFrame,
  endFrame: c.startFrame + c.durationFrames,
  semantic: c.semantic,
});
export function inspectScene(project: VideoProject, sceneId: string) {
  resolveEditTarget(project, { kind: 'scene', sceneId });
  const s = project.scenes.find((s) => s.id === sceneId)!;
  const clips = visualClips(project).filter(
    (c) =>
      c.startFrame < s.startFrame + s.durationFrames &&
      c.startFrame + c.durationFrames > s.startFrame,
  );
  return structuredClone({
    ...s,
    endFrame: s.startFrame + s.durationFrames,
    camera: {
      start: resolveCamera(project, s.startFrame),
      middle: resolveCamera(
        project,
        s.startFrame + Math.floor(s.durationFrames / 2),
      ),
      end: resolveCamera(project, s.startFrame + s.durationFrames - 1),
      animations: project.camera?.animations.map((a) => ({
        property: a.property,
        keyframes: a.keyframes.filter(
          (k) =>
            k.frame >= s.startFrame &&
            k.frame < s.startFrame + s.durationFrames,
        ),
      })),
    },
    clips: clips.map(compact),
    narration: project.narration?.segments.filter((n) => n.sceneId === s.id),
    semanticConcepts: [
      ...new Set(clips.map((c) => c.semantic?.concept).filter(Boolean)),
    ],
  });
}
export function summarizeTimeline(project: VideoProject) {
  return {
    fps: project.fps,
    durationFrames: duration(project),
    scenes: project.scenes.map((s) => ({
      id: s.id,
      name: s.name,
      startFrame: s.startFrame,
      endFrame: s.startFrame + s.durationFrames,
    })),
    tracks: project.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      muted: t.muted,
      locked: t.locked,
      clips: t.clips.map((c) => ({
        id: c.id,
        startFrame: c.startFrame,
        endFrame: c.startFrame + c.durationFrames,
      })),
    })),
  };
}
export function inspectProject(
  project: VideoProject,
  registry: ComponentRegistry,
) {
  const clips = visualClips(project);
  return structuredClone({
    id: project.id,
    version: project.version,
    title: project.metadata.title,
    compositions: clips
      .filter((c) => c.component === 'ForeignComposition')
      .map((c) => ({
        id: c.id,
        type: c.component,
        renderer: project.assets
          .filter((a) => a.type === 'composition')
          .find((a) => a.id === c.props.assetId)?.rendererId,
        asset: c.props.assetId,
        placement: c.props.placement,
      })),
    canvas: project.canvas,
    theme: project.theme,
    camera: {
      initial: resolveCamera(project, 0),
      animations: project.camera?.animations.map((a) => ({
        property: a.property,
        keyframeCount: a.keyframes.length,
        first: a.keyframes[0],
        last: a.keyframes.at(-1),
      })),
    },
    ...summarizeTimeline(project),
    componentInventory: [...new Set(clips.map((c) => c.component))].map(
      (component) => ({
        component,
        count: clips.filter((c) => c.component === component).length,
        registered: registry.some((d) => d.type === component),
      }),
    ),
    narration: project.narration?.segments.map((s) => ({
      id: s.id,
      sceneId: s.sceneId,
      text: s.text,
      audioClipId: s.audioClipId,
      cues: s.cues?.length ?? 0,
      phraseMappings: s.phraseMappings?.length ?? 0,
    })),
    semanticInventory: clips
      .filter((c) => c.semantic || 'nodes' in c.props)
      .map((c) => ({
        ...compact(c),
        ...('nodes' in c.props
          ? {
              nodes: c.props.nodes.map((n) => ({
                id: n.id,
                semantic: 'semantic' in n ? n.semantic : undefined,
              })),
            }
          : {}),
      })),
  });
}
export function validateProjectForEditing(
  input: unknown,
  registry: ComponentRegistry,
): PatchIssue[] {
  const mediaIssues = videoDiagnostics(input);
  if (mediaIssues.length)
    return mediaIssues.map((i) => ({
      severity: 'error' as const,
      code: i.code,
      message: i.path.join('.') + ': ' + i.message,
    }));
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success)
    return parsed.error.issues.map((i) => ({
      severity: 'error',
      code: 'project.schema',
      message: `${i.path.join('.')}: ${i.message}`,
    }));
  const project = parsed.data;
  try {
    const choreography = compileChoreography({
      project,
      componentRegistry: registry,
    });
    try {
      compileProject(project, registry, choreography);
    } catch (e) {
      return [
        {
          severity: 'error',
          code: 'project.runtime',
          message: e instanceof Error ? e.message : String(e),
        },
      ];
    }
  } catch (e) {
    return [
      {
        severity: 'error',
        code: 'project.choreography',
        message: e instanceof Error ? e.message : String(e),
      },
    ];
  }
  const used = new Set(
    project.tracks
      .filter(isAudioTrack)
      .flatMap((t) => t.clips.map((c) => c.assetId)),
  );
  return project.assets.map((a) => ({
    severity: 'warning' as const,
    code: 'asset.bytes-unverified',
    message: `Asset bytes unavailable to pure validation${used.has(a.id) ? ' (used by audio)' : ''}`,
    targetId: a.id,
  }));
}
