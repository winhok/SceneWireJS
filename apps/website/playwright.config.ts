import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173/SceneWireJS/',
    headless: true,
    launchOptions: process.env.SCENEWIRE_CHROMIUM_PATH
      ? { executablePath: process.env.SCENEWIRE_CHROMIUM_PATH }
      : undefined,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        reducedMotion: 'reduce',
      },
    },
  ],
  webServer: {
    command:
      '../../node_modules/.bin/vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/SceneWireJS/',
    reuseExistingServer: false,
  },
});
