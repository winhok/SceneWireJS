import { defineConfig } from 'vite';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    outDir: 'dist',
    rolldownOptions: {
      external: [/^node:/, /^vite$/, /^playwright$/, /^@scenewirejs\//],
      output: { entryFileNames: 'scenewire.js', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { external: true },
});
