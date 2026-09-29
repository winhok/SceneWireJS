import { isVisualTrack, visualClips } from '@scenewirejs/schema';
import {
  projectSchema,
  type Clip,
  type StructuredLayout,
  type Transform,
  type VideoProject,
} from '@scenewirejs/schema';
export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function resolveLayout(
  layout: StructuredLayout,
  canvas: VideoProject['canvas'],
  clips: readonly Clip[],
): ReadonlyMap<string, Transform> {
  const result = new Map<string, Transform>();
  const w = canvas.width - 2 * layout.padding,
    h = canvas.height - 2 * layout.padding;
  const count = layout.clipIds.length;
  const byId = new Map(clips.map((c) => [c.id, c]));
  for (let i = 0; i < count; i++) {
    const id = layout.clipIds[i]!,
      clip = byId.get(id);
    if (!clip) throw new Error(`Unknown layout clip: ${id}`);
    if (layout.type === 'absolute') {
      result.set(id, { ...clip.transform });
      continue;
    }
    let bounds: LayoutBounds = {
      x: layout.padding,
      y: layout.padding,
      width: w,
      height: h,
    };
    if (layout.type === 'centered') {
      bounds = {
        x: (canvas.width - clip.transform.width) / 2,
        y: (canvas.height - clip.transform.height) / 2,
        width: clip.transform.width,
        height: clip.transform.height,
      };
    } else if (layout.type === 'grid') {
      const cols = Math.min(count, layout.columns),
        rows = Math.ceil(count / cols);
      const width = (w - (cols - 1) * layout.gap) / cols,
        height = (h - (rows - 1) * layout.gap) / rows;
      bounds = {
        x: layout.padding + (i % cols) * (width + layout.gap),
        y: layout.padding + Math.floor(i / cols) * (height + layout.gap),
        width,
        height,
      };
    } else {
      const horizontal = layout.direction === 'horizontal';
      const extent = horizontal ? w : h;
      const available = extent - (count - 1) * layout.gap;
      // Normalize by the largest ratio to avoid overflow for otherwise finite input.
      const ratios =
        layout.type === 'split'
          ? layout.ratio.map((r) => r / Math.max(...layout.ratio))
          : Array.from({ length: count }, () => 1);
      const sum = ratios.reduce((a, b) => a + b, 0);
      const size = (available * ratios[i]!) / sum;
      const before =
        (available * ratios.slice(0, i).reduce((a, b) => a + b, 0)) / sum +
        i * layout.gap;
      bounds = horizontal
        ? {
            x: layout.padding + before,
            y: layout.padding,
            width: size,
            height: h,
          }
        : {
            x: layout.padding,
            y: layout.padding + before,
            width: w,
            height: size,
          };
    }
    result.set(id, { ...clip.transform, ...bounds });
  }
  return result;
}
export function resolveProjectLayouts(project: VideoProject): Clip[] {
  const clips = visualClips(project);
  const transforms = new Map<string, Transform>();
  for (const scene of project.scenes) {
    if (!scene.layout || typeof scene.layout === 'string') continue;
    for (const [id, transform] of resolveLayout(
      scene.layout,
      project.canvas,
      clips,
    ))
      transforms.set(id, transform);
  }
  return clips.map((c) => ({
    ...c,
    transform: transforms.get(c.id) ?? c.transform,
  }));
}
export function detachLayout(project: VideoProject, id: string): VideoProject {
  const resolved = resolveProjectLayouts(project).find((c) => c.id === id);
  if (!resolved) return project;
  const affected = project.scenes.some(
    (s) =>
      s.layout && typeof s.layout !== 'string' && s.layout.clipIds.includes(id),
  );
  if (!affected) return project;
  // Detach the entire layout to avoid shifting other slots when one is removed.
  const scene = project.scenes.find(
    (s) =>
      s.layout && typeof s.layout !== 'string' && s.layout.clipIds.includes(id),
  )!;
  const ids = new Set(
    typeof scene.layout === 'object' ? scene.layout.clipIds : [],
  );
  const transforms = new Map(
    resolveProjectLayouts(project)
      .filter((c) => ids.has(c.id))
      .map((c) => [c.id, c.transform]),
  );
  return projectSchema.parse({
    ...project,
    scenes: project.scenes.map((s) =>
      s.id === scene.id ? { ...s, layout: undefined } : s,
    ),
    tracks: project.tracks.map((t) =>
      !isVisualTrack(t)
        ? t
        : {
            ...t,
            clips: t.clips.map((c) =>
              transforms.has(c.id)
                ? { ...c, transform: transforms.get(c.id) }
                : c,
            ),
          },
    ),
  });
}
