import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createEngineRegistry } from '@scenewirejs/director-core';
export function installedEngineRegistry(workspace = process.cwd()) {
  const resolver = createRequire(join(workspace, 'package.json'));
  const dependencyIds = ['react', 'react-dom', 'pixi.js', 'three'].filter(
    (id) => {
      try {
        resolver.resolve(id);
        return true;
      } catch {
        return false;
      }
    },
  );
  return createEngineRegistry({
    rendererIds: ['canvas', 'web'],
    dependencyIds,
  });
}
