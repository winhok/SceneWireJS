/** Accept data only: never evaluate getters or silently discard non-JSON values. */
export function isSafeJSON(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): boolean {
  if (depth > 100) return false;
  if (value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const array = Array.isArray(value),
    prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    return false;
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) return false;
  ancestors.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (
      typeof key !== 'string' ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      (array && !/^(0|[1-9][0-9]*)$/.test(key))
    )
      return false;
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      !d.enumerable ||
      d.get ||
      d.set ||
      !isSafeJSON(d.value, ancestors, depth + 1)
    )
      return false;
  }
  ancestors.delete(value);
  return true;
}
