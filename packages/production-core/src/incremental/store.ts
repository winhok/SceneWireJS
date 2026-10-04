import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  open,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertDigest, bytesDigest } from './digest';
function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
/** Atomic visibility within one filesystem; does not promise power-loss durability. */
export async function writeAtomic(
  path: string,
  bytes: Uint8Array,
  expectedDigest = bytesDigest(bytes),
): Promise<void> {
  const snapshot = Buffer.from(bytes);
  assertDigest(expectedDigest);
  if (bytesDigest(snapshot) !== expectedDigest)
    throw new Error('Atomic write digest mismatch');
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, snapshot, { flag: 'wx' });
    const handle = await open(temp, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (bytesDigest(await readFile(temp)) !== expectedDigest)
      throw new Error('Written artifact digest mismatch');
    await rename(temp, path);
  } finally {
    try {
      await unlink(temp);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}
export class ArtifactStore {
  constructor(private readonly root: string) {}
  path(digest: string): string {
    assertDigest(digest);
    return join(this.root, digest);
  }
  async get(digest: string): Promise<Buffer | undefined> {
    try {
      const bytes = await readFile(this.path(digest));
      return bytesDigest(bytes) === digest ? bytes : undefined;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }
  async put(bytes: Uint8Array): Promise<string> {
    // Snapshot caller memory before awaiting filesystem operations.
    const snapshot = Buffer.from(bytes);
    const digest = bytesDigest(snapshot);
    if (!(await this.get(digest)))
      await writeAtomic(this.path(digest), snapshot, digest);
    return digest;
  }
}
