import type { CompiledProject } from './index';
import type { ResolvedAnimation } from './choreography';
interface EvaluationIndex {
  readonly statesByClipId: Readonly<
    Record<string, readonly CompiledProject['states'][number][]>
  >;
  readonly primitiveAnimationsByClipId: Readonly<
    Record<string, Readonly<Record<string, readonly ResolvedAnimation[]>>>
  >;
}
// Compiled snapshots own immutable lookup data; WeakMap keeps internal indexes out of
// the public CompiledProject contract and releases them with their owning snapshot.
const indexes = new WeakMap<CompiledProject, EvaluationIndex>();
export function evaluationIndexes(compiled: CompiledProject): EvaluationIndex {
  const existing = indexes.get(compiled);
  if (existing) return existing;
  const states: Record<string, CompiledProject['states'][number][]> =
    Object.create(null);
  const animations: Record<
    string,
    Record<string, ResolvedAnimation[]>
  > = Object.create(null);
  for (const state of compiled.states)
    (states[state.sourceClipId] ??= []).push(state);
  for (const animation of compiled.choreography.generatedAnimations)
    if (animation.primitiveId) {
      const primitives = (animations[animation.sourceClipId] ??= Object.create(
        null,
      ) as Record<string, ResolvedAnimation[]>);
      (primitives[animation.primitiveId] ??= []).push(animation);
    }
  for (const list of Object.values(states)) Object.freeze(list);
  for (const primitives of Object.values(animations)) {
    for (const list of Object.values(primitives)) Object.freeze(list);
    Object.freeze(primitives);
  }
  const index = Object.freeze({
    statesByClipId: Object.freeze(states),
    primitiveAnimationsByClipId: Object.freeze(animations),
  });
  indexes.set(compiled, index);
  return index;
}
