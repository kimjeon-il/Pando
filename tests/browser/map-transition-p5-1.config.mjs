import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import base from '../../playwright.config.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
export default defineConfig({...base,webServer:{...base.webServer,cwd:root},
  testDir:fileURLToPath(new URL('.',import.meta.url)),
  testMatch:'map-transition-p5-1.benchmark.mjs',
  workers:1,retries:0,fullyParallel:false,
  outputDir:fileURLToPath(new URL('../../test-results/map-transition-p5-1',import.meta.url)),
  use:{...base.use,trace:'off'}});
