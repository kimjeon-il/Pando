import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { openLibrary, importFiniteSource } from './helpers/library-state.mjs';

test('historical library month input imports the first-day sourced geometry reversibly', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await expect.poll(() => page.locator('#territorialLibraryResults [data-library-entity-id]').count()).toBeGreaterThan(200);
  await expect(page.locator('[data-library-entity-id="state:DEU"] .territorial-library-result-flag img')).toHaveCount(1);
  await page.locator('#territorialLibrarySearchInput').fill('USSR');
  await expect(page.locator('.territorial-library-filters summary')).toHaveCount(0);
  await page.locator('#territorialLibraryReferenceDateInput').fill('1991-01');
  const result = page.locator('[data-library-entity-id="state:soviet-union"]');
  await result.click();
  await expect(result.locator('.territorial-library-result-flag img')).toHaveCount(1);
  await expect(page.locator('#territorialLibraryPreview')).toContainText('소련');
  await expect(page.locator('#territorialLibraryPreview')).toContainText('근사 경계');
  await expect(page.locator('#territorialLibraryPreview')).toBeVisible();
  await expect(result).toHaveAttribute('aria-controls','territorialLibraryPreview');
  await expect(page.locator('#territorialLibraryPreview a[aria-label^="출처"]')).toHaveCount(0);
  await expect(page.locator('#territorialLibraryPreview svg path')).toHaveCount(1);
  await importFiniteSource(page, testInfo, 'state:soviet-union', errors, { referenceDate: '1991-01-01' });
});

for(const renderer of ['webgl2','canvas']) test(`${renderer}: North Schleswig exact-date import preserves source and Undo`, async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page,{renderer});
  await page.locator('#territorialLibrarySearchInput').fill('북슐레스비히');
  await page.locator('#territorialLibraryReferenceDateInput').fill('1900-01-01');
  const result = page.locator('[data-library-entity-id="state:north-schleswig"]');
  await expect(result.locator('.territorial-library-result-flag img')).toHaveCount(1);
  await result.click();
  await expect(page.locator('#territorialLibraryPreview')).toContainText('북슐레스비히');
  await importFiniteSource(page, testInfo, 'state:north-schleswig', errors, { referenceDate: '1900-01-01' });
});

