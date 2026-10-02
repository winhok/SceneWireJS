import type {
  FrameContext,
  FrameDiagnostic,
  JsonSerializableValue,
  ResolvedFrameDiagnostic,
} from '@scenewirejs/renderer-core';
/** Stable JSON identity; reject values that cannot cross the runtime/report boundary. */
export function stableDiagnosticValue(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return '[' + value.map(stableDiagnosticValue).join(',') + ']';
  if (
    typeof value === 'object' &&
    value &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ':' +
            stableDiagnosticValue((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  throw Error('Frame diagnostic metadata must be finite JSON values');
}
/** Bind provenance after checking author supplied facts. Author frame/provenance fields are ignored. */
export function resolveFrameDiagnostics(
  diagnostics: readonly FrameDiagnostic[],
  context: FrameContext,
  composition: string,
  engine?: string,
): ResolvedFrameDiagnostic[] {
  if (!Array.isArray(diagnostics))
    throw Error('Frame validator must return an array');
  return diagnostics.map((d) => {
    if (
      !d ||
      typeof d.id !== 'string' ||
      !d.id.trim() ||
      typeof d.message !== 'string' ||
      !['info', 'warning', 'error'].includes(d.severity) ||
      (d.source !== undefined && typeof d.source !== 'string')
    )
      throw Error('Invalid frame diagnostic');
    if (
      d.metadata !== undefined &&
      (!d.metadata ||
        Array.isArray(d.metadata) ||
        typeof d.metadata !== 'object')
    )
      throw Error('Frame diagnostic metadata must be an object');
    return {
      id: d.id,
      severity: d.severity,
      message: d.message,
      ...(d.source === undefined ? {} : { source: d.source }),
      ...(d.metadata === undefined
        ? {}
        : {
            metadata: JSON.parse(stableDiagnosticValue(d.metadata)) as Record<
              string,
              JsonSerializableValue
            >,
          }),
      frame: context.frame,
      composition,
      ...(engine === undefined ? {} : { engine }),
    };
  });
}

export interface FrameDiagnosticRange extends Omit<
  ResolvedFrameDiagnostic,
  'frame'
> {
  frameStart: number;
  frameEnd: number;
}
/** Collapse only consecutive identical facts; retain exact canonical frame boundaries. */
export function aggregateFrameDiagnostics(
  facts: readonly ResolvedFrameDiagnostic[],
): FrameDiagnosticRange[] {
  const groups = new Map<string, FrameDiagnosticRange[]>();
  for (const { frame, ...fact } of [...facts].sort(
    (a, b) => a.frame - b.frame,
  )) {
    const key = stableDiagnosticValue(
      Object.fromEntries(
        Object.entries(fact).filter(([, v]) => v !== undefined),
      ),
    );
    const ranges = groups.get(key) ?? [];
    const last = ranges.at(-1);
    if (last && frame === last.frameEnd) continue;
    if (last && frame === last.frameEnd + 1) last.frameEnd = frame;
    else ranges.push({ ...fact, frameStart: frame, frameEnd: frame });
    groups.set(key, ranges);
  }
  return [...groups.values()]
    .flat()
    .sort(
      (a, b) =>
        a.frameStart - b.frameStart ||
        stableDiagnosticValue(
          Object.fromEntries(
            Object.entries(a).filter(([, v]) => v !== undefined),
          ),
        ).localeCompare(
          stableDiagnosticValue(
            Object.fromEntries(
              Object.entries(b).filter(([, v]) => v !== undefined),
            ),
          ),
        ),
    );
}
