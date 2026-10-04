import { createHash } from 'node:crypto';

/** Internal v1 canonical finite-JSON encoding; no coercion or toJSON hooks. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>();
  function encode(value: unknown): string {
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'string'
    )
      return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value))
      return JSON.stringify(value);
    if (typeof value !== 'object' || value === null)
      throw new Error('Expected finite JSON');
    if (active.has(value)) throw new Error('Cyclic JSON');
    active.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (Array.isArray(value)) {
        if (
          keys.length !== value.length + 1 ||
          keys.some(
            (key) =>
              typeof key !== 'string' ||
              (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)),
          )
        )
          throw new Error('Expected dense JSON array');
        return (
          '[' +
          Array.from({ length: value.length }, (_, i) =>
            encodeData(value, String(i)),
          ).join(',') +
          ']'
        );
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null)
        throw new Error('Expected plain JSON object');
      if (keys.some((key) => typeof key !== 'string'))
        throw new Error('Symbol JSON key');
      return (
        '{' +
        (keys as string[])
          .sort()
          .map((key) => JSON.stringify(key) + ':' + encodeData(value, key))
          .join(',') +
        '}'
      );
    } finally {
      active.delete(value);
    }
  }
  function encodeData(value: object, key: string): string {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      throw new Error('Expected enumerable JSON data property');
    return encode(descriptor.value);
  }
  return encode(value);
}
export function bytesDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function assertDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid SHA-256 digest');
}
export function canonicalDigest(domain: string, value: unknown): string {
  if (!domain.trim()) throw new Error('Empty hashing domain');
  return bytesDigest(
    Buffer.from(
      canonicalJson({ protocol: 'scenewire-canonical-v1', domain, value }),
    ),
  );
}
