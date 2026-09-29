import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
export async function filesIn(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (['node_modules', 'dist'].includes(entry.name)) continue;
    if (entry.isSymbolicLink())
      throw Error('Composition source symlinks are unsupported');
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await filesIn(path)));
    else result.push(path);
  }
  return result.sort();
}
