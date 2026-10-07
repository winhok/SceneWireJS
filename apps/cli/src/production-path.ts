import { localProjectReferenceSchema } from '@scenewirejs/schema';
import { relativePathSchema } from '@scenewirejs/production-core';

/** Bridge authored local references into the stricter retained-file boundary. */
export function canonicalLocalReference(value: string): string {
  const validated = localProjectReferenceSchema.parse(value);
  return relativePathSchema.parse(
    validated
      .split('/')
      .filter((segment) => segment !== '.')
      .join('/'),
  );
}

/** Preserve every source byte except the spelling of the top-level entry string. */
export function canonicalCompositionBytes(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes).toString('utf8');
  const value = JSON.parse(text) as { entry: string };
  const entry = canonicalLocalReference(value.entry);
  let depth = 0;
  const replacements = new Map<number, string>();
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]]/g;
  return Buffer.from(
    text.replace(tokens, (token, offset: number) => {
      if (token === '{' || token === '[') depth++;
      else if (token === '}' || token === ']') depth--;
      else if (depth === 1 && JSON.parse(token) === 'entry') {
        const suffix = text.slice(offset + token.length);
        const match = /^(\s*:\s*)("(?:\\.|[^"\\])*")/.exec(suffix);
        if (match && JSON.parse(match[2]!) === value.entry) {
          // The value token is replaced below; keys and whitespace stay byte-identical.
          replacements.set(
            offset + token.length + match[1]!.length,
            JSON.stringify(entry),
          );
        }
      }
      return replacements.get(offset) ?? token;
    }),
  );
}
