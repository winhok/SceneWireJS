import { type OperationContext } from './helpers';
import { type ParsedPatchOperation } from './../schema';
import { resolveEditTarget } from './../inspect';
import { clip } from './helpers';
import { clipSchema } from '@scenewirejs/schema';
import { replaceClip } from './helpers';
import { range } from './helpers';
export function compositionParameters(
  ctx: OperationContext,
  o: Extract<ParsedPatchOperation, { op: 'update-composition-params' }>,
) {
  const { project, record, ranges } = ctx;
  let ids: string[] = [];

  ids = resolveEditTarget(project, o.target);
  for (const id of ids) {
    const before = clip(project, id);
    if (before.component !== 'ForeignComposition')
      throw new Error('Parameter target must be ForeignComposition');
    const after = clipSchema.parse({
      ...before,
      props: {
        ...before.props,
        parameters: { ...before.props.parameters, ...o.parameters },
      },
    });
    replaceClip(project, id, after);
    record(id, `ForeignComposition:${id}`, before, after);
    ranges.push(range(before));
  }

  return ids;
}
