import { mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { builtinModules } from 'node:module';
import { build } from 'vite';
export async function bundle(
  entry: string,
  code: string,
  root: string,
  compositionRoot?: string,
  runtimeRoots: readonly string[] = [],
  browserRuntime?: string,
): Promise<Map<string, Buffer>> {
  const temporary = await mkdtemp(join(tmpdir(), 'scenewire-bundle-'));
  await writeFile(join(temporary, 'entry.ts'), code);
  const input = await realpath(join(temporary, 'entry.ts'));
  root = await realpath(root);
  try {
    const result = await build({
      configFile: false,
      root,
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      logLevel: 'silent',
      publicDir: false,
      plugins: [
        {
          name: 'scenewire-entry',
          async resolveId(id, importer) {
            if (id.startsWith('node:') || builtinModules.includes(id))
              throw Error('Node APIs are unavailable');
            if (
              compositionRoot &&
              (importer === input ||
                (importer &&
                  !relative(compositionRoot, importer).startsWith('..'))) &&
              !id.startsWith('.') &&
              !id.startsWith('/')
            )
              return this.resolve(id, join(root, 'package.json'), {
                skipSelf: true,
              });
          },
          async load(id) {
            if (
              compositionRoot &&
              id.startsWith('/') &&
              !id.includes('/node_modules/')
            ) {
              const path = await realpath(id.split('?')[0]!);
              const allowed = [compositionRoot, ...runtimeRoots.slice(1)];
              if (
                path !== input &&
                path !== browserRuntime &&
                !allowed.some((base) => !relative(base, path).startsWith('..'))
              )
                throw Error('Composition import escapes its source directory');
            }
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        cssCodeSplit: false,
        assetsInlineLimit: 0,
        lib: {
          entry: input,
          name: 'SceneWireBundle',
          formats: ['iife'],
          fileName: () => entry,
        },
        rolldownOptions: { output: { assetFileNames: '[name][extname]' } },
      },
    });
    const files = new Map<string, Buffer>();
    for (const output of Array.isArray(result) ? result : [result])
      if ('output' in output)
        for (const item of output.output)
          files.set(
            item.fileName,
            Buffer.from(item.type === 'chunk' ? item.code : item.source),
          );
    return files;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
