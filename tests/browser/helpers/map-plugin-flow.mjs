import { expect } from '@playwright/test';

export async function instrumentMapPlugin(page) {
  for(const [file,extra] of [['app-domain-assembly.js','window.__pluginDocument=()=>projectDomain;'],['app-property-selection.js','window.__pluginSelectGeneric=id=>applyGenericSelectionIntent(id);']]) {
    await page.route('**/modules/'+file+'*',async route=>{
      const response=await route.fetch(),source=await response.text();
      await route.fulfill({response,body:source.replace('dependencies = ports;','dependencies = ports;'+extra)});
    });
  }
}

export async function verifyMapPluginFlow(page,collection,{openGis,saveReopen,touch=false}) {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  const read=()=>page.evaluate(()=>window.__pluginDocument().snapshot().genericFeatures);
  expect(await read()).toEqual([]);
  await page.locator('#mobileFileBtn').click();await page.locator('#fileAdvancedBtn').click();await openGis();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({timeout:30000});
  await page.locator('#gisTargetType').evaluate(select=>{select.value='generic';select.dispatchEvent(new select.ownerDocument.defaultView.Event('change',{bubbles:true}));});
  await page.locator('#gisImportNextBtn').click();await page.locator('#gisImportNextBtn').click();await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden();
  await expect.poll(async()=>(await read()).length).toBe(collection.features.length);
  const imported=await read();
  expect(imported[0].properties.source.details.imageSha256).toBe(collection.features[0].properties.source.details.imageSha256);
  await page.locator('#undoBtn').click();await expect.poll(async()=>(await read()).length).toBe(0);
  await page.locator('#redoBtn').click();await expect.poll(async()=>(await read()).length).toBe(collection.features.length);
  const selection=await page.evaluate(async()=>{
    const feature=window.__pluginDocument().snapshot().genericFeatures[0],host=window.__PANDOLAB_MAP_HOST__,points=feature.geometry.coordinates;
    host.setViewState({projection:'flat',view:{...host.getViewState(),flatCenter:[(points[0][0]+points.at(-1)[0])/2,(points[0][1]+points.at(-1)[1])/2],flatZoom:12}});
    host.requestRepaint('plugin-import-test');return await window.__pluginSelectGeneric(feature.id);
  });
  expect(selection).not.toBe(false);
  await page.locator('#actionsTabBtn').click({timeout:8000});await page.locator('#genericVerticesBtn').click({timeout:8000});
  await expect(page.locator('circle.vertex-handle').first()).toBeVisible();
  const point=await page.locator('circle.vertex-handle').evaluateAll(nodes=>nodes.map(node=>({node,rect:node.getBoundingClientRect()}))
    .filter(({node,rect})=>rect.width>0 && rect.x>10 && rect.y>80 && document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===node)
    .map(({rect})=>[rect.x+rect.width/2,rect.y+rect.height/2])[0]);
  expect(point).toBeTruthy();
  if(touch) {
    const session=await page.context().newCDPSession(page);
    const send=(type,points)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({x:p[0],y:p[1],id:1,radiusX:2,radiusY:2,force:1}))});
    await send('touchStart',[point]);await send('touchEnd',[]);await send('touchStart',[point]);await send('touchMove',[[point[0]+24,point[1]+12]]);await send('touchEnd',[]);await session.detach();
  } else {
    await page.mouse.move(...point);await page.mouse.down();await page.mouse.move(point[0]+18,point[1]+10,{steps:4});await page.mouse.up();
  }
  await expect.poll(async()=>JSON.stringify((await read())[0].geometry)).not.toBe(JSON.stringify(imported[0].geometry));
  const edited=await read();
  await page.locator('#undoBtn').click();expect((await read())[0].geometry).toEqual(imported[0].geometry);
  await page.locator('#redoBtn').click();expect((await read())[0].geometry).toEqual(edited[0].geometry);
  const before=await page.evaluate(()=>window.__pluginDocument().snapshot()),saved=await saveReopen();
  await expect.poll(()=>page.evaluate(()=>window.__pluginDocument().state().dirty),{timeout:30000}).toBe(false);
  expect((await page.evaluate(()=>window.__pluginDocument().snapshot())).genericFeatures).toEqual(before.genericFeatures);expect(errors).toEqual([]);
  return {importedCount:imported.length,geometryEdited:true,batchUndoRedo:true,editUndoRedo:true,savedReopened:true,sourcePreserved:true,saved,errors};
}
