import { isVisualTrack, visualClips } from '@scenewirejs/schema';
import { detachLayout, resolveProjectLayouts } from '@scenewirejs/runtime';
import { create } from 'zustand';
import {
  projectSchema,
  type Clip,
  type VideoProject,
} from '@scenewirejs/schema';
export function updateClip(
  project: VideoProject,
  id: string,
  change: (clip: Clip) => Clip,
): VideoProject {
  const track = project.tracks
    .filter(isVisualTrack)
    .find((t) => t.clips.some((c) => c.id === id));
  if (!track || track.locked) return project;
  const source = track.clips.find((c) => c.id === id)!;
  const resolved = resolveProjectLayouts(project).find((c) => c.id === id)!;
  const candidate = change(resolved);
  const geometryChanged =
    JSON.stringify(candidate.transform) !==
      JSON.stringify(resolved.transform) ||
    candidate.startFrame !== source.startFrame ||
    candidate.durationFrames !== source.durationFrames;
  const next = geometryChanged ? detachLayout(project, id) : project;
  return projectSchema.parse({
    ...next,
    tracks: next.tracks.map((t) =>
      !isVisualTrack(t)
        ? t
        : {
            ...t,
            clips: t.clips.map((c) =>
              c.id === id
                ? {
                    ...candidate,
                    transform: geometryChanged
                      ? candidate.transform
                      : c.transform,
                  }
                : c,
            ),
          },
    ),
  });
}
export function findClip(
  project: VideoProject,
  id: string | undefined,
): Clip | undefined {
  return visualClips(project).find((c) => c.id === id);
}
export function projectDuration(project: VideoProject): number {
  return Math.max(
    ...project.scenes.map((s) => s.startFrame + s.durationFrames),
  );
}
export function minimumClipDuration(clip: Clip): number {
  return Math.max(
    1,
    ...clip.animations.flatMap((a) => a.keyframes.map((k) => k.frame + 1)),
    ...(clip.motion ?? []).map(
      (m) =>
        m.startFrame +
        m.durationFrames +
        (m.preset === 'stagger' ? m.staggerIndex * m.staggerFrames : 0),
    ),
  );
}
export function nextId(project: VideoProject, prefix: string): string {
  const ids = new Set([
    project.id,
    ...project.assets.map((a) => a.id),
    ...project.scenes.map((s) => s.id),
    ...project.markers.map((m) => m.id),
    ...project.tracks.flatMap((t) => [t.id, ...t.clips.map((c) => c.id)]),
    ...(project.narration?.segments.flatMap((s) => [
      s.id,
      ...(s.cues?.map((c) => c.id) ?? []),
    ]) ?? []),
  ]);
  let index = 1;
  while (ids.has(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}
interface ProjectState {
  project: VideoProject;
  past: VideoProject[];
  future: VideoProject[];
  apply: (next: VideoProject) => void;
  replace: (next: VideoProject) => void;
  undo: () => void;
  redo: () => void;
}
export function createProjectStore(initial: VideoProject) {
  return create<ProjectState>((set) => ({
    project: projectSchema.parse(initial),
    past: [],
    future: [],
    apply: (next) =>
      set((s) => {
        const parsed = projectSchema.parse(next);
        if (JSON.stringify(parsed) === JSON.stringify(s.project)) return s;
        return {
          project: parsed,
          past: [...s.past.slice(-49), s.project],
          future: [],
        };
      }),
    replace: (next) =>
      set({ project: projectSchema.parse(next), past: [], future: [] }),
    undo: () =>
      set((s) => {
        const previous = s.past.at(-1);
        return previous
          ? {
              project: previous,
              past: s.past.slice(0, -1),
              future: [s.project, ...s.future],
            }
          : s;
      }),
    redo: () =>
      set((s) => {
        const next = s.future[0];
        return next
          ? {
              project: next,
              past: [...s.past, s.project],
              future: s.future.slice(1),
            }
          : s;
      }),
  }));
}
export interface PlaybackClock {
  seek(frame: number): void;
  play(frame: number, fps: number): void;
  pause(): void;
}
export type {
  TTSRequest,
  TTSResult,
  TTSProvider,
  PlaybackTransport,
  SpeechAlignmentProvider,
} from '@scenewirejs/audio';
export interface ExportAdapter {
  export(project: VideoProject, signal?: AbortSignal): Promise<Blob>;
}
