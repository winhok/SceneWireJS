export const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function differences(
  a: unknown,
  b: unknown,
  path = '',
): { path: string; before: unknown; after: unknown }[] {
  if (equal(a, b)) return [];
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const aa = a as Record<string, unknown>,
      bb = b as Record<string, unknown>;
    return [...new Set([...Object.keys(aa), ...Object.keys(bb)])]
      .sort()
      .flatMap((k) => differences(aa[k], bb[k], path ? `${path}.${k}` : k));
  }
  return [{ path: path || '$', before: a ?? null, after: b ?? null }];
}
