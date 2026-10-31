import { expect } from '@playwright/test';

// Android WebView CDP has no browser-cookie/context management. Module sources
// are public development assets; read them with Node, preserving real app I/O.
export async function moduleSource(route) {
  const response=await fetch(route.request().url());
  if(!response.ok)throw new Error(`Test module source failed: ${response.status}`);
  return response.text();
}

export async function openFileMenu(page) {
  if(await page.locator('#mobileFileBtn').isVisible())await page.locator('#mobileFileBtn').click();
  else {await page.locator('#mobileMenuBtn').click();await page.locator('#mobileMenuFileBtn').click();}
}
async function clickControl(page,button,touch,touchInput) {
  if(!touch){await button.click();return;}
  await expect(button).toBeVisible({timeout:30000});await expect(button).toBeEnabled({timeout:60000});
  const point=await button.evaluate(node=>{
    const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    if(!node.contains(document.elementFromPoint(x,y)))throw new Error('History button is covered');return {x,y,id:1};
  });
  await touchInput({type:'tap',point:[point.x,point.y]});
}
async function historyClick(page,action,touch,touchInput) {
  const desktop=page.locator(`#${action}Btn`);
  await clickControl(page,await desktop.isVisible()?desktop:page.locator(`#mobile${action[0].toUpperCase()+action.slice(1)}Btn`),touch,touchInput);
}

export async function instrumentMapPlugin(page) {
  for(const [file,extra] of [['app-domain-assembly.js','window.__pluginDocument=()=>projectDomain;window.__pluginReadModel=()=>documentModel;'],['app-property-selection.js','window.__pluginSelectGeneric=id=>applyGenericSelectionIntent(id);']]) {
    await page.route('**/modules/'+file+'*',async route=>{
      const source=await moduleSource(route);
      await route.fulfill({contentType:'application/javascript',body:source.replace('dependencies = ports;','dependencies = ports;'+extra)});
    });
  }
}

