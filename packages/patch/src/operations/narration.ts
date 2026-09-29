import { type OperationContext } from './helpers';
import { type ParsedPatchOperation } from './../schema';
import { resolveEditTarget } from './../inspect';
import { segmentRange } from './helpers';
export function narration(
  ctx: OperationContext,
  o: Extract<ParsedPatchOperation, { op: 'update-narration' }>,
) {
  const { project, record, ranges, warnings } = ctx;
  let ids: string[] = [];

  ids = resolveEditTarget(project, {
    kind: 'narration-segment',
    segmentId: o.segmentId,
  });
  const s = project.narration!.segments.find((s) => s.id === o.segmentId)!,
    before = structuredClone(s);
  Object.assign(s, o.patch);
  record(s.id, `Narration:${s.id}`, before, s);
  ranges.push(segmentRange(project, s.id));
  if (o.patch.text !== undefined && o.patch.text !== before.text)
    warnings.push({
      severity: 'warning',
      code: 'narration.audio-unchanged',
      message:
        'Text edited; existing audio, word and phrase timings have not been regenerated',
      targetId: s.id,
    });

  return ids;
}
