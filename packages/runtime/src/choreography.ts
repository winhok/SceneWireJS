import type {
  AnimationTrack,
  Clip,
  CueTarget,
  SemanticCue,
  VideoProject,
} from '@scenewirejs/schema';
import { cueTargetSchema, visualClips } from '@scenewirejs/schema';
export type ResolvedTarget =
  | { kind: 'clip'; clipId: string }
  | { kind: 'node'; clipId: string; nodeId: string }
  | { kind: 'edge'; clipId: string; edgeId: string };
export interface ComponentStatePatch {
  propsPatch?: Record<string, unknown>;
  animation?: {
    property: AnimationTrack['property'];
    from: number;
    to: number;
    primitiveId?: string;
  };
}
export interface ChoreographyAdapter {
  apply(
    action: SemanticCue['action'],
    target: ResolvedTarget,
    props: Clip['props'],
    payload?: Record<string, unknown>,
  ): ComponentStatePatch;
}
export interface ResolvedClipState {
  sourceClipId: string;
  startFrame: number;
  endFrame: number;
  propsPatch: Record<string, unknown>;
}
export interface ResolvedAnimation {
  sourceClipId: string;
  primitiveId?: string;
  track: AnimationTrack;
}
export interface ResolvedChoreography {
  clipStates: ResolvedClipState[];
  generatedAnimations: ResolvedAnimation[];
  generatedSubtitles: Clip[];
}
export function resolveSemanticTargets(
  project: VideoProject,
  input: CueTarget,
): ResolvedTarget[] {
  const query = cueTargetSchema.parse(input),
    clips = visualClips(project);
  const matches = (s: Clip['semantic']) =>
    s &&
    query.kind === 'semantic' &&
    (!query.role || s.role === query.role) &&
    (!query.entity || s.entity === query.entity) &&
    (!query.concept || s.concept === query.concept) &&
    (!query.tag || s.tags?.includes(query.tag));
  const result: ResolvedTarget[] = [];
  for (const clip of clips) {
    if (query.kind !== 'semantic') {
      if (clip.id !== query.clipId) continue;
      if (query.kind === 'clip') result.push(query);
      if (
        query.kind === 'node' &&
        'nodes' in clip.props &&
        clip.props.nodes.some((n) => n.id === query.nodeId)
      )
        result.push(query);
      if (
        query.kind === 'edge' &&
        'edges' in clip.props &&
        clip.props.edges.some((e) => e.id === query.edgeId)
      )
        result.push(query);
    } else {
      if (query.clipId && clip.id !== query.clipId) continue;
      if (matches(clip.semantic))
        result.push({ kind: 'clip', clipId: clip.id });
      if ('nodes' in clip.props)
        for (const node of clip.props.nodes)
          if ('semantic' in node && matches(node.semantic))
            result.push({ kind: 'node', clipId: clip.id, nodeId: node.id });
    }
  }
  return result.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'),
  );
}
