// Requires the existing private Codespaces preview; never start a substitute fixture server.
import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',testMatch:['codespaces-live.spec.mjs'],
  workers:1,retries:0,timeout:180000,expect:{timeout:10000},
  reporter:[['list']],outputDir:'test-results/codespaces-acceptance',
  use:{
    baseURL:'http://127.0.0.1:4173',browserName:'chromium',
    trace:'retain-on-failure',screenshot:'only-on-failure',
    launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']}
  }
});
