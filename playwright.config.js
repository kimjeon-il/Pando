import { defineConfig } from '@playwright/test';

const testPort = Number.parseInt(process.env.PANDOLAB_TEST_PORT || '4173', 10);
const testBaseUrl = `http://127.0.0.1:${testPort}`;
const browserChannel = String(process.env.PANDOLAB_BROWSER_CHANNEL || '').trim() || undefined;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: testBaseUrl,
    browserName: 'chromium',
    channel: browserChannel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `${JSON.stringify(process.execPath)} tests/browser/server.mjs`,
    url: testBaseUrl,
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
