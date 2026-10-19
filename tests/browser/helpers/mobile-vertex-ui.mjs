import { gotoEditor } from './editor-entry.mjs';
import {expect} from '@playwright/test';import {readFileSync} from 'node:fs';
export async function verifyMobileVertexUi(page,{url,domainSource,afterBoot=async()=>{}}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/modules/app-domain-assembly.js*',async route=>{const source=domainSource||await(await route.fetch()).text();await route.fulfill({contentType:'text/javascript',body:source.replace('dependencies = ports;','dependencies = ports; window.__editingTest = ports; window.__editingTestDomains=()=>({projectDomain,editingDomain});')});});
 await gotoEditor(page, url);await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});await afterBoot();
  const seed=JSON.parse(readFileSync(new URL('../../fixtures/timeline-exchange/static.json',import.meta.url),'utf8'));
 const polygons=[[[6,48],[6,56],[16,56],[16,54],[16,52],[16,50],[16,48],[6,48]],[[16,48],[16,50],[16,52],[16,54],[16,56],[22,56],[22,48],[16,48]]];
 for(const [i,id] of ['A','B'].entries()){const ref={id:'recovery-'+id,version:1};seed.geometries.push({...ref,geojson:{type:'Polygon',coordinates:[polygons[i]]}});seed.timelineRecords.geometryBindings.find(r=>r.entityId===id).geometryRef=ref;Object.assign(seed.timelineRecords.parentRelations.find(r=>r.entityId===id),{parentId:'',coverageMode:'explicit'});}
 await page.evaluate(async seed=>{await window.__editingTestDomains().projectDomain.loadAutosave(seed);await window.PANDOLAB_TERRITORIAL.select('A');window.__editingTest.workspaceUiB.openSelectionEditor();},seed);
 await page.locator('#flatBtn').evaluate(n=>n.click());
 await page.evaluate(()=>{const h=window.__PANDOLAB_MAP_HOST__;h.setViewState({projection:'flat',view:{...h.getViewState(),flatCenter:[13,52],flatZoom:12}});h.requestRepaint('editing-test');});
 await page.locator('#actionsTabBtn').click();await page.locator('#editEntityCoastBtn').click();
 await expect.poll(()=>page.evaluate(()=>window.__editingTest.projectState.state.boundaryPreparation?.status),{timeout:30000}).toBe('ready');
 await expect(page.locator('#modePrimaryBtn')).toBeDisabled();

 await page.setViewportSize({width:390,height:844});await page.locator('#modeTaskMinimizeBtn').click();await expect(page.locator('#modeTaskInput')).toBeVisible();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({x:p[0],y:p[1],id:i+1,radiusX:2,radiusY:2,force:1}))});
 const coords=()=>page.evaluate(()=>window.__editingTestDomains().editingDomain.createRenderPacket().boundaryEdit.handles.map(h=>h.coordinate));const original=await coords();
 const location=async()=>page.locator('.country-vertex:not(.fixed-boundary-vertex)').evaluateAll(nodes=>nodes.map(node=>({node,r:node.getBoundingClientRect()})).filter(({node,r})=>r.x>=2&&r.y>180&&r.bottom<700&&r.right<388&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===node).map(({r})=>[r.x+r.width/2,r.y+r.height/2])[0]);
 let p=await location();expect(p).toBeTruthy();await send('touchStart',[p]);await send('touchEnd',[]);
 if(await page.locator('#objectChooser').isVisible())await page.locator('#objectChooserList button').first().click();
 await expect.poll(()=>page.evaluate(()=>!!window.__editingTestDomains().editingDomain.snapshot().selectedVertex)).toBe(true);expect(await coords()).toEqual(original);
 p=await location();await send('touchStart',[p]);await send('touchMove',[[p[0]+3,p[1]+2]]);await send('touchEnd',[]);expect(await coords()).toEqual(original);
 p=await location();await send('touchStart',[p]);await send('touchMove',[[p[0]-18,p[1]+12]]);await expect(page.locator('.editing-magnifier')).toBeVisible();await send('touchEnd',[]);
 await expect.poll(()=>page.evaluate(()=>window.__editingTestDomains().editingDomain.snapshot().boundaryDraft.historyCount)).toBe(1);const moved=await coords();expect(moved).not.toEqual(original);
 p=await location();console.log('pinch target',p);await page.evaluate(()=>{window.__touchTrace=[];document.addEventListener('pointerdown',e=>window.__touchTrace.push([e.type,e.clientX,e.clientY,e.target.id,e.target.getAttribute('class')]),true);});await send('touchStart',[p]);await send('touchMove',[[p[0]-14,p[1]+10]]);const second=await page.evaluate(p=>[[-50,0],[50,0],[0,-50],[0,50]].map(d=>[p[0]+d[0],p[1]+d[1]]).find(q=>document.elementFromPoint(...q)?.closest('svg')),p);console.log('second',second);await send('touchStart',[[p[0]-14,p[1]+10],second]);await send('touchEnd',[]);console.log('pinch trace',await page.evaluate(()=>({events:window.__touchTrace,rev:window.__editingTest.lifecycleUi.mapInputController.pointerRevision(),snapshot:window.__editingTestDomains().editingDomain.snapshot().boundaryDraft})));
 await expect.poll(coords).toEqual(moved);expect(await page.evaluate(()=>window.__editingTestDomains().editingDomain.snapshot().boundaryDraft.historyCount)).toBe(1);
 await expect(page.locator('#vertexPlacementBtn')).toBeVisible();await page.locator('#vertexPlacementBtn').click();await expect(page.locator('#modeTaskInput')).toContainText('위치');
 await page.keyboard.press('Escape');expect(await page.evaluate(()=>window.__editingTestDomains().editingDomain.snapshot().vertexPlacement)).toBe(false);expect(await coords()).toEqual(moved);expect(errors).toEqual([]);
}
