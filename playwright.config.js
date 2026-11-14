import {defineConfig} from '@playwright/test';
const external=process.env.PANDO_PUBLIC_URL||process.env.PANDOLAB_TEST_BASE_URL;
const baseURL=external||`http://127.0.0.1:${Number(process.env.PANDOLAB_TEST_PORT||4187)}`;
export default defineConfig({
  testDir:'./tests/browser',testMatch:'viewer.spec.mjs',fullyParallel:false,workers:1,
  timeout:120_000,expect:{timeout:15_000},reporter:[['list']],
  use:{baseURL,browserName:'chromium',channel:process.env.PANDOLAB_BROWSER_CHANNEL||undefined,
    launchOptions:{executablePath:process.env.PANDOLAB_BROWSER_EXECUTABLE||undefined,
      args:process.platform==='win32'?['--use-angle=d3d11']:[]},
    trace:'off',screenshot:'off'},
  webServer:external?undefined:{command:`"${process.execPath}" tests/browser/server.mjs`,url:baseURL,
    reuseExistingServer:false,timeout:120_000},
});
