import {
  createProducerSourceIdentity,
  producerModuleClosure,
} from './src/production-source-identity.ts';
import { defineConfig } from 'vite';
import ts from 'typescript';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const cliDirectory = dirname(fileURLToPath(import.meta.url));
const skills = [
  'scenewire',
  'scenewire-create',
  'scenewire-direct',
  'scenewire-edit',
  'scenewire-review',
  'scenewire-reference',
  'scenewire-footage',
];
export default defineConfig({
  plugins: [
    {
      name: 'actual-media-producer-identities',
      enforce: 'pre',
      resolveId(source, importer) {
        if (
          /(?:^|\/)production-media(?:\.ts)?$/.test(source) &&
          importer?.endsWith('/src/production-build.ts')
        )
          return { id: './production-media.js', external: true };
      },
      async generateBundle() {
        const transpile = (source: string) =>
          ts.transpileModule(source, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
              verbatimModuleSyntax: false,
            },
          }).outputText;
        const source = readFileSync(
          resolve(cliDirectory, 'src/production-media.ts'),
          'utf8',
        );
        const code = transpile(source).replace(
          /(['"])\.\.\/\.\.\/\.\.\/packages\/(renderer-web|production-core)\/src\/([^'"]+)\1/g,
          (_, quote, pkg, path) =>
            `${quote}./internal/${pkg}/${path}.js${quote}`,
        );
        for (const [pkg, entries] of [
          [
            'renderer-web',
            [
              'export/chunk.ts',
              'export/audio.ts',
              'export/encoder.ts',
              'export/validation.ts',
            ],
          ],
          ['production-core', ['incremental/digest.ts']],
        ] as const) {
          const root = resolve(cliDirectory, '../../packages', pkg, 'src');
          const closure = await producerModuleClosure(root, entries);
          for (const [path] of closure.modules) {
            const output = transpile(
              readFileSync(resolve(root, path), 'utf8'),
            ).replace(
              /((?:from\s*|import\s*\(\s*|import\s*)['"])(\.[^'"]+)(['"])/g,
              (_, before, specifier, after) =>
                before +
                (/\.[cm]?js$/.test(specifier) ? specifier : specifier + '.js') +
                after,
            );
            this.emitFile({
              type: 'asset',
              fileName: `internal/${pkg}/${path.replace(/\.tsx?$/, '.js')}`,
              source: output,
            });
          }
        }
        this.emitFile({
          type: 'asset',
          fileName: 'production-media.js',
          source: code,
        });
        this.emitFile({
          type: 'asset',
          fileName: 'production-media.identity.json',
          source: JSON.stringify(createProducerSourceIdentity(code)) + '\n',
        });
      },
    },
    {
      name: 'owned-skills',
      closeBundle() {
        mkdirSync(resolve('dist/skills'), { recursive: true });
        for (const skill of skills) {
          cpSync(
            resolve('../../.agents/skills', skill),
            resolve('dist/skills', skill),
            { recursive: true },
          );
          const entry = resolve('dist/skills', skill, 'SKILL.md');
          writeFileSync(
            entry,
            readFileSync(entry, 'utf8').replaceAll(
              '../../../docs/engine-authoring.md',
              'https://github.com/winhok/SceneWireJS/blob/main/docs/engine-authoring.md',
            ),
          );
        }
      },
    },
  ],
  build: {
    ssr: 'src/index.ts',
    ssrEmitAssets: true,
    outDir: 'dist',
    rolldownOptions: {
      external: [/^node:/, /^vite$/, /^playwright$/, /^@scenewirejs\//],
      output: { entryFileNames: 'scenewire.js', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { external: true },
});
