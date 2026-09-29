import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import {
  createEngineRegistry,
  builtinEngines,
  type EngineCandidate,
} from '@scenewirejs/director-core';
export function projectPackageRoot(workspace = process.cwd()) {
  let root = workspace;
  while (!existsSync(join(root, 'package.json')) && dirname(root) !== root)
    root = dirname(root);
  return existsSync(join(root, 'package.json')) ? root : workspace;
}
export function installedEngineRegistry(workspace = process.cwd()) {
  const root = projectPackageRoot(workspace);
  const resolver = createRequire(join(root, 'package.json'));
  const ids = [
    ...new Set(
      builtinEngines.flatMap((e) => [
        ...(e.dependencies ?? []),
        ...(e.authoringDependencies ?? []),
      ]),
    ),
  ];
  const dependencyIds = ids.filter((id) => {
    try {
      resolver.resolve(id);
      return true;
    } catch {
      return false;
    }
  });
  let declared: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    declared = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    /* No package means no declared authoring dependencies. */
  }
  return createEngineRegistry({
    rendererIds: ['canvas', 'web'],
    dependencyIds,
    authoringDependencyIds: dependencyIds.filter((id) =>
      Object.hasOwn(declared, id),
    ),
  });
}
export function humanEngines(engines: EngineCandidate[], manager = 'pnpm') {
  const lines = ['ENGINE       RUNTIME      AUTHORING    MISSING'];
  for (const e of engines) {
    lines.push(
      `${e.id.padEnd(12)} ${e.availability.padEnd(12)} ${e.authoringAvailability.padEnd(12)} ${e.missingAuthoringDependencies.join(' ') || '—'}`,
    );
    if (e.missingAuthoringDependencies.length)
      lines.push(
        `  Missing authoring dependencies: ${e.missingAuthoringDependencies.join(' ')}\n  Install with: ${manager} ${manager === 'npm' ? 'install' : 'add'} ${e.missingAuthoringDependencies.join(' ')}`,
      );
  }
  return lines.join('\n') + '\n';
}