export async function verifyMapPluginFlow(page,collection,{openGis,saveReopen,touch=false,touchInput=null,onStep=()=>{}}) {
  if(touch&&typeof touchInput!=='function')throw new TypeError('The native touch input adapter is required');
  // The software-rendered 4GB Android baseline publishes a full-world command
  // more slowly. Keep exact state/geometry assertions and bound that wait.
  const stateTimeout=touch?90000:30000;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  const read=()=>page.evaluate(()=>window.__pluginDocument().snapshot().genericFeatures);
  expect(await read()).toEqual([]);
  onStep('open-gis');
  await openFileMenu(page);await page.locator('#fileAdvancedBtn').click();await openGis();
  await expect(page.locator('#gisImportModal')).toBeVisible({timeout:30000});
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/is-busy/,{timeout:30000});
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({timeout:30000});
  await page.locator('#gisTargetType').evaluate(select=>{select.value='generic';select.dispatchEvent(new select.ownerDocument.defaultView.Event('change',{bubbles:true}));});
  await expect(page.locator('#gisTargetType')).toHaveValue('generic');
  await page.locator('#gisImportNextBtn').click();await expect(page.locator('#gisStepIndicator')).toContainText('2/3');
  await page.locator('#gisImportNextBtn').click();await expect(page.locator('#gisStepIndicator')).toContainText('3/3');
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({timeout:30000});await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden();
  await expect.poll(async()=>(await read()).length,{timeout:30000}).toBe(collection.features.length);
  const imported=await read();
  onStep('imported');
  expect(imported[0].properties.source.details.imageSha256).toBe(collection.features[0].properties.source.details.imageSha256);
  onStep('batch-undo');await historyClick(page,'undo',touch,touchInput);await expect.poll(async()=>(await read()).length,{timeout:30000}).toBe(0);
  onStep('batch-redo');await historyClick(page,'redo',touch,touchInput);await expect.poll(async()=>(await read()).length,{timeout:30000}).toBe(collection.features.length);
  onStep('select-generic');
  const selection=await page.evaluate(async()=>{
    const feature=window.__pluginDocument().snapshot().genericFeatures[0],host=window.__PANDOLAB_MAP_HOST__,points=feature.geometry.coordinates;
    const selected=await window.__pluginSelectGeneric(feature.id);
    const currentView=host.getViewState();
    host.setViewState({projection:'flat',view:{globeRotation:currentView.globeRotation,globeZoom:currentView.globeZoom,
      flatCenter:[(points[0][0]+points.at(-1)[0])/2,(points[0][1]+points.at(-1)[1])/2],flatZoom:12}});
    host.requestRepaint('plugin-import-test');return selected;
  });
  onStep('generic-selected');
  expect(selection).not.toBe(false);
  // Phone selection does not automatically open the editor. Use its current
  // explicit user action before exercising the visible conversion controls.
  const editorTrigger=page.locator('#mobileEditBtn');
  if(await editorTrigger.isVisible() && await editorTrigger.getAttribute('aria-expanded')!=='true')await clickControl(page,editorTrigger,touch,touchInput);
  await expect(page.locator('#editorSurface')).toBeVisible({timeout:stateTimeout});
  // Imported generic lines use the current semantic conversion workflow before
  // their coordinates can be edited through the hydro editor.
  await expect(page.locator('#genericFeatureConvertType')).toHaveValue('river');
  await expect(page.locator('#convertGenericFeatureBtn')).toHaveText('강으로 변경');
  await clickControl(page,page.locator('#convertGenericFeatureBtn'),touch,touchInput);
  await expect.poll(async()=>(await read()).length,{timeout:stateTimeout}).toBe(collection.features.length-1);
  const readEdited=()=>page.evaluate(()=>window.__pluginReadModel().list('hydro')[0]);
  await expect.poll(async()=>(await readEdited())?.geometry,{timeout:stateTimeout}).toEqual(imported[0].geometry);
  expect((await readEdited()).properties.metadata.compatibilitySource.source.details.imageSha256).toBe(collection.features[0].properties.source.details.imageSha256);
  onStep('converted');
  await clickControl(page,page.locator('#actionsTabBtn'),touch,touchInput);await clickControl(page,page.locator('#hydroVerticesBtn'),touch,touchInput);
  await expect(page.locator('circle.vertex-handle').first()).toBeVisible();
  let point=await page.locator('circle.vertex-handle').evaluateAll(nodes=>nodes.map(node=>({node,rect:node.getBoundingClientRect()}))
    .filter(({node,rect})=>rect.width>0 && rect.x>10 && rect.y>80 && document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===node)
    .map(({rect})=>[rect.x+rect.width/2,rect.y+rect.height/2])[0]);
  expect(point).toBeTruthy();
  onStep('move-vertex');
  if(touch) {
    await touchInput({type:'tap',point});
    await expect(page.locator('#objectChooser')).toBeVisible();
    await clickControl(page,page.locator('#objectChooserList [data-object-chooser-index]').first(),touch,touchInput);
    await expect(page.locator('#objectChooser')).toBeHidden();
    point=await page.locator('circle.vertex-handle.selected').evaluate(node=>{const r=node.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2];});
    await touchInput({type:'drag',from:point,to:[point[0]+24,point[1]+12]});
  } else {
    await page.mouse.move(...point);await page.mouse.down();await page.mouse.move(point[0]+18,point[1]+10,{steps:4});await page.mouse.up();
  }
  await expect.poll(async()=>JSON.stringify((await readEdited()).geometry),{timeout:30000}).not.toBe(JSON.stringify(imported[0].geometry));
  const edited=await readEdited();
  await expect.poll(()=>page.evaluate(()=>window.__pluginDocument().state().undoCommandId),{timeout:30000}).toBe('hydro.geometry');
  onStep('geometry-committed');
  await historyClick(page,'undo',touch,touchInput);await expect.poll(async()=>(await readEdited()).geometry,{timeout:30000}).toEqual(imported[0].geometry);
  await historyClick(page,'redo',touch,touchInput);await expect.poll(async()=>(await readEdited()).geometry,{timeout:30000}).toEqual(edited.geometry);
  onStep('save-reopen');
  const before=await page.evaluate(()=>window.__pluginDocument().snapshot()),saved=await saveReopen();
  await expect.poll(()=>page.evaluate(()=>window.__pluginDocument().state().dirty),{timeout:30000}).toBe(false);
  const reopened=await page.evaluate(()=>window.__pluginDocument().snapshot());
  expect(reopened.genericFeatures).toEqual(before.genericFeatures);expect(reopened.hydroEdits).toEqual(before.hydroEdits);
  expect(reopened.timelineRecords).toEqual(before.timelineRecords);expect(reopened.geometries).toEqual(before.geometries);
  expect((await readEdited()).geometry).toEqual(edited.geometry);expect(errors).toEqual([]);
  return {importedCount:imported.length,geometryEdited:true,batchUndoRedo:true,editUndoRedo:true,savedReopened:true,sourcePreserved:true,saved,errors};
}
