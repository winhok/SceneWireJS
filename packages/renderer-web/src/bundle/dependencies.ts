import { createRequire } from 'node:module';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
/** Resolved package bytes and dependency graph, without any package-manager lockfile. */
export async function dependencyIdentity(
  projectRoot: string,
  ids: readonly string[],
): Promise<string> {
  const visited = new Set<string>(),
    records: [string, string][] = [];
  async function visit(
    resolver: ReturnType<typeof createRequire>,
    id: string,
    optional = false,
  ): Promise<void> {
    let resolved;
    try {
      resolved = await resolvedPackage(resolver, id);
    } catch (error) {
      if (optional) return;
      throw error;
    }
    const { root, metadata } = resolved;
    if (visited.has(root)) return;
    visited.add(root);
    const hash = createHash('sha256');
    async function scan(directory: string): Promise<void> {
      for (const file of (
        await readdir(directory, { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        if (
          ['node_modules', '.git', 'coverage', 'tests', 'test'].includes(
            file.name,
          )
        )
          continue;
        const path = join(directory, file.name);
        if (file.isDirectory()) await scan(path);
        else if (
          file.isFile() &&
          /\.(?:m?js|cjs|json|wasm|css|node|png|jpe?g|webp|gif|svg|woff2?|ttf|otf|glsl|wgsl)$/.test(
            file.name,
          )
        )
          hash.update(relative(root, path)).update(await readFile(path));
      }
    }
    await scan(root);
    records.push([`${metadata.name}@${metadata.version}`, hash.digest('hex')]);
    const next = createRequire(join(root, 'package.json'));
    const optionalDependencies = metadata.optionalDependencies ?? {};
    for (const dependency of Object.keys({
      ...metadata.dependencies,
      ...optionalDependencies,
      ...metadata.peerDependencies,
    }).sort())
      if (!dependency.startsWith('@types/'))
        await visit(
          next,
          dependency,
          dependency in optionalDependencies ||
            dependency in (metadata.peerDependencies ?? {}),
        );
  }
  const resolver = createRequire(join(projectRoot, 'package.json'));
  for (const id of ids) await visit(resolver, id);
  return JSON.stringify(records.sort(([a], [b]) => a.localeCompare(b, 'en')));
}

export async function resolvedPackage(
  resolver: ReturnType<typeof createRequire>,
  id: string,
) {
  // A shipped npm package may share a name with a Node builtin (for example punycode).
  const directories =
    resolver.resolve.paths(id) ??
    resolver.resolve.paths('__scenewire_package_metadata__') ??
    [];
  for (const directory of directories) {
    try {
      const root = await realpath(join(directory, id));
      const metadata: {
        name: string;
        version: string;
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        exports?: { '.'?: { import?: string } };
      } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      if (metadata.name) return { root, metadata };
    } catch {
      /* next Node package search directory */
    }
  }
  throw Error(`Missing resolved dependency metadata: ${id}`);
}
/** Include declared authoring dependencies, including non-engine libraries used by composition code. */
export async function consumerDependencyIdentity(
  projectRoot: string,
  engineIds: readonly string[],
): Promise<string> {
  const source = await readFile(
    join(projectRoot, 'package.json'),
    'utf8',
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  });
  const manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  } = JSON.parse(source);
  const ids = [
    ...new Set([
      ...engineIds,
      ...Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
      }),
    ]),
  ]
    .filter((id) => !id.startsWith('@types/'))
    .sort();
  const resolver = createRequire(join(projectRoot, 'package.json'));
  const installed: string[] = [],
    missing: string[] = [];
  for (const id of ids) {
    if (!/^(?:@[a-zA-Z0-9][\w.-]*\/)?[a-zA-Z0-9][\w.-]*$/.test(id))
      throw Error(`Invalid dependency identity: ${id}`);
    try {
      await resolvedPackage(resolver, id);
      installed.push(id);
    } catch {
      missing.push(id);
    }
  }
  return JSON.stringify({
    missing,
    resolved: await dependencyIdentity(projectRoot, installed),
  });
}
