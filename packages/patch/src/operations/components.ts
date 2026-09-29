import { type OperationContext } from './helpers';
import { type ParsedPatchOperation } from './../schema';
import { resolveEditTarget } from './../inspect';
import { isVisualTrack } from '@scenewirejs/schema';
import { fail } from './../inspect';
import { definition } from './helpers';
import { createClipFromDefinition } from '@scenewirejs/runtime';
import { clipSchema } from '@scenewirejs/schema';
import { range } from './helpers';
import { clip } from './helpers';
import { clipReferences } from './../inspect';
import { replaceClip } from './helpers';
import { equal } from './../diff';
export function addComponent(
  ctx: OperationContext,
  o: Extract<ParsedPatchOperation, { op: 'add-component' }>,
) {
  const { project, registry, planId, index, record, ranges } = ctx;
  let ids: string[] = [];

  resolveEditTarget(project, { kind: 'scene', sceneId: o.sceneId });
  const scene = project.scenes.find((s) => s.id === o.sceneId)!;
  const candidates = project.tracks
    .filter(isVisualTrack)
    .filter((t) => t.type === 'visual' && !t.locked);
  const track = o.trackId
    ? candidates.find((t) => t.id === o.trackId)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (!track)
    fail(
      'track.unavailable',
      'Specify one unlocked visual track for addition',
      o.trackId,
    );
  const id = o.id ?? `${planId.slice(0, 100)}:add:${index}`,
    d = definition(registry, o.component);
  const startFrame = o.startFrame ?? scene.startFrame;
  const base = createClipFromDefinition({
    definition: d,
    id,
    startFrame,
    durationFrames:
      o.durationFrames ??
      Math.min(
        d.authoring.defaultDurationFrames ?? 90,
        scene.startFrame + scene.durationFrames - startFrame,
      ),
  });
  const added = clipSchema.parse({
    ...base,
    props: { ...base.props, ...o.props },
    transform: { ...base.transform, ...o.transform },
    ...(o.semantic ? { semantic: o.semantic } : {}),
  });
  if (
    added.startFrame < scene.startFrame ||
    added.startFrame + added.durationFrames >
      scene.startFrame + scene.durationFrames
  )
    fail('scene.bounds', 'New clip must fit the selected scene', scene.id);
  track.clips.push(added);
  ids = [id];
  record(id, `${added.component}:${id}`, null, added);
  ranges.push(range(added));

  return ids;
}
export function deleteComponent(
  ctx: OperationContext,
  o: Extract<ParsedPatchOperation, { op: 'delete-component' }>,
) {
  const { project, record, ranges } = ctx;
  let ids: string[] = [];

  const before = clip(project, o.clipId),
    refs = clipReferences(project, o.clipId);
  if (refs.length)
    fail(
      'clip.referenced',
      `Cannot delete ${o.clipId}: ${refs.map((r) => `${r.kind}:${r.id}`).join(', ')}`,
      o.clipId,
    );
  replaceClip(project, o.clipId);
  ids = [o.clipId];
  record(o.clipId, `${before.component}:${o.clipId}`, before, null);
  ranges.push(range(before));

  return ids;
}
export function replaceComponent(
  ctx: OperationContext,
  o: Extract<ParsedPatchOperation, { op: 'replace-component' }>,
) {
  const { project, registry, record, ranges } = ctx;
  let ids: string[] = [];

  const before = clip(project, o.clipId),
    d = definition(registry, o.component);
  const keep = {
    timing: true,
    transform: true,
    semantic: true,
    motion: false,
    ...o.preserve,
  };
  const base = createClipFromDefinition({
    definition: d,
    id: before.id,
    startFrame: keep.timing ? before.startFrame : 0,
    ...(keep.timing ? { durationFrames: before.durationFrames } : {}),
  });
  const after = clipSchema.parse({
    ...base,
    props: { ...base.props, ...o.props },
    ...(keep.transform ? { transform: before.transform } : {}),
    ...(keep.semantic && before.semantic ? { semantic: before.semantic } : {}),
    ...(keep.motion
      ? { motion: before.motion, animations: before.animations }
      : {}),
  });
  const refs = clipReferences(project, before.id);
  replaceClip(project, before.id, after);
  // Do not silently lose semantic/node references that still match another clip.
  const retained = clipReferences(project, before.id);
  if (refs.some((r) => !retained.some((a) => equal(a, r))))
    fail(
      'clip.reference-lost',
      'Replacement would detach an existing semantic or node reference',
      before.id,
    );
  ids = [before.id];
  record(before.id, `${before.component}:${before.id}`, before, after);
  ranges.push(range(before), range(after));

  return ids;
}
