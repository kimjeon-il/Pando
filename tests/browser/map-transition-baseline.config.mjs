import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import base from '../../playwright.config.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({...base, testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'map-transition-baseline.benchmark.mjs', workers: 1, retries: 0, fullyParallel: false,
  outputDir: fileURLToPath(new URL('../../test-results/map-transition-p0', import.meta.url)),
  webServer: {...base.webServer, cwd: root}, use: {...base.use, trace: 'off'}});
