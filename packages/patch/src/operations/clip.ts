import { type OperationContext } from './helpers';
import { type ParsedPatchOperation } from './../schema';
import { resolveEditTarget } from './../inspect';
import { clip } from './helpers';
import { clipSchema } from '@scenewirejs/schema';
import { replaceClip } from './helpers';
import { range } from './helpers';
export function clipTiming(
  ctx: OperationContext,
  o: Extract<ParsedPatchOperation, { op: 'update-clip' | 'retime-clip' }>,
) {
  const { project, record, ranges } = ctx;
  let ids: string[] = [];

  ids = resolveEditTarget(project, o.target);
  for (const id of ids) {
    const before = clip(project, id);
    const after = clipSchema.parse(
      o.op === 'update-clip'
        ? {
            ...before,
            ...o.patch,
            props: { ...before.props, ...o.patch.props },
            transform: { ...before.transform, ...o.patch.transform },
            ...(o.patch.effects
              ? { effects: { ...before.effects, ...o.patch.effects } }
              : {}),
          }
        : {
            ...before,
            startFrame:
              o.shiftFrames !== undefined
                ? before.startFrame + o.shiftFrames
                : (o.startFrame ?? before.startFrame),
            durationFrames: o.durationFrames ?? before.durationFrames,
          },
    );
    replaceClip(project, id, after);
    record(
      id,
      `${before.component}:${before.semantic?.entity ?? id}`,
      before,
      after,
    );
    ranges.push(range(before), range(after));
  }

  return ids;
}
