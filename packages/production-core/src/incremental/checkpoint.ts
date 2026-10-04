import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { assertDigest, canonicalJson } from './digest';
import { ArtifactStore, writeAtomic } from './store';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z
  .object({
    id: z.string().min(1),
    digest,
    dependencyDigests: z.record(z.string(), digest),
  })
  .strict();
const checkpointSchema = z
  .object({
    version: z.literal(1),
    inputDigest: digest,
    completed: z.array(entrySchema),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.completed.map((entry) => entry.id)).size ===
      value.completed.length,
    'Duplicate completed artifact',
  );
export type Checkpoint = z.infer<typeof checkpointSchema>;
export async function saveCheckpoint(
  path: string,
  value: Checkpoint,
): Promise<void> {
  await writeAtomic(
    path,
    Buffer.from(canonicalJson(checkpointSchema.parse(value))),
  );
}
const expectedSchema = z.record(
  z.string().min(1),
  entrySchema.omit({ id: true }),
);
export type ExpectedArtifacts = z.infer<typeof expectedSchema>;
/** Reuse requires the complete current per-artifact recipe, not a stored subset. */
export async function resumeCheckpoint(
  path: string,
  inputDigest: string,
  expectedArtifacts: ExpectedArtifacts,
  store: ArtifactStore,
): Promise<Checkpoint['completed']> {
  assertDigest(inputDigest);
  const expected = expectedSchema.parse(expectedArtifacts);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return [];
    throw error;
  }
  const checkpoint = checkpointSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (checkpoint.inputDigest !== inputDigest) return [];
  const reusable: Checkpoint['completed'] = [];
  for (const entry of checkpoint.completed) {
    const candidate = Object.hasOwn(expected, entry.id)
      ? expected[entry.id]
      : undefined;
    if (
      candidate &&
      candidate.digest === entry.digest &&
      Object.keys(candidate.dependencyDigests).length ===
        Object.keys(entry.dependencyDigests).length &&
      Object.entries(entry.dependencyDigests).every(
        ([id, digest]) =>
          Object.hasOwn(candidate.dependencyDigests, id) &&
          candidate.dependencyDigests[id] === digest,
      ) &&
      (await store.get(entry.digest))
    )
      reusable.push(entry);
  }
  return reusable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
