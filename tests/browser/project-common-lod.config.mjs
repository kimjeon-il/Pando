import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config.js';

export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('./rendering', import.meta.url)),
  testMatch: 'project-common-lod.spec.mjs',
  workers: 1, retries: 0, fullyParallel: false,
  outputDir: fileURLToPath(new URL('../../test-results/project-common-lod', import.meta.url)),
  webServer: { ...base.webServer, cwd: fileURLToPath(new URL('../../', import.meta.url)) },
  use: { ...base.use, trace: 'off', screenshot: 'only-on-failure' },
});
