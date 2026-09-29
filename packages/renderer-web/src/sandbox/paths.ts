import { realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
export async function localPath(
  root: string,
  reference: string,
): Promise<string> {
  if (
    /[\\:?#%\x00-\x1f]/.test(reference) ||
    reference.startsWith('/') ||
    reference.split('/').some((part) => part === '..' || !part)
  )
    throw Error('Invalid local reference');
  const base = await realpath(root),
    path = await realpath(resolve(base, reference));
  if (relative(base, path).startsWith('..'))
    throw Error('Asset escapes project root');
  return path;
}
