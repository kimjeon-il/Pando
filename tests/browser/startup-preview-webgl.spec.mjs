import {gotoEditor} from './helpers/editor-entry.mjs';
import {expect,test} from '@playwright/test';

test.use({trace:'off',launchOptions:{args:process.platform==='win32'?['--use-angle=d3d11']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']}});

test('WebGL editor startup remains editable without terrain or eager background data',async({page})=>{
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await gotoEditor(page,'/?renderer=webgl2&debug=1',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#app')).toHaveAttribute('data-readiness',/editable|enhanced/,{timeout:90000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_GPU_METRICS__?.renderer)).toBe('webgl2');
  await page.locator('#mapDisplayBtn').click();
  await expect(page.locator('[data-map-display-group="terrain"]')).toHaveCount(0);
  expect(requests.filter(path=>/\/(?:terrain|terrain-preview|hydro|places)\//.test(path))).toEqual([]);
  expect(errors).toEqual([]);
});