test('catalog search loads only the index and repeated selection loads one unchanged country chunk',async({page},testInfo)=>{
  test.setTimeout(120_000);
  const requests=[];page.on('request',request=>requests.push(request.url()));
  await gotoEditor(page, '/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90_000});
  expect(requests.filter(url=>url.includes('/territorial-entities/'))).toEqual([]);
  await page.locator('#createMenuBtn').click();await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#territorialLibrarySearchInput')).toBeEnabled();
  await page.locator('#territorialLibrarySearchInput').fill('대한민국');
  const row=page.locator('[data-library-entity-id="state:KOR"]');
  await expect(row).toBeVisible();
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz'))).toEqual([]);
  await row.click();await expect(page.locator('#territorialLibraryAddBtn')).toBeEnabled();
  await row.click();
  const [first,second]=await page.evaluate(()=>Promise.all([window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:KOR'),window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:KOR')]));
  expect(first).toEqual(second);expect(first.geometryVersions[0].versionId).toBe('state:KOR:natural-earth-5.1.1');
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('index.json'))).toHaveLength(1);
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz')).map(url=>new URL(url).pathname)).toEqual(['/assets/data/territorial-entities/generated/v2/state-KOR.json.gz']);
  await page.locator('#territorialLibrarySearchInput').fill('독일');
  await expect(page.locator('#territorialLibraryResults > h3')).toHaveCount(0);
  await expect(page.locator('[data-library-entity-id="state:DEU"]')).toBeVisible();
  await expect(page.locator('[data-library-entity-id="state:DEU"] strong')).toHaveText('독일');
  await expect(page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]')).toBeVisible();
  await expect(page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"] strong')).toHaveText('독일 민주공화국');
  await page.locator('#territorialLibraryReferenceDateInput').fill('1970');
  await expect(page.locator('[data-library-entity-id="state:DEU"]')).toBeVisible();
  await expect(page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]')).toBeVisible();
  await page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]').click();
  await expect(page.locator('#territorialLibraryPreview')).toContainText('국가의 부재를 뜻하지 않습니다');
  await expect(page.locator('#territorialLibraryAddBtn')).toBeDisabled();
  await page.locator('#territorialLibraryReferenceDateInput').fill('1989-04-25');
  await expect(page.locator('[data-library-entity-id="state:DEU"]')).toBeVisible();
  await expect(page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]')).toBeVisible();
  await expect(page.locator('#territorialLibraryPreview [data-geometry-version-id]')).toHaveAttribute('data-geometry-version-id','state:deutsche-demokratische-republik:1989-04-25-r1');
  await expect(page.locator('#territorialLibraryAddBtn')).toBeEnabled();
  const previewAspect=await page.locator('#territorialLibraryPreview svg path').evaluate(path=>{const b=path.getBBox();return b.width/b.height;});
  const sourceAspect=await page.evaluate(async()=>{const e=await window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:deutsche-demokratische-republik');
    const points=e.geometryVersions[0].geometry.coordinates.flat(2),x=points.map(p=>p[0]),y=points.map(p=>p[1]);return (Math.max(...x)-Math.min(...x))/(Math.max(...y)-Math.min(...y));});
  expect(Math.abs(previewAspect-sourceAspect)).toBeLessThan(0.03);
  expect(await page.locator('#territorialLibraryPreview svg path').evaluate(path=>path.getBBox().height)).toBeGreaterThan(160);
  await page.screenshot({path:testInfo.outputPath('lineage-preview.png')});
  await page.locator('#territorialLibraryCloseBtn').click();
  await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.select('DEU'));
  await page.locator('#flagMenuBtn').click();await page.locator('#flagLibraryBtn').click();
  await page.locator('#territorialLibraryReferenceDateInput').fill('');
  await page.locator('#territorialLibrarySearchInput').fill('일본');
  const flagSource=await page.evaluate(async()=> (await window.PANDOLAB_TERRITORIAL_LIBRARY.list()).find(e=>e.entityId==='state:JPN').metadata.defaultFlagDataUrl);
  const chunksBefore=requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz')).length;
  await page.locator('[data-library-entity-id="state:JPN"]').click();
  await expect(page.locator('#territorialLibraryAddBtn')).toHaveText('적용');
  await page.locator('#territorialLibraryAddBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('DEU').properties.metadata.flagDataUrl)).toBe(flagSource);
  expect(requests.filter(url=>url.includes('/territorial-entities/') && url.includes('.json.gz'))).toHaveLength(chunksBefore);

});

