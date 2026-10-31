import {test,expect} from '@playwright/test';
import {gotoEditor} from './helpers/editor-entry.mjs';

test.use({viewport:{width:1280,height:800},trace:'off'});
test('P4-5 actual WebGL border Worker prepares a complete presented country scene',async({page})=>{
  test.setTimeout(110000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    if(message.type()==='error'&&message.text().includes('PL-COUNTRY-BOUNDARY'))
      errors.push(message.text());
  });
  await gotoEditor(page,'/?renderer=webgl2&demTerrain=raster&debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:85000});
  const stats=()=>page.evaluate(()=>window.__PANDOLAB_GPU_METRICS__||{});
  await expect.poll(async()=>(await stats()).countrySharedBoundarySegmentCount||0,
    {timeout:35000}).toBeGreaterThan(100);
  const first=await stats();
  expect(first.renderer).toMatch(/webgl/);
  expect(first.countrySharedBoundaryReady).toBe(true);
  expect(first.countrySharedBoundaryWorkerActive).toBe(true);
  expect(first.countrySharedBoundaryReplacementPending).toBe(false);
  const baseline=first.countrySharedBoundarySegmentCount;
  await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__?.requestRepaint?.('p4-5-boundary-repaint'));
  await expect.poll(async()=>(await stats()).countrySharedBoundarySegmentCount,{timeout:15000})
    .toBe(baseline);
  expect(errors).toEqual([]);
});
