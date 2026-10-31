import {test,expect} from '@playwright/test';
import {gotoEditor,setEditorMonth} from './helpers/editor-entry.mjs';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

// Full product entry points and pinned data, never synthetic project fixtures.
test.use({viewport:{width:1280,height:900},trace:'off',actionTimeout:12000,launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
test.setTimeout(225000);
const evidence=resolve(process.env.G4_EVIDENCE||'test-results/gpu-g4');
const sha=text=>createHash('sha256').update(text).digest('hex');
const observers={
 'gpu-map-renderer.js':['createGpuMapRenderer','renderer'],
 'document-session.js':['createDocumentSession','session'],
 'selection-domain.js':['createSelectionDomain','selection'],
 'rendering-domain.js':['createRenderingDomain','rendering'],
 'map-visual-frame.js':['createMapVisualFrame','frame'],
};
async function observe(page,backend){
 await page.addInitScript(({backend})=>{
  globalThis.__g4={events:[],lifecycle:[]};
  for(const type of ['freeze','resume','visibilitychange'])document.addEventListener(type,()=>globalThis.__g4.lifecycle.push({type,visibility:document.visibilityState,at:performance.now()}));
  if(backend==='canvas2d')Object.defineProperty(globalThis,'OffscreenCanvas',{value:undefined,configurable:true});
 },{backend});
 await page.route(/\/modules\/(gpu-map-renderer|document-session|selection-domain|rendering-domain|map-visual-frame)\.js(?:\?|$)/,async route=>{
  const response=await route.fetch(),file=new URL(route.request().url()).pathname.split('/').at(-1);
  const [name,key]=observers[file],anchor=`export function ${name}(`;
  let source=await response.text();
  expect(source.split(anchor).length,`Observer anchor in ${file}`).toBe(2);
  source=source.replace(anchor,`function __g4Original${name}(`);
  let setup='';
  if(key==='renderer')setup=`const deps=args[0],status=deps.setActionStatus,context=deps.rendererUi.onContextStateChange;
   args[0]={...deps,setActionStatus(...values){observation.events.push({kind:'status',values,at:performance.now()});return Reflect.apply(status,deps,values);},rendererUi:{...deps.rendererUi,onContextStateChange(...values){observation.events.push({kind:'context',values,at:performance.now()});return context&&Reflect.apply(context,deps.rendererUi,values);}}};`;
  source+=`\nexport function ${name}(...args){const observation=globalThis.__g4;${setup}const value=__g4Original${name}(...args);observation.${key}=value;return value;}\n`;
  await route.fulfill({response,body:source});
 });
}
async function state(page){
 return page.evaluate(()=>{
  const o=globalThis.__g4||{},r=o.renderer?.getRuntimeState(),g=o.renderer?.getStats({detailed:false}),f=o.frame;
  const model=o.session?.documentModel,world=model?.world();
  return {runtime:r,stats:g,documentState:o.session?.commandOwner.state(),document:model?JSON.stringify(model.snapshot()):null,
   world:world?{month:world.month,epoch:world.sourceEpoch,count:world.entities?.length,ids:world.entities?.map(v=>v.objectRef?.id||v.id).sort()}:null,
   selection:o.selection?.snapshot().selection,
   camera:f?{projection:f.projection,scale:f.cssScale,translate:f.cssTranslate,rotation:f.viewState?.rotation,flatCenter:f.viewState?.flatCenter}:null,
   rendering:o.rendering?.getStats(),date:document.getElementById('timelineDateButtonText')?.textContent||document.getElementById('editorTimelineContext')?.textContent,
   status:document.getElementById('viewerStatus')?.textContent,events:o.events,lifecycle:o.lifecycle,visible:document.visibilityState};
 });
}
function small(s){const {document,...rest}=s;return {...rest,documentSha256:document?sha(document):null};}
async function ready(page,renderer=null){
 await expect.poll(async()=>page.evaluate(()=>{
  const o=globalThis.__g4,r=o?.renderer?.getRuntimeState();
  return !!(o?.session&&o?.selection&&r?.canonicalMeshReady&&!r.projectRenderBlocked&&!r.temporalPresentationPending&&r.firstCountryPublishedMs!==null&&r.countriesPublishedGeneration===r.projectGeneration&&o.rendering?.getStats().lastCommittedVisualFrameId>0);
 }),{timeout:105000,message:'Real map reaches canonical presented frame'}).toBe(true);
 if(renderer)expect((await state(page)).runtime.renderer).toBe(renderer);
 await page.waitForTimeout(500);
}
async function image(page,file){
 const rect=await page.evaluate(()=>{
  // Editor can replace the inner map node after selecting an object while
  // keeping the accessible map workspace and its rendered pixels alive.
  const host=document.querySelector('#map')||document.querySelector('[aria-label="지도 편집 영역"]')
    ||document.querySelector('[aria-label="지도 영역"]');
  const box=host?.getBoundingClientRect();
  return box&&box.width>0&&box.height>0 ? {x:box.x,y:box.y,width:box.width,height:box.height}:null;
 });
 expect(rect,'Visible map workspace must exist with nonzero dimensions').not.toBeNull();
 // Page clip captures the map pixels directly without Playwright waiting for an
 // ever-moving map element to become geometrically "stable" after GPU restore.
 const bytes=await page.screenshot({path:file,animations:'disabled',timeout:30000,
  clip:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}});
 return bytes.toString('base64');
}
async function pixels(page,first,second){
 return page.evaluate(async({first,second})=>{
  async function decode(encoded){const img=new Image();img.src='data:image/png;base64,'+encoded;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return {width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};}
  const a=await decode(first),b=await decode(second);if(a.width!==b.width||a.height!==b.height)return {sameSize:false};
  let changed=0,error=0;const colors=new Set();
  for(let i=0;i<a.data.length;i+=4){let max=0;for(let k=0;k<3;k++){const d=Math.abs(a.data[i+k]-b.data[i+k]);error+=d;max=Math.max(max,d);}if(max>20)changed++;if(i%400===0)colors.add((b.data[i]<<16)|(b.data[i+1]<<8)|b.data[i+2]);}
  return {sameSize:true,changedFraction:changed/(a.width*a.height),meanChannelError:error/(a.width*a.height*3),sampleColors:colors.size};
 },{first,second});
}
async function choose(page){
 const box=await page.locator('#map').boundingBox();expect(box).not.toBeNull();
 const points=await page.evaluate(()=>[[2,46],[68,48],[103,46],[-50,-10],[135,-25],[-100,40],[30,0],[80,22],[130,50]].map(p=>globalThis.__g4.frame?.projectVisibleCoordinate(p)).filter(p=>p&&p.every(Number.isFinite)));
 for(const p of points){if(p[0]<4||p[1]<4||p[0]>box.width-4||p[1]>box.height-4)continue;
  await page.mouse.click(box.x+p[0],box.y+p[1]);await page.waitForTimeout(250);
  if((await state(page)).selection?.items?.length)return;
 }
 throw Error('Actual map pointer selection did not select a visible document object');
}
async function changeYear(page,year,product){
 if(product==='editor'){
  // The editor deliberately has no date navigation controls. Exercise its real temporal owner.
  await setEditorMonth(page,`${year}-12`);
 }else{
  await page.locator('#timelineDateButton').click();
  await page.locator('#timelineYearInput').fill(String(year));
  await page.locator('#timelineGoBtn').click();
 }
 await expect.poll(async()=>(await state(page)).documentState?.timelineCursor,{timeout:45000}).toBe(`${year}-12`);
 await ready(page);
 if(product==='editor')await expect(page.locator('#editorTimelineContext')).toContainText(String(year));
 else await expect(page.locator('#timelineDateButtonText')).toContainText(String(year));
 const s=await state(page);expect(s.world?.month).toBe(s.documentState.timelineCursor);
 expect(s.world?.epoch).toBe(s.documentState.epoch);
}
async function lose(page){
 const available=await page.evaluate(()=>{
  const device=globalThis.__g4.renderer.getRenderDevice(),ext=device?.gl.getExtension('WEBGL_lose_context');
  if(!ext)return false;
  globalThis.__g4.loss={extension:ext,canvas:device.canvas,lost:false,restored:false};
  device.canvas.addEventListener('webglcontextlost',()=>{globalThis.__g4.loss.lost=true;},{once:true});
  device.canvas.addEventListener('webglcontextrestored',()=>{globalThis.__g4.loss.restored=true;},{once:true});
  ext.loseContext();return true;
 });
 expect(available,'WEBGL_lose_context is required; unsupported is not a pass').toBe(true);
 await expect.poll(()=>page.evaluate(()=>globalThis.__g4.loss.lost)).toBe(true);
 await page.waitForTimeout(150);
}
async function restore(page,backend){
 await page.evaluate(()=>globalThis.__g4.loss.extension.restoreContext());
 await expect.poll(()=>page.evaluate(()=>globalThis.__g4.loss.restored),{timeout:10000}).toBe(true);
 await expect.poll(async()=>(await state(page)).stats?.gpuRecovery?.phase,{timeout:35000}).toBe('complete');
 await ready(page,backend);
}
async function stable(page,before,picture,file){
 const after=await state(page);expect(sha(after.document)).toBe(sha(before.document));
 expect(after.documentState.timelineCursor).toBe(before.documentState.timelineCursor);
 expect(after.selection.items).toEqual(before.selection.items);
 expect(after.selection.primaryKey).toBe(before.selection.primaryKey);
 expect(after.camera).toEqual(before.camera);
 const diff=await pixels(page,picture,await image(page,file));
 expect(diff.sameSize).toBe(true);expect(diff.sampleColors,'Map must not become a uniform blank canvas').toBeGreaterThan(8);
 expect(diff.changedFraction,'Restored map pixels differ at fixed date/camera/selection').toBeLessThan(0.03);
 expect(diff.meanChannelError).toBeLessThan(2);
 return {after:small(after),diff};
}
for(const product of ['viewer','editor'])for(const backend of ['webgl2','webgl1','canvas-worker','canvas2d']){
 test(`${product} ${backend}: actual timeline selection recovery and lifecycle`,async({page,browser},info)=>{
  const dir=join(evidence,`${product}-${backend}`);mkdirSync(dir,{recursive:true});
  const errors=[],consoleErrors=[],requests=[],result={product,backend,browser:browser.version(),hardware:'CI SwiftShader software GPU',steps:[]};
  page.on('pageerror',e=>errors.push(String(e.stack||e)));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('requestfailed',r=>requests.push({url:r.url(),error:r.failure()?.errorText}));
  try{
   await observe(page,backend);const forced=backend.startsWith('canvas')?'canvas':backend;
   if(product==='editor')await gotoEditor(page,`/?renderer=${forced}&debug=1`,{waitUntil:'domcontentloaded'});
   else await page.goto(`/?renderer=${forced}&debug=1`,{waitUntil:'domcontentloaded'});
   await ready(page,backend);result.initial=small(await state(page));result.steps.push('initial full map');
   const initialPng=await image(page,join(dir,'01-initial.png'));const variation=await pixels(page,initialPng,initialPng);expect(variation.sampleColors).toBeGreaterThan(8);
   await changeYear(page,2000,product);result.year2000=small(await state(page));await image(page,join(dir,'02-year-2000.png'));result.steps.push('timeline 2000 document/screen');
   await choose(page);await page.waitForTimeout(500);const selected=await state(page),selectedPng=await image(page,join(dir,'03-selected.png'));
   expect(selected.selection.items.length).toBeGreaterThan(0);result.selected=small(selected);result.steps.push('actual pointer selection');
   if(backend.startsWith('webgl')){
    await lose(page);result.lost=small(await state(page));await restore(page,backend);
    result.recovery=await stable(page,selected,selectedPng,join(dir,'04-restored.png'));result.steps.push('actual WebGL loss/restore and pixel/document/selection agreement');
   }
   const beforeFreeze=await state(page),beforeFreezePng=await image(page,join(dir,'05-before-freeze.png'));
   const cdp=await page.context().newCDPSession(page);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
   await new Promise(resolve=>setTimeout(resolve,350));await cdp.send('Page.setWebLifecycleState',{state:'active'});await cdp.detach();
   await ready(page,backend);result.resume=await stable(page,beforeFreeze,beforeFreezePng,join(dir,'06-resumed.png'));
   // CDP acknowledgement proves the browser accepted frozen/active transitions; Chromium is not
   // required to emit DOM freeze/resume events for this particular protocol transition.
   result.browserLifecycle={cdpFrozenAndResumed:true,domEvents:result.resume.after.lifecycle.map(e=>e.type)};
   result.steps.push('real CDP browser frozen/active and document/pixel agreement');
   await changeYear(page,2001,product);result.year2001=small(await state(page));await image(page,join(dir,'07-year-2001.png'));result.steps.push('timeline after recovery');
   await page.setViewportSize({width:1024,height:768});await ready(page,backend);await image(page,join(dir,'08-resized.png'));result.steps.push('resize');
   expect(errors,'Unhandled application errors').toEqual([]);result.status='passed';
  }catch(error){result.status='failed';result.error=String(error.stack||error);throw error;}
  finally{
   result.pageErrors=errors;result.consoleErrors=consoleErrors;result.failedRequests=requests;
   try{result.final=small(await state(page));await page.screenshot({path:join(dir,'final-screen.png'),fullPage:false});}catch(error){result.captureError=String(error);}
   writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));await info.attach('g4-result',{path:join(dir,'result.json'),contentType:'application/json'});
  }
 });
}
