import { type OperationContext } from './helpers';
import { type ParsedPatchOperation } from './../schema';
import { resolveEditTarget } from './../inspect';
import { range } from './helpers';
import { themePreset } from '@scenewirejs/runtime';
import { resolveTheme } from '@scenewirejs/runtime';
import { duration } from './../inspect';
import { projectSchema } from '@scenewirejs/schema';
export function scene(
  ctx: OperationContext,
  o: Extract<ParsedPatchOperation, { op: 'update-scene' }>,
) {
  const { project, record, ranges } = ctx;
  let ids: string[] = [];

  ids = resolveEditTarget(project, o.target);
  const s = project.scenes.find((s) => s.id === ids[0])!,
    before = structuredClone(s);
  Object.assign(s, o.patch);
  record(s.id, `Scene:${s.name}`, before, s);
  ranges.push(range(before), range(s));

  return ids;
}
export function theme(
  ctx: OperationContext,
  o: Extract<ParsedPatchOperation, { op: 'set-theme' }>,
) {
  const { project, record, ranges } = ctx;
  let ids: string[] = [];

  ids = [project.id];
  const before = {
    theme: project.theme,
    background: project.canvas.background,
  };
  project.theme = themePreset(o.theme);
  project.canvas.background = resolveTheme(project.theme).background;
  record(project.id, 'Project theme', before, {
    theme: project.theme,
    background: project.canvas.background,
  });
  ranges.push({ startFrame: 0, endFrame: duration(project) });

  return ids;
}
export function camera(
  ctx: OperationContext,
  o: Extract<ParsedPatchOperation, { op: 'update-camera' }>,
) {
  const { project, record, ranges, warnings } = ctx;
  let ids: string[] = [];

  ids = [project.id];
  const before = project.camera;
  project.camera = projectSchema.shape.camera
    .unwrap()
    .parse({ ...before, ...o.patch });
  record(project.id, 'Project camera', before ?? {}, project.camera);
  // Holding endpoints and existing keyframes can affect the entire timeline.
  ranges.push({ startFrame: 0, endFrame: duration(project) });
  if (
    o.patch.zoom !== undefined &&
    project.camera.animations.some((a) => a.property === 'zoom')
  )
    warnings.push({
      severity: 'warning',
      code: 'camera.animated-override',
      message:
        'Zoom keyframes override static zoom; edit animations to change animated zoom',
      targetId: project.id,
    });

  return ids;
}
