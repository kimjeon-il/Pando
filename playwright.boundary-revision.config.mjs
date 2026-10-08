import { isAbsolute } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { defineConfig } from '@playwright/test';
import normal from './playwright.config.js';

if (process.env.PANDOLAB_BOUNDARY_REVISION_COMPARISON !== '1') {
  throw new Error('PANDOLAB_BOUNDARY_REVISION_COMPARISON must be exactly 1');
}
for (const key of ['PANDOLAB_BOUNDARY_PRODUCT_ROOT', 'PANDOLAB_BOUNDARY_TIMINGS_PATH']) {
  if (!process.env[key] || !isAbsolute(process.env[key])) throw new Error(`${key} must be an explicit absolute path`);
}

export default defineConfig({
  ...normal,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  metadata: { ...normal.metadata, boundaryRevisionComparison: true },
  use: { ...normal.use, trace: 'off' },
  webServer: {
    ...normal.webServer,
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(fileURLToPath(new URL('./tests/browser/server.mjs', import.meta.url)))}`,
    cwd: process.env.PANDOLAB_BOUNDARY_PRODUCT_ROOT,
    reuseExistingServer: false,
  },
});
