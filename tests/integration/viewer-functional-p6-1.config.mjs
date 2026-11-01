import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config.js';

// This acceptance scenario has an explicit, focused CI entry point.
export default defineConfig({
  ...base,
  webServer: {
    ...base.webServer,
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    reuseExistingServer: !process.env.CI,
  },
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'viewer-functional-p6-1.spec.mjs',
  workers: 1, retries: 0, fullyParallel: false,
  outputDir: fileURLToPath(new URL('../../test-results/viewer-functional-p6-1', import.meta.url)),
  use: { ...base.use, trace: 'off' },
});
