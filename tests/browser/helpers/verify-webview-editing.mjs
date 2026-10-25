import {readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
import {verifyEditingRecovery} from './editing-state-recovery.mjs';

// Start the test-profile WebView2 App with remote debugging explicitly enabled.
const browser = await chromium.connectOverCDP(process.env.PANDOLAB_WEBVIEW_CDP || 'http://127.0.0.1:9228');
const context = browser.contexts()[0];
const page = context.pages().find(page => page.url().includes('tauri.localhost'));
if (!page) throw new Error('PandoLab WebView2 page not found.');
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:1});
await page.setViewportSize({width:1440,height:900});
const url = new URL(page.url());
url.search = '?debug=1&demTerrain=raster&renderer=webgl2';
try {
  await verifyEditingRecovery(page, {url:url.href, afterBoot: async () => { await page.locator('#shellDiagnostics summary').click(); }, domainSource:readFileSync(new URL('../../../apps/editor/dist/assets/js/modules/app-domain-assembly.js',import.meta.url),'utf8'), tap: async locator => {
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:1});
    await locator.click({trial:true});
    const box = await locator.boundingBox();
    if (!box) throw new Error('Touch target has no layout.');
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1,force:1,radiusX:1,radiusY:1}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  }});
  console.log('WebView2 editing recovery passed: keyboard, text focus, search context, touch collapse, draft return, apply and project Undo/Redo.');
} finally { await browser.close(); }
