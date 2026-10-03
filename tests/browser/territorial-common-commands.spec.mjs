import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

async function select(page, id) {
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#entityProperties')).toBeVisible();
}
async function importRegions(page, rows) {
  await page.locator('#mobileFileBtn').click();
  const choosing = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').click();
  await (await choosing).setFiles({ name: 'regions.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({ type:'FeatureCollection', features:rows.map(({name,x})=>({ type:'Feature', properties:{name}, geometry:{type:'Polygon',coordinates:[[[x,50],[x,51],[x+1,51],[x+1,50],[x,50]]]}}))})) });
  await expect(page.locator('#gisImportModal')).toBeVisible({timeout:30000});
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({timeout:30000});
  await page.locator('#gisTargetType').selectOption('region');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toContainText('2/3');
  await page.locator('#gisIndependentRegion').check();
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toContainText('3/3');
  await page.locator('#gisImportConfirmBtn').click();
  try {
    await expect.poll(() => page.evaluate(()=> window.PANDOLAB_TERRITORIAL.list({kind:'regional'}).map(f=>f.properties.name)), { timeout: 60000 }).toEqual(expect.arrayContaining(rows.map(row=>row.name)));
  } catch (error) {
    const log = await page.evaluate(() => window.__PANDOLAB_RELIABILITY_LOG__.snapshot());
    throw new Error(`${error.message}\nGIS diagnostics: ${JSON.stringify(log)}`, { cause: error });
  }
  return page.evaluate(names=>names.map(n=>window.PANDOLAB_TERRITORIAL.list({kind:'regional'}).find(f=>f.properties.name===n).id),rows.map(row=>row.name));
}
async function savedProject(page) {
  return page.evaluate(() => new Promise((resolve,reject)=>{
    const r=indexedDB.open('pandolab-editor',2);
    r.onerror=()=>reject(r.error);
    r.onsuccess=()=>{ const db=r.result,t=db.transaction('projects','readonly'),q=t.objectStore('projects').get('active-project'); t.oncomplete=()=>{db.close();resolve(q.result)};t.onerror=()=>reject(t.error); };
  }));
}

test('common territorial metadata, flags and deletion preserve selection, undo and saved state', async ({ page }) => {
  test.setTimeout(150000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.stack || e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:60000});
  await select(page,'DEU');
  await page.locator('#entityNameInput').fill('공통 명령 시험 국가');
  await page.locator('#entityNameInput').dispatchEvent('change');
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('DEU').properties.name)).toBe('공통 명령 시험 국가');
  const camera=await page.evaluate(()=>JSON.stringify(window.__PANDOLAB_VIEW_STATE__));
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.setName('FRA','선택하지 않은 국가').changed)).toBe(true);
  await expect(page.locator('#entityNameInput')).toHaveValue('공통 명령 시험 국가');
  expect(await page.evaluate(()=>JSON.stringify(window.__PANDOLAB_VIEW_STATE__))).toBe(camera);
  const unit=await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list({kind:'general'}).filter(f=>f.properties.parentId).find(f=>f.properties.metadata?.builtinSubunit?.sourceCountryId==='ALD').id);
  await select(page,unit);
  await page.locator('#flagFileInput').setInputFiles({name:'test.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><path fill="red" d="M0 0h24v12H0z"/></svg>')});
  await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id).properties.metadata.flagDataUrl,unit)).toMatch(/^data:image/);
  await page.locator('#flagMenuBtn').click(); await page.locator('#flagRemoveBtn').click();
  expect(await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id).properties.metadata.flagDataUrl,unit)).toBeNull();
  await page.locator('#flagMenuBtn').click(); await page.locator('#flagDefaultBtn').click();
  expect(await page.evaluate(id=>Object.hasOwn(window.PANDOLAB_TERRITORIAL.get(id).properties.metadata,'flagDataUrl'),unit)).toBe(false);
  await page.locator('#entityNameInput').fill('사용자 하위단위 이름'); await page.locator('#entityNameInput').dispatchEvent('change');
  await page.locator('#actionsTabBtn').click(); await page.locator('#objectDeleteBtn').click();
  await expect(page.locator('#confirmModal')).toBeVisible(); await page.locator('#confirmModalOkBtn').click();
  await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id),unit)).toBeNull();
  await page.locator('#undoBtn').click();
  await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id)?.properties.name,unit)).toBe('사용자 하위단위 이름');
  await expect.poll(async()=>JSON.stringify(await savedProject(page))).toContain('사용자 하위단위 이름');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:60000});
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('DEU').properties.name)).toBe('공통 명령 시험 국가');
  expect(await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id)?.properties.name,unit)).toBe('사용자 하위단위 이름');
  expect(errors).toEqual([]);
});

test('Region merge uses the common Worker plan and supports geometry undo and saved restore', async ({ page }) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(8000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.stack || e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:60000});
  const [a,b]=await importRegions(page,[{name:'병합 A',x:9},{name:'병합 B',x:10}]);
  const before = await page.evaluate(ids=>ids.map(id=>window.PANDOLAB_TERRITORIAL.get(id).geometry),[a,b]);
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('병합 A');
  await page.locator(`[data-object-search-focus][data-item-id="${a}"]`).click();
  await expect(page.locator(`g.territorial-label-item[data-label-id="territorial:entity:${a}"]`)).toBeVisible();
  await page.locator(`[data-object-search-select][data-item-id="${a}"]`).click();
  await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#entityProperties')).toBeVisible();
  await page.locator('#actionsTabBtn').click(); await page.locator('#mergeEntityBtn').click();
  await page.locator('path.territorial-unit-shape').evaluateAll((nodes,id)=>{
    const n=nodes.find(node=>node.__data__.id===id); if(!n)throw new Error('region shape missing');
    n.dispatchEvent(new n.ownerDocument.defaultView.MouseEvent('click',{bubbles:true}));
  },b);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled(); await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#geometryPreviewSummary')).toBeVisible();
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled(); await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#confirmModal')).toBeVisible(); await page.locator('#confirmModalOkBtn').click();
  await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id),b)).toBeNull();
  const merged=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id).geometry,a);
  const area=g=>(g.type==='Polygon'?[g.coordinates]:g.coordinates).reduce((s,p)=>s+p.reduce((v,r,i)=>v+(i?-1:1)*Math.abs(r.slice(1).reduce((v,c,j)=>v+r[j][0]*c[1]-c[0]*r[j][1],0)/2),0),0);
  expect(area(merged)).toBeCloseTo(2,6);
  await page.locator('#undoBtn').click();
  await expect.poll(()=>page.evaluate(id=>!!window.PANDOLAB_TERRITORIAL.get(id),b)).toBe(true);
  expect(await page.evaluate(ids=>ids.map(id=>window.PANDOLAB_TERRITORIAL.get(id).geometry),[a,b])).toEqual(before);
  await expect.poll(async()=>JSON.stringify(await savedProject(page))).toContain('병합 B');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:60000});
  expect(await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id)?.properties.name,a)).toBe('병합 A');
  expect(await page.evaluate(id=>!!window.PANDOLAB_TERRITORIAL.get(id),b)).toBe(true);
  expect(await page.evaluate(ids=>ids.map(id=>window.PANDOLAB_TERRITORIAL.get(id).geometry),[a,b])).toEqual(before);
  expect(errors).toEqual([]);
});
