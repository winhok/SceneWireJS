import { parse } from 'acorn';
import { posix, extname } from 'node:path';
import { mime } from './sandbox/mime';
/** Resolve supported bundled literals/HTML attributes/CSS URLs against their own resource. */
export function portableAssets(
  code: string,
  base: string,
  origin: string,
  resources: ReadonlyMap<string, Buffer>,
  syntax: 'text' | 'javascript' = 'text',
): string {
  const resolve = (ref: string): string => {
    if (/^(?:data:|blob:|#)/i.test(ref)) return ref;
    let url: URL;
    try {
      url = new URL(ref, origin + base);
    } catch {
      return ref;
    }
    if (url.origin !== origin) return ref;
    const bytes = resources.get(url.pathname);
    if (!bytes || /\.(?:js|html|css)$/.test(url.pathname)) return ref;
    return `data:${mime[extname(url.pathname)] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
  };
  const inlineText = (text: string): string => {
    text = text.replace(
      /\b(src|href)=(['"])([^'"]+)\2/g,
      (_, name: string, q: string, ref: string) =>
        `${name}=${q}${resolve(ref)}${q}`,
    );
    return text.replace(
      /url\(\s*(['"]?)([^'"()]+)\1\s*\)/g,
      (_, q: string, ref: string) => `url(${q}${resolve(ref.trim())}${q})`,
    );
  };
  if (syntax === 'text')
    return inlineText(code).replace(
      /(['"])([^'"\n]+)\1/g,
      (_, q: string, ref: string) => `${q}${resolve(ref)}${q}`,
    );
  // Parse actual bundled string values, including escaped HTML/CSS attributes.
  // Only literal refs are rewritten; expressions and unrelated strings retain their bytes.
  const replacements: { start: number; end: number; value: string }[] = [];
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown>;
    if (
      node.type === 'Literal' &&
      typeof node.value === 'string' &&
      typeof node.start === 'number' &&
      typeof node.end === 'number'
    ) {
      const resolved = inlineText(resolve(node.value));
      if (resolved !== node.value)
        replacements.push({
          start: node.start,
          end: node.end,
          value: JSON.stringify(resolved),
        });
    }
    if (
      node.type === 'TemplateLiteral' &&
      Array.isArray(node.expressions) &&
      node.expressions.length === 0 &&
      Array.isArray(node.quasis)
    ) {
      const quasi = node.quasis[0] as { value: { cooked: string | null } };
      const text = quasi.value.cooked;
      if (
        text !== null &&
        typeof node.start === 'number' &&
        typeof node.end === 'number'
      ) {
        const resolved = inlineText(resolve(text));
        if (resolved !== text)
          replacements.push({
            start: node.start,
            end: node.end,
            value: JSON.stringify(resolved),
          });
      }
    }
    for (const child of Object.values(node)) visit(child);
  }
  visit(parse(code, { ecmaVersion: 'latest', sourceType: 'script' }));
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    code =
      code.slice(0, replacement.start) +
      replacement.value +
      code.slice(replacement.end);
  return code;
}
export function portableResourcePath(
  ref: string,
  base: string,
  origin: string,
): string {
  const url = new URL(ref, origin + base);
  if (url.origin !== origin)
    throw Error(`Preview resource is not local: ${ref}`);
  return posix.normalize(url.pathname);
}
