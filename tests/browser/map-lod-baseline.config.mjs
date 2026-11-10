import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config.js';

export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('./rendering', import.meta.url)),
  testMatch: 'map-lod-baseline.benchmark.mjs',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  outputDir: fileURLToPath(new URL('../../test-results/map-lod-p0', import.meta.url)),
  use: { ...base.use, trace: 'off', screenshot: 'off' },
});
