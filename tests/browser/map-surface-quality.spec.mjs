import { test, expect } from '@playwright/test';

const stats = page => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu);

for (const renderer of ['webgl2', 'canvas']) {
  test(`${renderer}: high-scale pending surface keeps only land and promotes atomically`, async ({ page }, info) => {
    test.setTimeout(120000);
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    let release; const gate=new Promise(resolve=>{release=resolve;});
    await page.route(/\/(world-mesh-sha256-[a-f0-9]+\.bin|countries-canonical-sha256-[a-f0-9]+\.pcg)\.gz/,async route=>{
      await gate; await route.continue();
    });
    try {
      await page.goto(`/__editor/index.html?debug=1&renderer=${renderer}`,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__PANDOLAB_RENDER_DEBUG__ && window.__PANDOLAB_MAP_HOST__);
      await page.evaluate(()=>{const host=window.__PANDOLAB_MAP_HOST__;
        host.setViewState({projection:'flat',view:{...host.getViewState(),flatCenter:[24.6,38.5],flatZoom:32}});
        host.requestRepaint('surface-quality-regression');});
      await expect.poll(async()=>(await stats(page)).surfacePresentation).toEqual({targetQuality:'canonical',geometryQuality:'pending',quality:'pending'});
      await expect.poll(async()=>(await stats(page)).screenScale).toBeGreaterThan(6000);
      if(renderer==='webgl2')await expect.poll(async()=>(await stats(page)).surfaceDraw)
        .toEqual({quality:'pending',landSource:'physical-background',countryIndexCount:0});
      await expect(page.locator('#mapPreparationStatus')).toContainText('정밀 경계 준비 중');
      await page.screenshot({path:info.outputPath('high-pending.png')});
      release();
      await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
      await expect.poll(async()=>(await stats(page)).surfacePresentation).toEqual({targetQuality:'canonical',geometryQuality:'canonical',quality:'canonical'});
      await expect.poll(async()=>{const s=await stats(page);return s.countriesPublishedGeneration===s.projectGeneration;}).toBe(true);
      if(renderer==='webgl2')await expect.poll(async()=>(await stats(page)).surfaceDraw?.landSource).toBe('physical-canonical');
      await page.screenshot({path:info.outputPath('high-ready.png')});
      await page.evaluate(()=>{const h=window.__PANDOLAB_MAP_HOST__;h.setViewState({projection:'flat',view:{...h.getViewState(),flatZoom:1.5}});h.requestRepaint('surface-low');});
      await expect.poll(async()=>(await stats(page)).surfacePresentation.targetQuality).toBe('preview');
      const low=await stats(page);
      await expect.poll(async()=>(await stats(page)).activeMeshQuality).toBe(low.previewDisplayCertificate?.valid?'preview':'canonical');
      expect(errors).toEqual([]);
    } finally {release();}
  });
}

test('public Web globe uses one precise surface for land and country paint at high scale',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?debug=1',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  await page.evaluate(()=>{const h=window.__PANDOLAB_MAP_HOST__;h.setViewState({projection:'globe',view:{...h.getViewState(),globeRotation:[-24.6,-38.5,0],globeZoom:24}});h.requestRepaint('viewer-surface-quality');});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().surfaceDraw?.landSource)).toBe('physical-canonical');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().activeMeshQuality)).toBe('canonical');
  expect(errors).toEqual([]);
});
