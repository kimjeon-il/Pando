import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({testDir:'.',testMatch:'editable-library-ui.spec.mjs',workers:1,timeout:60_000,
 use:{baseURL:'http://127.0.0.1:4193',launchOptions:{executablePath:process.env.PANDOLAB_BROWSER_EXECUTABLE||undefined}},
 webServer:{command:`"${process.execPath}" tests/browser/editable-library-server.mjs`,cwd:fileURLToPath(new URL('../../',import.meta.url)),url:'http://127.0.0.1:4193',reuseExistingServer:true}});
