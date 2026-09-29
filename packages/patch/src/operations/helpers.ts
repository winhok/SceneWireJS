import { type VideoProject } from '@scenewirejs/schema';
import { resolveEditTarget } from './../inspect';
import { visualClips } from '@scenewirejs/schema';
import { fail } from './../inspect';
import { type Clip } from '@scenewirejs/schema';
import { isVisualTrack } from '@scenewirejs/schema';
import { type ComponentRegistry } from '@scenewirejs/runtime';
import { type ComponentDefinition } from '@scenewirejs/runtime';
import { type FrameRange } from './../contracts';
import { isAudioTrack } from '@scenewirejs/schema';
import { duration } from './../inspect';
import { type PatchIssue } from './../inspect';
export function clip(project: VideoProject, id: string) {
  resolveEditTarget(project, { kind: 'clip', clipId: id });
  return visualClips(project).find((c) => c.id === id)!;
}
export function writable(project: VideoProject, id: string) {
  if (project.tracks.some((t) => t.locked && t.clips.some((c) => c.id === id)))
    fail('track.locked', `Clip is on a locked track: ${id}`, id);
}
export function replaceClip(project: VideoProject, id: string, value?: Clip) {
  writable(project, id);
  for (const t of project.tracks.filter(isVisualTrack))
    if (t.clips.some((c) => c.id === id))
      t.clips = t.clips.flatMap((c) =>
        c.id === id ? (value ? [value] : []) : [c],
      );
}
export function definition(
  registry: ComponentRegistry,
  type: Clip['component'],
): ComponentDefinition {
  const d = registry.find((d) => d.type === type);
  if (!d || !('authoring' in d))
    fail('component.missing', `No authoring definition: ${type}`);
  return d as ComponentDefinition;
}
export function segmentRange(project: VideoProject, id: string): FrameRange {
  const s = project.narration!.segments.find((s) => s.id === id)!;
  const audio = project.tracks
    .filter(isAudioTrack)
    .flatMap((t) => t.clips)
    .find((c) => c.id === s.audioClipId);
  return {
    startFrame: audio?.startFrame ?? s.startFrame ?? 0,
    endFrame:
      (audio?.startFrame ?? s.startFrame ?? 0) +
      (audio?.durationFrames ?? s.durationFrames ?? duration(project)),
  };
}
export const range = (c: {
  startFrame: number;
  durationFrames: number;
}): FrameRange => ({
  startFrame: c.startFrame,
  endFrame: c.startFrame + c.durationFrames,
});
export interface OperationContext {
  project: VideoProject;
  registry: ComponentRegistry;
  planId: string;
  index: number;
  record: (id: string, label: string, before: unknown, after: unknown) => void;
  ranges: FrameRange[];
  warnings: PatchIssue[];
}
