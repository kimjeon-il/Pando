import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../../playwright.config.js';

const baseURL = process.env.PANDO_PUBLIC_URL;
if (!baseURL) throw new Error('PANDO_PUBLIC_URL must name the deployed site');
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'public-viewer-boot.spec.mjs', workers: 1, retries: 0, fullyParallel: false,
  timeout: 150_000, expect: base.expect, reporter: base.reporter,
  outputDir: fileURLToPath(new URL('../../test-results/public-viewer', import.meta.url)),
  use: { ...base.use, baseURL, viewport: { width: 1280, height: 800 },
    locale: 'ko-KR', timezoneId: 'Asia/Seoul' },
});

