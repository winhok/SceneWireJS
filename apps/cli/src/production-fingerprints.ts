import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  createProducerSourceIdentity,
  producerModuleClosure,
} from './production-source-identity';
export {
  createProducerSourceIdentity,
  producerImplementation,
  producerModuleClosure,
} from './production-source-identity';
import {
  dependencyIdentity,
  resolvedPackage,
} from '../../../packages/renderer-web/src/bundle/dependencies';
import { run } from '../../../packages/media-inspect/src/process';

export interface ActualProducerFingerprint {
  id: string;
  version: string;
}
export interface ActualProducerFingerprints {
  rasterProducer: ActualProducerFingerprint;
  audioProducer: ActualProducerFingerprint;
  finalProducer: ActualProducerFingerprint;
}
async function exists(path: string) {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** Source uses source bytes; registry-only installs use shipped dist bytes. No path enters identity. */
export async function actualProducerFingerprints(
  cliRoot: string,
): Promise<ActualProducerFingerprints> {
  cliRoot = resolve(cliRoot);
  const resolver = createRequire(join(cliRoot, 'package.json'));
  const renderer = await resolvedPackage(resolver, '@scenewirejs/renderer-web');
  const sourceMode = await exists(join(cliRoot, 'src/production-media.ts'));
  const moduleRoot = join(renderer.root, sourceMode ? 'src' : 'dist');
  const extension = sourceMode ? '.ts' : '.js';
  const actualCli = await readFile(join(cliRoot, 'dist/scenewire.js'), 'utf8');
  if (!/\bfrom\s*['"]\.\/production-media\.js['"]/.test(actualCli))
    throw Error(
      'Actual CLI is not bound to the independent media producer module',
    );
  const actualHost = await readFile(
    join(cliRoot, 'dist/production-media.js'),
    'utf8',
  );
  const hostIdentity = createProducerSourceIdentity(actualHost);
  const frozen: Record<string, string> = JSON.parse(
    await readFile(
      join(cliRoot, 'dist/production-media.identity.json'),
      'utf8',
    ),
  );
  for (const kind of ['render-range-raster', 'audio-mix', 'final-media'])
    if (frozen[kind] !== hostIdentity[kind])
      throw Error('Actual media producer does not match frozen identity');
  const authoredIdentity = sourceMode
    ? createProducerSourceIdentity(
        await readFile(join(cliRoot, 'src/production-media.ts'), 'utf8'),
      )
    : undefined;
  const ffmpeg = (
    await run('ffmpeg', ['-version'], { timeoutMs: 10000, maxBytes: 65536 })
  ).stdout
    .toString('utf8')
    .trim();
  for (const kind of ['render-range-raster', 'audio-mix', 'final-media'])
    if (!/^[a-f0-9]{64}$/.test(hostIdentity[kind] ?? ''))
      throw Error('Invalid frozen media producer identity');
  async function fingerprint(kind: string, entries: string[]) {
    const privateEntries =
      kind === 'audio-mix' ? ['audio'] : ['chunk', 'validation'];
    const privateClosure = await producerModuleClosure(join(cliRoot, 'dist'), [
      ...privateEntries.map(
        (entry) => `internal/renderer-web/export/${entry}.js`,
      ),
      'internal/production-core/incremental/digest.js',
    ]);
    const closure = await producerModuleClosure(
      moduleRoot,
      entries.map((entry) => entry + extension),
    );
    // Node executes package exports from dist even when the authoring CLI source exists.
    const executed = sourceMode
      ? await producerModuleClosure(
          join(renderer.root, 'dist'),
          entries.map((entry) => entry + '.js'),
        )
      : closure;
    const dependencies = await dependencyIdentity(
      cliRoot,
      [
        ...new Set([
          '@scenewirejs/renderer-core',
          '@scenewirejs/production-core',
          ...closure.dependencies,
          ...executed.dependencies,
          ...privateClosure.dependencies,
        ]),
      ]
        .filter((id) => id !== '@scenewirejs/renderer-web')
        .sort(),
    );
    const version = createHash('sha256')
      .update(
        JSON.stringify({
          contract: 'actual-media-producer-v1',
          kind,
          modules: closure.modules,
          executedModules: executed.modules,
          executedPrivateModules: privateClosure.modules,
          dependencies,
          ffmpeg,
          implementation: hostIdentity[kind],
          authoredImplementation: authoredIdentity?.[kind],
        }),
      )
      .digest('hex');
    return { id: `scenewire/${kind}`, version };
  }
  return {
    rasterProducer: await fingerprint('render-range-raster', [
      'session/session',
      'host',
      'browser',
      'export/chunk',
      'export/validation',
    ]),
    audioProducer: await fingerprint('audio-mix', ['export/audio']),
    finalProducer: await fingerprint('final-media', [
      'export/chunk',
      'export/validation',
    ]),
  };
}
