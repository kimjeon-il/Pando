import { expect } from '@playwright/test';

export async function navigateViewerStartup(page, { cold }) {
  if (cold) await page.goto('/?debug=1&renderer=webgl2', { waitUntil: 'domcontentloaded' });
  else await page.reload({ waitUntil: 'domcontentloaded' });
}

// Shared acceptance boundaries for the shipped Viewer. Clock and renderer selection
// always stay with the caller, so a test can still hold external data or GPU work.
export async function openReadyViewer(page,{url='/?debug=1',timeout=90_000}={}){
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout});
}
export async function waitForCommittedMonth(page,month,{timeout=90_000}={}){
  await expect.poll(()=>page.evaluate(()=>{
    const api=window.__PANDOLAB_VIEWER__;
    return {month:api?.builtinMonth?.()?.month,cursor:api?.documentState?.()?.timelineCursor,
      ready:document.getElementById('viewerStatus')?.dataset.ready};
  }),{timeout}).toEqual({month,cursor:month,ready:'true'});
}
export async function waitForCanonicalMap(page,{timeout=90_000}={}){
  await expect.poll(()=>page.evaluate(()=>{
    const r=window.__PANDOLAB_VIEWER__?.rendererStats?.();
    return Boolean(r?.canonicalMeshReady && !r.projectRenderBlocked && r.surfacePresentation?.quality==='canonical'
      && r.countriesPublishedGeneration===r.projectGeneration && r.mapReadiness?.mapReady);
  }),{timeout}).toBe(true);
}
