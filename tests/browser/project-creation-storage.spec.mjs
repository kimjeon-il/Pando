import {test,expect} from '@playwright/test';
import {gotoEditor} from './helpers/editor-entry.mjs';
import {createViewerProjectPackage} from '../fixtures/viewer-project-package.mjs';
import {setViewingLayer} from './helpers/viewing-display.mjs';

test('one creation form validates before replacement and stores only initial setup',async({page})=>{
 test.setTimeout(120000);const errors=[];let failBoot;
 const failed=new Promise((_,reject)=>{failBoot=reject;});
 page.on('pageerror',error=>{errors.push(error.message);failBoot(error);});
 page.on('console',message=>{if(message.type()==='error'&&message.text().includes('[PL-BOOT'))failBoot(new Error(message.text()));});
 await page.route('**/modules/app-domain-assembly.js*',async route=>{const source=await(await route.fetch()).text();await route.fulfill({contentType:'text/javascript',body:source.replace('dependencies = ports;','dependencies = ports;window.__creationPorts=ports;window.__creationDomain=()=>projectDomain;')});});
 await Promise.race([(async()=>{await gotoEditor(page,'/?renderer=canvas');await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});})(),failed]);
 const before=await page.evaluate(()=>window.__creationDomain().snapshot());
 await page.locator('#mobileFileBtn').click();await expect(page.locator('#projectSettingsBtn')).toHaveCount(0);await page.locator('#newProjectBtn').click();
 await expect(page.locator('#projectSetupDialog')).toBeVisible();await expect(page.locator('#projectSetupDefaultActions')).toHaveCount(0);
 await page.locator('#projectSetupCancel').click();expect(await page.evaluate(()=>window.__creationDomain().snapshot())).toEqual(before);
 await page.locator('#mobileFileBtn').click();await page.locator('#newProjectBtn').click();
 await page.locator('#projectSetupMonth').fill('0000-01');await page.locator('#projectSetupSubmit').click();await expect(page.locator('#projectSetupError')).not.toBeEmpty();
 expect(await page.evaluate(()=>window.__creationDomain().snapshot())).toEqual(before);
 await page.locator('#projectSetupMonth').fill('-0044-03');await page.locator('#projectSetupLimited').check();await page.locator('#projectSetupStart').fill('-0500-01');await page.locator('#projectSetupEnd').fill('0100-12');await page.locator('#projectSetupSource').selectOption('empty');await page.locator('#projectSetupSubmit').click();
 await expect(page.locator('#projectSetupDialog')).not.toBeVisible({timeout:30000});
 const result=await page.evaluate(async()=>({project:(await window.__creationDomain().buildFileSnapshot()).project,state:window.__creationDomain().state()}));
 expect(result.project.documentId).not.toBe(before.documentId);expect(result.project.projectSetup).toEqual({initialMonth:'-0044-03',timelineRange:{start:'-0500-01',end:'0100-12'},initialMapBounds:null,sourceMode:'empty'});
 expect(result.project.territorialEntities).toEqual([]);expect(result.state.timelineCursor).toBe('-0044-03');
 for(const key of ['defaultView','layerVisibility','itemVisibility'])expect(Object.hasOwn(result.project,key)).toBe(false);
 expect(result.project.distributionSettings).toEqual({renderMode:'overlap',activeLayerId:'',boundaryVisible:true});expect(errors).toEqual([]);
});

test('viewer persists own-document display choices without reading or replacing editor autosaves',async({page})=>{
 test.setTimeout(120000);const sample=await createViewerProjectPackage('기기별 보기 시험');const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/?debug=1&renderer=canvas');await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
 const original={schemaVersion:13,documentId:'preserve-old-autosave',content:'original'};
 await page.evaluate(async original=>{localStorage.setItem('pandolab-editor-project',JSON.stringify(original));await new Promise((resolve,reject)=>{const request=indexedDB.open('pandolab-editor',2);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(original,'active-project');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});},original);
 const open=()=>page.evaluate(bytes=>window.__PANDOLAB_VIEWER__.openFile(new File([new Uint8Array(bytes)],'workspace.gpkg')),[...sample.bytes]);
 await open();const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
 await page.locator('#mapDisplayBtn').click();await setViewingLayer(page,'objects',false);
 const read=()=>page.evaluate(id=>new Promise((resolve,reject)=>{const request=indexedDB.open('pandolab-editor',2);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readonly'),get=tx.objectStore('projects').get('active-view:'+id);get.onsuccess=()=>{db.close();resolve(get.result||null);};get.onerror=()=>reject(get.error);};request.onerror=()=>reject(request.error);}),sample.project.documentId);
 await expect.poll(read).toMatchObject({documentId:sample.project.documentId,viewingPresentation:{layerVisibility:{objects:false}}});
 await page.locator('#mapDisplayBtn').click();await open();await page.locator('#mapDisplayBtn').click();
 const row=page.locator('[data-map-display-row="objects"]');if(await row.getAttribute('aria-expanded')!=='true')await row.click();
 await expect(page.locator('#objectsVisible')).not.toBeChecked();
 expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pandolab-editor-project')))).toEqual(original);
 const saved=await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('pandolab-editor',2);request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('active-project');get.onsuccess=()=>{db.close();resolve(get.result);};};}));expect(saved).toEqual(original);expect(errors).toEqual([]);
});
