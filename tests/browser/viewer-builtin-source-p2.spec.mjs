import {test,expect} from '@playwright/test';

test.use({viewport:{width:1280,height:800},trace:'off'});
test('P2-1 read-only source preparation cannot change the visible month, camera or C++ document',async({page})=>{
 test.setTimeout(160000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/modules/viewer-map.js*',async route=>{
  const response=await route.fetch(),source=await response.text();
  const anchor='const initialPreview=createViewerInitialPreview(';
  if(source.split(anchor).length!==2)throw Error('P2-1 builtin owner insertion anchor changed');
  await route.fulfill({response,body:source.replace(anchor,
    "globalThis.__P2_1_PREPARE__=month=>builtinSession.prepareProjectSource(month);\n  "+anchor)});
 });
 await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
 await page.goto('/?debug=1');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.builtinMonth().month)).toBe('2026-10');
 const state=()=>page.evaluate(async()=>{
  const viewer=window.__PANDOLAB_VIEWER__;
  const bytes=new TextEncoder().encode(JSON.stringify(viewer.documentSnapshot()));
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');
  const view=window.__PANDOLAB_VIEW_STATE__;
  return {month:viewer.builtinMonth().month,core:viewer.documentState(),documentSha:sha,
    camera:view?{projection:view.projection,zoom:view.zoom,rotation:view.rotation,flatCenter:view.flatCenter}:null,
    first:viewer.initialMapPresented(),ready:document.querySelector('#viewerStatus').dataset.ready};
 });
 const before=await state();
 const candidate=await page.evaluate(async()=>{
  const value=await window.__P2_1_PREPARE__('2025-12');
  return {sourceMonth:value.sourceMonth,bytes:value.sourceBytes.length,baselineId:value.baselineId??null};
 });
 expect(candidate.sourceMonth).toBe('2025-12');
 expect(candidate.bytes).toBeGreaterThan(0);
 expect(candidate.baselineId).toBe(null);
 expect(await state()).toEqual(before);
 await expect(page.locator('#viewerInitialPreview')).toBeHidden();
 await page.locator('#timelinePreviousYear').click();
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),
  {timeout:100000}).toBe('2025-12');
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('2025-12');
 expect(errors).toEqual([]);
});
