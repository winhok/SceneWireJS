import { resolve, basename } from 'node:path';
import { readAuthoredProduction } from './production-observe';
import { buildProduction } from '../../../packages/production-core/src/production/executor';
import { createMediaProducers, measureMediaRaster } from './production-media';

export async function productionBuildCommand(file: string, args: string[]) {
  let profile: string | undefined,
    state: string | undefined,
    json = false;
  const rest = [...args],
    seen = new Set<string>();
  while (rest.length) {
    const flag = rest.shift()!;
    if (seen.has(flag)) throw new Error(`Duplicate flag: ${flag}`);
    seen.add(flag);
    if (flag === '--json') json = true;
    else if (flag === '--profile' || flag === '--state') {
      const value = rest.shift();
      if (!value || value.startsWith('--'))
        throw new Error(`Missing value: ${flag}`);
      if (flag === '--profile') profile = value;
      else state = value;
    } else throw new Error(`Unexpected argument: ${flag}`);
  }
  if (!profile)
    throw new Error(
      'Usage: scenewire production-build <manifest> --profile <semantic-profile.json> [--state <build-state-directory>] [--json]',
    );
  const authored = await readAuthoredProduction(file, profile);
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const result = await buildProduction({
      productionId: authored.project.id,
      graph: authored.graph,
      stateDirectory: state
        ? resolve(state)
        : resolve(authored.root, '.scenewire/production/build'),
      producers: createMediaProducers({
        project: authored.project,
        projectRoot: authored.root,
        graph: authored.graph,
        sourceFiles: authored.sourceFiles,
        verifyInputs: (root) =>
          readAuthoredProduction(
            resolve(root, basename(file)),
            profile!,
            root === authored.root ? undefined : authored.profileBytes,
          ),
        onInvocation: ({ artifactId, kind }) =>
          process.stderr.write(`EXECUTE ${kind} ${artifactId}\n`),
      }),
      rasterMeasurement: measureMediaRaster,
      mediaExecution: true,
      signal: controller.signal,
      reviews: authored.validatedReviews.map((r) => ({
        artifactId: `scene:${r.sceneId}:review`,
        candidate: r.candidate,
      })),
      onProgress: (id, action) =>
        process.stderr.write(`${action.toUpperCase()} ${id}\n`),
    });
    if (result.outcome === 'blocked') process.exitCode = 1;
    return json
      ? JSON.stringify(result) + '\n'
      : `Production: ${result.production.id}\n${result.outcome.toUpperCase()} reused=${result.artifactsReused} rebuilt=${result.artifactsRebuilt}\n${result.diagnostics.map((d) => `${d.code}: ${d.artifactId}\n`).join('')}`;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
