import { env } from 'node:process';
import { defineConfig } from '@playwright/test';
import normal from './playwright.config.js';

const screenshots = env.PANDOLAB_BOUNDARY_CAPTURE_SCREENSHOTS;
if (screenshots !== 'true' && screenshots !== 'false') {
  throw new Error('PANDOLAB_BOUNDARY_CAPTURE_SCREENSHOTS must be exactly true or false');
}

export default defineConfig({
  ...normal,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  use: {
    ...normal.use,
    // Keep passing DOM, source and attachment evidence in both arms.
    trace: { mode: 'on', screenshots: screenshots === 'true', snapshots: true, sources: true, attachments: true },
  },
  webServer: {
    ...normal.webServer,
    // Each Playwright process must launch and tear down its own server.
    // A leaked/occupied port fails visibly instead of reusing another arm.
    reuseExistingServer: false,
  },
});
