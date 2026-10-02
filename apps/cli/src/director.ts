import { satisfies } from 'semver';
import type { AuthoringDependencyDiagnostic } from '@scenewirejs/director-core';
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
  const authoringDiagnostics: Record<string, AuthoringDependencyDiagnostic> =
    {};
  for (const profile of builtinEngines)
    for (const id of profile.authoringDependencies ?? []) {
      const required = profile.authoringDependencyRanges?.[id];
      const declaration =
        typeof declared[id] === 'string' ? (declared[id] as string) : undefined;
      const diagnostic: AuthoringDependencyDiagnostic = {
        id,
        status: declaration === undefined ? 'missing' : 'unresolvable',
        ...(declaration === undefined ? {} : { declared: declaration }),
        ...(required === undefined ? {} : { required }),
      };
      if (declaration !== undefined)
        try {
          let directory = dirname(resolver.resolve(id));
          while (dirname(directory) !== directory) {
            const path = join(directory, 'package.json');
            if (existsSync(path)) {
              const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
                name?: string;
                version?: string;
              };
              if (pkg.name === id) {
                diagnostic.installed = pkg.version;
                diagnostic.status =
                  typeof pkg.version === 'string' &&
                  (required === undefined || satisfies(pkg.version, required))
                    ? 'complete'
                    : 'incompatible';
                break;
              }
            }
            directory = dirname(directory);
          }
        } catch {
          /* Declared packages that cannot resolve remain unresolvable. */
        }
      authoringDiagnostics[id] = diagnostic;
    }
  return createEngineRegistry({
    authoringDiagnostics,
    rendererIds: ['canvas', 'web'],
    dependencyIds,
    authoringDependencyIds: dependencyIds.filter(
      (id) => authoringDiagnostics[id]?.status === 'complete',
    ),
  });
}
export function humanEngines(engines: EngineCandidate[], manager = 'pnpm') {
  const lines = ['ENGINE       RUNTIME      AUTHORING    MISSING'];
  for (const e of engines) {
    lines.push(
      `${e.id.padEnd(12)} ${e.availability.padEnd(12)} ${e.authoringAvailability.padEnd(12)} ${e.missingAuthoringDependencies.join(' ') || '—'}`,
    );
    for (const diagnostic of e.authoringDiagnostics ?? [])
      if (diagnostic.status !== 'complete')
        lines.push(
          `  ${diagnostic.id}: ${diagnostic.status} (installed ${diagnostic.installed ?? 'unknown'}, required ${diagnostic.required ?? 'direct dependency'})`,
        );
    if (e.missingAuthoringDependencies.length)
      lines.push(
        `  Missing authoring dependencies: ${e.missingAuthoringDependencies.join(' ')}\n  Install with: ${manager} ${manager === 'npm' ? 'install' : 'add'} ${e.missingAuthoringDependencies.join(' ')}`,
      );
  }
  return lines.join('\n') + '\n';
}
