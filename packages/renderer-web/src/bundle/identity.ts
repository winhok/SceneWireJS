import { createHash } from 'node:crypto';
import type { CompositionManifest } from '@scenewirejs/schema';
import type { CompositionInitContext } from '@scenewirejs/web-runtime';
export type InstanceInit = Omit<
  CompositionInitContext,
  'registerAdapter' | 'ready' | 'random'
>;
export interface SourceIdentity {
  manifest: CompositionManifest;
  engine: string;
  lock: string;
  sources: readonly (readonly [string, string])[];
  runtime: readonly (readonly [string, string])[];
}
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Only immutable build inputs belong here; instance dimensions/parameters never do. */
export function sourceHash(input: SourceIdentity): string {
  const ordered = (files: SourceIdentity['sources']) =>
    [...files].sort(([a], [b]) => a.localeCompare(b, 'en'));
  return digest({
    ...input,
    sources: ordered(input.sources),
    runtime: ordered(input.runtime),
  });
}
export function instanceHash(source: string, init: InstanceInit): string {
  return digest({
    source,
    ...init,
    parameters: Object.fromEntries(
      Object.entries(init.parameters).sort(([a], [b]) =>
        a.localeCompare(b, 'en'),
      ),
    ),
  });
}
