import {test,expect} from '@playwright/test';
import {gotoEditor} from './helpers/editor-entry.mjs';
import {createViewerProjectPackage} from '../fixtures/viewer-project-package.mjs';

test('editor web shell preserves canonical picking and document state after opening a project and zooming',async({page})=>{
 const fixture=await createViewerProjectPackage('앱 picking 확인'),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/modules/object-picking.js*',async route=>{
  const response=await route.fetch(),source=await response.text(),anchor='    dependencies = ports;';
  expect(source.split(anchor)).toHaveLength(2);
  await route.fulfill({response,body:source.replace(anchor,anchor+`
    window.__editorPickingTest={get state(){return ports.projectState.state;},hits:territorialObjectsAt,
      entity:id=>ports.territorialModel.entityRepository.get(id),
      selection:()=>ports.domains.selectionDomain.snapshot(),document:()=>ports.domains.projectDomain.state()};`)});
 });
 await gotoEditor(page,'/?debug=1');
 await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
 await page.getByRole('button',{name:'파일 메뉴 열기'}).click();
 const picker=page.waitForEvent('filechooser');
 await page.locator('#openProjectBtn').click();
 await(await picker).setFiles({name:'picking.gpkg',mimeType:'application/geopackage+sqlite3',buffer:fixture.bytes});
 await expect.poll(()=>page.evaluate(()=>window.__editorPickingTest.entity('A')?.properties.name),{timeout:45000}).toBe('앱 picking 확인');
 await expect.poll(()=>page.evaluate(()=>window.__editorPickingTest.state.countryVisualPhase)).not.toBe('pending');
 const before=await page.evaluate(()=>window.__editorPickingTest.document());
 const move=async()=>{
  const point=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.project([8,8]));
  const bounds=await page.locator('#map').boundingBox();
  await page.mouse.move(bounds.x+point[0],bounds.y+point[1]);
  return page.evaluate(point=>window.__editorPickingTest.hits(point,[8,8]).map(hit=>hit.ref),point);
 };
 const refs=await move();
 expect(refs.map(ref=>ref.id)).toContain('A');
 await expect.poll(()=>page.evaluate(()=>window.__editorPickingTest.selection().hover?.key)).toBe(refs[0].key);
 await page.mouse.wheel(0,-150);
 await expect.poll(()=>page.evaluate(()=>window.__editorPickingTest.state.mapMoving)).toBe(false);
 expect((await move()).map(ref=>ref.id)).toContain('A');
 const after=await page.evaluate(()=>window.__editorPickingTest.document());
 for(const key of ['checkpoint','presentationCheckpoint','dirty','canUndo'])expect(after[key]).toBe(before[key]);
 expect(errors).toEqual([]);
});

test('viewer composition supports territorial hover and body clicks across camera changes without editing the document',async({page})=>{
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/modules/viewer-map.js*',async route=>{
  const response=await route.fetch(),source=await response.text(),anchor='  objectPicking.bindChooser();';
  expect(source.split(anchor)).toHaveLength(2);
  await route.fulfill({response,body:source.replace(anchor,anchor+'\nwindow.__viewerPickingTest={picking:objectPicking,state,selection:()=>selectionDomain.snapshot()};')});
 });
 await page.goto('/?debug=1');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 await expect.poll(()=>page.evaluate(()=>window.__viewerPickingTest.state.countryVisualPhase),{timeout:90000}).not.toBe('pending');
 const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
 const move=async coordinate=>{
  const point=await page.evaluate(coord=>window.__PANDOLAB_MAP_HOST__.project(coord),coordinate);
  const bounds=await page.locator('#map').boundingBox();
  await page.mouse.move(bounds.x+point[0],bounds.y+point[1]);
  return page.evaluate(({point,coordinate})=>window.__viewerPickingTest.picking.territorialObjectsAt(point,coordinate).map(hit=>hit.ref),{point,coordinate});
 };
 expect((await move([32,39])).map(ref=>ref.id)).toContain('TUR');
 await expect.poll(()=>page.evaluate(()=>window.__viewerPickingTest.selection().hover?.id)).toBe('TUR');
 expect(await move([-30,10])).toEqual([]);
 await expect.poll(()=>page.evaluate(()=>window.__viewerPickingTest.selection().hover)).toBeNull();
 await page.mouse.wheel(0,-150);
 await expect.poll(()=>page.evaluate(()=>window.__viewerPickingTest.state.mapMoving)).toBe(false);
 expect((await move([32,39])).map(ref=>ref.id)).toContain('TUR');
 await expect.poll(()=>page.evaluate(()=>window.__viewerPickingTest.selection().hover?.id)).toBe('TUR');
 const point=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.project([32,39]));
 const bounds=await page.locator('#map').boundingBox();
 await page.addStyleTag({content:'#map .territorial-label-item {pointer-events:none !important;}'});
 expect(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y).closest('.territorial-label-item'),{x:bounds.x+point[0],y:bounds.y+point[1]})).toBe(false);
 await page.mouse.click(bounds.x+point[0],bounds.y+point[1]);
 const chooser=page.locator('#objectChooserList [data-object-chooser-index]');
 await expect.poll(async()=>await chooser.count()>0 || await page.evaluate(()=>window.__PANDOLAB_VIEWER__.selectionSnapshot().items.some(ref=>ref.id==='TUR'))).toBe(true);
 if(await chooser.count())await chooser.filter({hasText:'튀르키예'}).click();
 await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.selectionSnapshot().items.map(ref=>ref.id))).toContain('TUR');
 const after=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
 expect(after.checkpoint).toBe(before.checkpoint);
 expect(after.presentationCheckpoint).toBe(before.presentationCheckpoint);
 expect(after.dirty).toBe(before.dirty);
 expect(after.canUndo).toBe(before.canUndo);
 expect(errors.filter(error=>/PL-MAP-(HOVER|CLICK)-001|displayFeature/.test(error))).toEqual([]);
});

