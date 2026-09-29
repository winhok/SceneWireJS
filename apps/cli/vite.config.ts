import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    outDir: 'dist',
    rolldownOptions: {
      external: [/^node:/, /^vite$/, /^playwright$/, /^@scenewire\//],
      output: { entryFileNames: 'scenewire.js', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { external: true },
});
