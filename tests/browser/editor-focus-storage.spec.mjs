import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {gotoEditor} from './helpers/editor-entry.mjs';

async function boot(page,query='?debug=1') {
 const errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>requests.push(new URL(request.url()).pathname));
 await page.route('**/modules/app-domain-assembly.js*',async route=>{
   const source=await(await route.fetch()).text();
   await route.fulfill({contentType:'text/javascript',body:source.replace('dependencies = ports;',
     'dependencies = ports;window.__focusPorts=ports;window.__focusDomain=()=>projectDomain;')});
 });
 await gotoEditor(page,'/'+query);
 await expect(page.locator('#app')).toHaveAttribute('data-readiness',/editable|enhanced/,{timeout:90000});
 return {errors,requests};
}

test('app keeps temporary viewing outside the document, keeps viewing outside saved files and loads backgrounds only on request',async({page})=>{
 test.setTimeout(150000);
 const {errors,requests}=await boot(page);
 await expect(page.locator('[data-map-display-group="terrain"]')).toHaveCount(0);
 expect(await page.evaluate(()=>window.__focusPorts.projectState.state.projection)).toBe('flat');
 await expect(page.locator('#globeBtn,#flatBtn,#mapProjectionMenuTrigger,[data-map-background],.globe-shadow,.map-ocean-globe')).toHaveCount(0);
 const flatPolicy=await page.evaluate(()=>{
   const ports=window.__focusPorts,domain=window.__focusDomain(),host=window.__PANDOLAB_MAP_HOST__;
   const before={project:domain.snapshot(),state:domain.state()};
   const refused=[];
   for(const change of [()=>host.setProjectionKind('globe'),()=>host.setViewState({projection:'globe'}),()=>ports.mapSettingsUi.setProjection('globe')]) {
     try {change();refused.push('accepted');}catch(error){refused.push(error.code);}
   }
   ports.persistence.applyAutosavedView({documentId:before.project.documentId,projection:'globe',view:{globeRotation:[-114.17,-22.27,0],globeZoom:4}});
   const camera=host.getViewState(),after={project:domain.snapshot(),state:domain.state()};
   return {before,after,refused,camera};
 });
 expect(flatPolicy.refused).toEqual(Array(3).fill('PL-PRODUCT-PROJECTION'));
 expect(flatPolicy.camera.projection).toBe('flat');expect(flatPolicy.camera.flatCenter[0]).toBeCloseTo(114.17);expect(flatPolicy.camera.flatCenter[1]).toBeCloseTo(22.27);
 expect(flatPolicy.after).toEqual(flatPolicy.before);
 const backgroundRequests=()=>requests.filter(path=>/assets\/data\/(terrain|hydro|places)/.test(path));
 expect(backgroundRequests()).toEqual([]);
 expect(requests.some(path=>path.includes('reference-image-bootstrap'))).toBe(false);
 const seed=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json',import.meta.url)));
 seed.projectSetup.initialMonth='1914-06';
 await page.evaluate(async seed=>window.__focusDomain().load(seed),seed);
 const before=await page.evaluate(()=>({project:window.__focusDomain().snapshot(),checkpoint:window.__focusDomain().state().checkpoint}));
 await page.evaluate(async()=>{
   await window.__focusPorts.territorialModel.entityStore.setTimelineCursor('1914-07');
   await window.__focusDomain().executeCommand({commandId:'presentation.apply',targets:[],payload:{action:'visibility',key:'objects',visible:false}});
 });
 const after=await page.evaluate(()=>({project:window.__focusDomain().snapshot(),checkpoint:window.__focusDomain().state().checkpoint,visible:window.__focusPorts.projectState.state.layerVisibility.objects}));
 expect(after.visible).toBe(false);expect(after.project).toEqual(before.project);expect(after.checkpoint).toBe(before.checkpoint);
 await expect(page.locator('#projectSettingsBtn,#projectSetupCaptureDefault,#projectSetupResetDefault')).toHaveCount(0);
 const stored=await page.evaluate(async()=>(await window.__focusDomain().buildFileSnapshot()).project);
 expect(stored.projectSetup.initialMonth).toBe('1914-06');
 for(const key of ['defaultView','layerVisibility','itemVisibility'])expect(Object.hasOwn(stored,key)).toBe(false);
 await page.locator('#mapDisplayBtn').click();
 await expect(page.locator('[data-map-background="builtinHydro"],[data-map-background="builtinPlaces"]')).toHaveCount(0);
 await page.locator('[data-map-display-row="rivers"]').click();
 await page.locator('label[for="riversVisible"],label:has(#riversVisible)').click();
 await page.locator('label[for="riversVisible"],label:has(#riversVisible)').click();
 await expect.poll(()=>backgroundRequests().some(path=>path.includes('/hydro/')),{timeout:20000}).toBe(true);
 await page.locator('[data-map-display-row="labels"]').click();
 await page.locator('label[for="labelsVisible"],label:has(#labelsVisible)').click();
 await page.locator('label[for="labelsVisible"],label:has(#labelsVisible)').click();
 await expect.poll(()=>backgroundRequests().some(path=>path.includes('/places/')),{timeout:20000}).toBe(true);
 expect(backgroundRequests().some(path=>path.includes('/terrain'))).toBe(false);
 expect(await page.evaluate(()=>window.__focusDomain().snapshot())).toEqual(before.project);
 expect(errors).toEqual([]);
});

test('phone Canvas startup retains the editor and has no terrain or eager builtin data',async({browser})=>{
 test.setTimeout(120000);
 const context=await browser.newContext({viewport:{width:640,height:360},hasTouch:true,isMobile:true});
 await context.addInitScript(()=>{Object.defineProperty(navigator,'deviceMemory',{get:()=>2});Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2});});
 const page=await context.newPage();
 try {
   const {errors,requests}=await boot(page,'?debug=1&renderer=canvas');
   expect(await page.evaluate(()=>window.__focusPorts.projectState.state.projection)).toBe('flat');
   await expect(page.locator('#globeBtn,#flatBtn,[data-map-background],.globe-shadow,.map-ocean-globe')).toHaveCount(0);
   expect(requests.filter(path=>/assets\/data\/(terrain|hydro|places)/.test(path))).toEqual([]);
   await page.locator('#mobileMenuBtn').click();
   await page.locator('#mobileDisplayBtn').click();
   await expect(page.locator('#mapDisplaySurface')).toBeVisible();
   await page.locator('#mapDisplayCloseBtn').click();
   await expect(page.locator('#mapDisplaySurface')).not.toBeVisible();
   expect(errors).toEqual([]);
 } finally {await context.close();}
});