test('East Germany static import preserves identity, archive, history and original source', async ({ page }, testInfo) => {
  test.setTimeout(process.env.PANDOLAB_DDR_EVIDENCE_DIR?420_000:240_000);
  const errors = await openLibrary(page);
  await page.locator('#territorialLibraryReferenceDateInput').fill('1989-04-25');
  await page.locator('#territorialLibrarySearchInput').fill('동독');
  await page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]').click();
  await expect(page.locator('#territorialLibraryPreview')).toBeVisible();
  await expect(page.locator('#territorialLibraryPreview details')).toHaveCount(0);
  await expect(page.locator('#territorialLibraryPreview svg path')).toHaveCount(1);
  await importFiniteSource(page, testInfo, 'state:deutsche-demokratische-republik', errors, { referenceDate: '1989-04-25' });
  const imported=await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().find(e=>e.properties.sourceEntityId==='state:deutsche-demokratische-republik'));
  const source=await page.evaluate(()=>window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:deutsche-demokratische-republik'));
  expect(source.geometryVersions[0].sourceId).toContain('adopted-dos-lsib-11.4+bkg-vg25');
  expect(source.geometryVersions[0].boundarySupplement.sections.filter(s=>s.id.startsWith('vg25-')).map(s=>s.id)).toEqual([
    'vg25-schaalsee-lake', 'vg25-bavaria-central', 'vg25-saxony-bavaria',
    'vg25-eichsfeld-north', 'vg25-harz-ecker', 'vg25-geismar-spahl',
    'vg25-wolfenbuettel-hornburg',
    'vg25-eichsfeld-glasehausen', 'vg25-schaalsee-mustin-thurow-land',
    'vg25-ratzeburg-wakenitz-south', 'vg25-kiekbusch-mechower-west-shore',
    'vg25-wakenitz-palingen-remaining', 'vg25-schaalsee-northern-remaining',
    'vg25-gudow-lauenburg-land', 'vg25-altmark-diesdorf-land', 'vg25-altmark-stresow-land',
    'vg25-helmstedt-lappwald-land', 'vg25-ecker-lower-foothills',
    'vg25-suedharz-ellrich-land', 'vg25-rhon-point-alpha-land',
    'vg25-delvenau-approved-map',
  ]);
  expect(source.geometryVersions[0].boundarySupplement.sections.filter(s=>s.id.startsWith('tk25as-')).map(s=>s.id)).toEqual([
    'tk25as-elbe-neuhaus-printed-claim', 'tk25as-elbe-schnackenburg-printed-claim'
  ]);
  expect(imported.geometry).toEqual(source.geometryVersions[0].geometry);
  if(process.env.PANDOLAB_DDR_EVIDENCE_DIR){
    const {writeFile}=await import('node:fs/promises'),{gzipSync}=await import('node:zlib');
    const {productionGeoPackage}=await import('../helpers/production-geopackage.mjs');
    const out=process.env.PANDOLAB_DDR_EVIDENCE_DIR;
    const focus=async (target,projection)=>{
      await target.evaluate(projection=>{const host=window.__PANDOLAB_MAP_HOST__;host.setViewState({projection,view:{...host.getViewState(),flatCenter:[12.5,52],flatZoom:12,globeRotation:[-12.5,-52,0],globeZoom:14}});host.requestRepaint('ddr-source-review');},projection);
      await target.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    };
    await focus(page,'flat');await page.screenshot({path:out+'/app-web-shell-import.png'});
    const receipt=await page.evaluate(()=>window.__libraryBuildFileSnapshot());
    await writeFile(out+'/app-file-receipt.json.gz',gzipSync(Buffer.from(JSON.stringify(receipt)),{level:9}));
    const audits=receipt.project.sourceInfo.imports.filter(row=>row.batchPrecisionAudit).map(row=>row.batchPrecisionAudit);
    expect(audits).toHaveLength(1);expect(audits[0].sourceEntityIds).toContain(source.entityId);
    expect(audits[0].discards).toHaveLength(4);
    const encoded=await productionGeoPackage('write',new ArrayBuffer(0),receipt.project,receipt.spatialState);
    const bytes=Buffer.from(encoded.buffer);
    await writeFile(out+'/app-export.gpkg.gz',gzipSync(bytes,{level:9}));
    const viewer=await page.context().newPage(),viewerErrors=[];
    viewer.on('pageerror',error=>viewerErrors.push(error.message));
    await viewer.goto('/?debug=1&demTerrain=raster');
    await expect(viewer.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
    const packagePath=testInfo.outputPath('DDR-1989-source-review.gpkg');
    await writeFile(packagePath,bytes);
    await viewer.locator('#projectFileInput').setInputFiles(packagePath);
    await expect.poll(()=>viewer.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities.some(e=>e.properties.sourceEntityId==='state:deutsche-demokratische-republik')),{timeout:90000}).toBe(true);
    await expect(viewer.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
    const opened=await viewer.evaluate(id=>{const document=window.__PANDOLAB_VIEWER__.documentSnapshot();
      const binding=document.timelineRecords.geometryBindings.find(row=>row.entityId===id);
      return {audits:document.sourceInfo.imports.filter(row=>row.batchPrecisionAudit).map(row=>row.batchPrecisionAudit),
        geometry:document.geometries.find(g=>g.id===binding.geometryRef.id&&g.version===binding.geometryRef.version).geojson};},imported.id);
    expect(opened.audits).toEqual(audits);
    expect(opened.geometry).toEqual(source.geometryVersions[0].geometry);
    await focus(viewer,'globe');await viewer.screenshot({path:out+'/web-viewer-file.png'});
    expect(viewerErrors).toEqual([]);
    await writeFile(out+'/web-app-proof.json',JSON.stringify({sourceId:source.entityId,geometryVersion:source.geometryVersions[0].versionId,objectId:imported.id,webFileBytes:bytes.length,appImport:true,undoRedo:true,webFileGeometryEqual:true,precisionAudits:audits,webErrors:viewerErrors,appErrors:errors}));
    await viewer.close();
  }
});
