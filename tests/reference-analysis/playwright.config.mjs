import { fileURLToPath } from 'node:url';
import base from '../../playwright.config.js';

export default { ...base, testDir: '.', outputDir: '../../test-results/reference-analysis',
  webServer: { ...base.webServer, cwd: fileURLToPath(new URL('../../', import.meta.url)) } };