test('labels paint above land and camera motion reuses geometry centroids',async({page})=>{
 page.setDefaultTimeout(15000);
 await page.goto('/?debug=1');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 await expect(page.locator('#zoomInBtn,#zoomOutBtn,.map-view-toolbar')).toHaveCount(0);
 const labelDistance=async()=>{
  const points=await Promise.all(['알제리','이집트'].map(name=>page.locator('#map .country-label').filter({hasText:new RegExp('^'+name+'$')}).evaluate(element=>{
   const matrix=element.parentElement.transform.baseVal.consolidate().matrix;return [matrix.e,matrix.f];
  })));
  return Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]);
 };
 const initialDistance=await labelDistance();
 const mapBounds=await page.locator('#map').boundingBox();
 await page.mouse.move(mapBounds.x+mapBounds.width/2,mapBounds.y+mapBounds.height/2);
 const order=await page.evaluate(()=>{
  const canvas=document.getElementById('viewerCanvas'),labels=document.querySelector('#map .map-interaction-svg');
  const box=canvas.getBoundingClientRect();
  const original=[canvas.style.pointerEvents,labels.style.pointerEvents];
  try{canvas.style.pointerEvents=labels.style.pointerEvents='auto';return document.elementsFromPoint(box.x+box.width/2,box.y+box.height/2).filter(node=>node===canvas||node===labels).map(node=>node===labels?'interaction':node.id);}
  finally{[canvas.style.pointerEvents,labels.style.pointerEvents]=original;}
 });
 expect(order).toEqual(['interaction','viewerCanvas']);
 await page.evaluate(()=>{const original=window.d3.geo.centroid;window.__centroidCalls=0;window.d3.geo.centroid=(...args)=>{window.__centroidCalls++;return original(...args);};});
 await page.mouse.wheel(0,-200);
 await expect.poll(labelDistance).toBeGreaterThan(initialDistance);
 await page.waitForTimeout(500);
 await page.evaluate(()=>{window.__centroidCalls=0;});
 const zoomedDistance=await labelDistance();
 await page.mouse.wheel(0,200);
 await expect.poll(labelDistance).toBeLessThan(zoomedDistance);
 await page.waitForTimeout(500);
 expect(await page.evaluate(()=>window.__centroidCalls)).toBe(0);
 await page.locator('#resetViewBtn').click();
 await expect.poll(async()=>Math.abs(await labelDistance()-initialDistance)).toBeLessThan(0.01);
 await page.setViewportSize({width:640,height:360});
 await expect(page.locator('#zoomInBtn,#zoomOutBtn,.map-view-toolbar')).toHaveCount(0);
 await expect(page.locator('#resetViewBtn')).toBeVisible();
});

test('viewing preferences preview, cancel and persist without document changes',async({page},testInfo)=>{
 page.setDefaultTimeout(15000);
 await page.goto('/?debug=1');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
 await page.getByRole('button',{name:'설정',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'환경설정'})).toBeVisible();
 await page.getByRole('button',{name:'어두운 테마',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.getByRole('button',{name:'취소',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByRole('button',{name:'설정',exact:true}).click();
 await page.getByRole('button',{name:'어두운 테마',exact:true}).click();
 await page.getByRole('button',{name:'보라',exact:true}).click();
 await page.getByLabel('경계선 부드럽게', {exact:true}).uncheck();
 await page.getByLabel('하단 상태표시줄 표시', {exact:true}).uncheck();
 await page.getByRole('button',{name:'적용',exact:true}).click();
 await expect(page.locator('#mapBottomStatus')).toBeHidden();
 await expect(page.locator('html')).toHaveAttribute('data-smooth-lines','false');
 const after=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
 expect(after.checkpoint).toBe(before.checkpoint);expect(after.presentationCheckpoint).toBe(before.presentationCheckpoint);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pandolab-user-preferences')));
 expect(stored.appearance).toEqual({theme:'dark',accentPreset:'purple',statusBarVisible:false,smoothLines:false});
 await page.reload();
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 await expect(page.getByRole('button',{name:'설정',exact:true})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.setViewportSize({width:640,height:360});
 await page.locator('#mobileMenuBtn').click();
 await page.locator('#mobilePreferencesBtn').click();
 const bounds=await page.locator('.preferences-card').boundingBox();expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(360);
 await expect(page.getByRole('button',{name:'적용',exact:true})).toBeInViewport();
 await page.screenshot({path:testInfo.outputPath('preferences-mobile.png')});
 await page.keyboard.press('Escape');
 await expect(page.locator('#preferencesModal')).toBeHidden();
});
