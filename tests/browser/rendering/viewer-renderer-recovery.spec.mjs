import { test as featureTest } from '@playwright/test';
import * as __suiteDependency0 from "@playwright/test";
import * as __suiteDependency1 from "../helpers/viewer-acceptance.mjs";
import * as __suiteDependency2 from "node:fs";
import * as __suiteDependency3 from "node:path";
import * as __suiteDependency4 from "node:crypto";
import * as __suiteDependency5 from "@playwright/test";
import * as __suiteDependency6 from "node:fs/promises";
import * as __suiteDependency7 from "node:assert/strict";
import * as __suiteDependency8 from "node:fs/promises";
import * as __suiteDependency9 from "node:http";
import * as __suiteDependency10 from "node:path";
import * as __suiteDependency11 from "@playwright/test";
featureTest.use({trace:'off',launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']}});

// Preserved Viewer feature contract: viewer-renderer-recovery.spec.mjs
featureTest.describe("viewer-renderer-recovery", () => {
  const {  test, expect  } = __suiteDependency0;
  const {  waitForCanonicalMap  } = __suiteDependency1;
  const {  mkdirSync, writeFileSync  } = __suiteDependency2;
  const {  join, resolve  } = __suiteDependency3;
  const {  createHash  } = __suiteDependency4;
// Keep renderer-specific fixtures and failure evidence scoped to each contract family.


test.describe("Real context loss and repeated restoration", () => {
test.use({viewport:{width:1280,height:900},actionTimeout:10000});
test.setTimeout(200000);
const hash=value=>createHash('sha256').update(value).digest('hex');
const observed={'gpu-map-renderer.js':['createGpuMapRenderer','renderer'],'document-session.js':['createDocumentSession','session'],'rendering-domain.js':['createRenderingDomain','rendering'],'map-visual-frame.js':['createMapVisualFrame','frame']};
async function observe(page){
 await page.addInitScript(()=>{globalThis.__viewerAcceptance={};});
 await page.route(/\/modules\/(gpu-map-renderer|document-session|rendering-domain|map-visual-frame)\.js(?:\?|$)/,async route=>{
  const file=new URL(route.request().url()).pathname.split('/').at(-1),[name,key]=observed[file];
  const response=await route.fetch();let source=await response.text();const anchor=`export function ${name}(`;
  expect(source.split(anchor).length).toBe(2);
  // Read-only factory observations: no changes inside drawing or approval code.
  source=source.replace(anchor,`function original${name}(`)+`\nexport function ${name}(...args){const value=original${name}(...args);globalThis.__viewerAcceptance.${key}=value;return value;}\n`;
  await route.fulfill({response,body:source});
 });
}
async function state(page){return page.evaluate(()=>{
 const o=globalThis.__viewerAcceptance||{},v=globalThis.__PANDOLAB_VIEWER__,f=o.frame,world=o.session?.documentModel.world(),status=document.getElementById('viewerStatus');
 return {boot:{url:location.href,readyState:document.readyState,viewerReady:status?.dataset.ready??null,statusText:status?.textContent?.slice(0,1200)||'',coreLoaded:!!globalThis.PandoLabSphericalCore,observerOwners:Object.keys(o),resizableMemorySupported:typeof globalThis.WebAssembly?.Memory?.prototype?.toResizableBuffer==='function'},
  runtime:o.renderer?.getRuntimeState(),stats:o.renderer?.getStats({detailed:false}),state:v?.documentState(),document:v?JSON.stringify(v.documentSnapshot()):null,
  world:world?{month:world.month,epoch:world.sourceEpoch,count:world.entities?.length}:null,selection:v?.selectionSnapshot(),rendering:o.rendering?.getStats(),
  camera:f?{projection:f.projection,scale:f.cssScale,translate:f.cssTranslate,rotation:f.viewState?.rotation,flatCenter:f.viewState?.flatCenter}:null};
});}
async function ready(page,backend){await expect.poll(async()=>{const s=await state(page),r=s.runtime;return !!(r?.canonicalMeshReady&&!r.projectRenderBlocked&&!r.temporalPresentationPending&&r.surfacePresentation?.quality==='canonical'&&r.countriesPublishedGeneration===r.projectGeneration&&s.rendering?.lastCommittedVisualFrameId>0&&r.renderer===backend);},{timeout:65000}).toBe(true);}
async function pixels(page,first,second){return page.evaluate(async({first,second})=>{
 async function decode(encoded){const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data};}
 const a=await decode(first),b=await decode(second);if(a.width!==b.width||a.height!==b.height)return{sameSize:false};
 let changed=0,error=0;const colors=new Set();for(let i=0;i<a.data.length;i+=4){let max=0;for(let k=0;k<3;k++){const d=Math.abs(a.data[i+k]-b.data[i+k]);error+=d;max=Math.max(max,d);}if(max>20)changed++;if(i%400===0)colors.add((b.data[i]<<16)|(b.data[i+1]<<8)|b.data[i+2]);}
 return{sameSize:true,changedFraction:changed/(a.width*a.height),meanChannelError:error/(a.width*a.height*3),colors:colors.size};
},{first:first.toString('base64'),second:second.toString('base64')});}
async function selectCountry(page){
 const box=await page.locator('#map').boundingBox();
 const points=await page.evaluate(()=>[[2,46],[68,48],[103,46],[-50,-10],[135,-25],[-100,40],[30,0]].map(p=>globalThis.__viewerAcceptance.frame.projectVisibleCoordinate(p)).filter(p=>p&&p.every(Number.isFinite)));
 for(const p of points){if(p[0]<4||p[1]<4||p[0]>box.width-4||p[1]>box.height-4)continue;await page.mouse.click(box.x+p[0],box.y+p[1]);await page.waitForTimeout(250);if((await state(page)).selection?.items?.length){await page.mouse.move(3,3);return;}}
 throw Error('Visible map selection failed');
}
for(const backend of ['webgl2','webgl1'])test(`viewer acceptance ${backend}: repeated real recovery preserves displayed map`,async({page,browser})=>{
 const dir=resolve(process.env.G4_EVIDENCE||'gpu-viewer-evidence','acceptance-'+backend);mkdirSync(dir,{recursive:true});
 const result={backend,browser:browser.version(),gpu:'SwiftShader',rounds:[]},errors=[];page.on('pageerror',error=>errors.push(String(error.stack||error)));
 const consoleEvents=[],consoleCaptures=[],requestFailures=[],httpFailures=[];
 page.on('console',message=>{
  if(!['error','warning'].includes(message.type())||consoleEvents.length>=24)return;
  const row={type:message.type(),text:message.text().slice(0,4000),location:message.location()};consoleEvents.push(row);
  consoleCaptures.push(Promise.allSettled(message.args().slice(0,2).map(handle=>handle.evaluate(value=>
   value&&typeof value==='object'?{name:String(value.name||'').slice(0,200),message:String(value.message||value).slice(0,2000),code:String(value.code||'').slice(0,200),stack:String(value.stack||'').slice(0,4000)}:String(value).slice(0,2000))))
   .then(values=>{row.arguments=values.map(value=>value.status==='fulfilled'?value.value:{captureError:String(value.reason).slice(0,1000)});}));
 });
 page.on('requestfailed',request=>{if(requestFailures.length<24)requestFailures.push({url:request.url(),failure:request.failure()?.errorText||''});});
 page.on('response',response=>{if(response.status()>=400&&httpFailures.length<24)httpFailures.push({url:response.url(),status:response.status()});});
 try{
  await observe(page);await page.goto(`/?renderer=${backend}&debug=1`,{waitUntil:'domcontentloaded'});await ready(page,backend);
  for(const year of [2000,2001]){
   await page.locator('#timelineDateButton').click();await page.locator('#timelineYearInput').fill(String(year));await page.locator('#timelineGoBtn').click();
   await expect.poll(async()=>(await state(page)).state?.timelineCursor,{timeout:45000}).toBe(`${year}-12`);await ready(page,backend);await selectCountry(page);await page.waitForTimeout(750);
   const before=await state(page);expect(before.world.month).toBe(before.state.timelineCursor);expect(before.world.epoch).toBe(before.state.epoch);expect(before.selection.items.length).toBeGreaterThan(0);
   const imageBefore=await page.locator('#map').screenshot({path:join(dir,`${year}-before.png`),animations:'disabled',timeout:30000});
   const available=await page.evaluate(()=>{const d=globalThis.__viewerAcceptance.renderer.getRenderDevice(),extension=d.gl.getExtension('WEBGL_lose_context');if(!extension)return false;const loss={extension,lost:false,restored:false};globalThis.__acceptanceLoss=loss;d.canvas.addEventListener('webglcontextlost',()=>loss.lost=true,{once:true});d.canvas.addEventListener('webglcontextrestored',()=>loss.restored=true,{once:true});extension.loseContext();return true;});
   expect(available).toBe(true);await expect.poll(()=>page.evaluate(()=>globalThis.__acceptanceLoss.lost)).toBe(true);await page.waitForTimeout(150);await page.evaluate(()=>globalThis.__acceptanceLoss.extension.restoreContext());
   await expect.poll(()=>page.evaluate(()=>globalThis.__acceptanceLoss.restored),{timeout:10000}).toBe(true);
   await expect.poll(async()=>(await state(page)).stats.gpuRecovery.phase,{timeout:35000}).toBe('complete');
   await waitForCanonicalMap(page,{timeout:35000});
   await ready(page,backend);await page.waitForTimeout(500);
   const after=await state(page);expect(hash(after.document)).toBe(hash(before.document));expect(after.state.timelineCursor).toBe(before.state.timelineCursor);expect(after.world).toEqual(before.world);expect(after.selection).toEqual(before.selection);expect(after.camera).toEqual(before.camera);
   expect(after.rendering.lastCommittedVisualFrameId).toBeGreaterThan(before.rendering.lastCommittedVisualFrameId);expect(after.stats.gpuRecovery.timerPending).toBe(false);
   const difference=await pixels(page,imageBefore,await page.locator('#map').screenshot({path:join(dir,`${year}-restored.png`),animations:'disabled',timeout:30000}));
   expect(difference.sameSize).toBe(true);expect(difference.colors).toBeGreaterThan(8);expect(difference.changedFraction).toBeLessThan(0.03);expect(difference.meanChannelError).toBeLessThan(2);
   result.rounds.push({year,documentSha256:hash(after.document),selection:after.selection,camera:after.camera,world:after.world,recovery:after.stats.gpuRecovery,frame:after.rendering.lastCommittedVisualFrameId,difference});
  }
  expect(errors).toEqual([]);result.passed=true;
 }catch(error){result.error=String(error.stack||error);throw error;}finally{
  await Promise.allSettled(consoleCaptures);result.bootDiagnostics={consoleEvents,requestFailures,httpFailures};
  result.errors=errors;try{const s=await state(page);delete s.document;result.final=s;await page.screenshot({path:join(dir,'final.png'),timeout:5000});}catch(error){result.captureError=String(error);}
  writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('VIEWER_ACCEPTANCE '+JSON.stringify(result));
 }
});
});
});
// Preserved Viewer feature contract: gpu-scene-staging.spec.mjs
featureTest.describe("gpu-scene-staging", () => {
  const {  expect, test  } = __suiteDependency5;
  const {  writeFile  } = __suiteDependency6;

test('real WebGL strokes retain A through partial uploads and present all of B before releasing A', async ({ page }) => {
  await page.route('**/m3-staging-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>M3 GPU frame evidence</title>' }));
  await page.goto('/m3-staging-fixture');
  const evidence = await page.evaluate(async () => {
    const { createRenderSceneBuilder } = await import('/assets/js/modules/render-scene.js');
    const { createGpuStrokeRenderer } = await import('/assets/js/modules/gpu-stroke-renderer.js');
    const { createRenderDevice } = await import('/assets/js/modules/render-device.js');
    const { createGpuUploadScheduler } = await import('/assets/js/modules/gpu-upload-scheduler.js');
    const { createMapVisualFrame } = await import('/assets/js/modules/map-visual-frame.js');
    const { prepareGpuBaseScene, commitGpuStrokeDomains } = await import('/assets/js/modules/gpu-scene-preparation.js');
    const { drawGpuBaseScene } = await import('/assets/js/modules/gpu-base-scene-pass.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { stencil: true, preserveDrawingBuffer: true });
    const errors = [], ready = [], callbacks = [];
    const strokeRenderer = createGpuStrokeRenderer({ onError: value => errors.push({ stage: value.stage, message: value.error?.message }),
      onResourceReady: key => ready.push(key) });
    if (!strokeRenderer.initialize(createRenderDevice({ gl, canvas }))) throw new Error('Real stroke initialization failed');
    const scheduler = createGpuUploadScheduler({ requestFrame: callback => (callbacks.push(callback), callbacks.length), cancelFrame() {},
      isHidden: () => false, isInputPending: () => false });
    const presentedStrokeDomains = new Map(), builder = createRenderSceneBuilder();
    const scene = (revision, sign) => builder.build({ strokes: [2, 4].map((latitude, index) => ({ key: `boundary:${index}`,
      domain: 'territorial-boundaries', geometryRevision: revision, geometry: { type: 'LineString', coordinates: [[-3, sign * latitude], [3, sign * latitude]] },
      style: { color: '#3366ff', width: 4, alpha: 1 } })) });
    let id = 0;
    const rows = [];
    const draw = desired => {
      const frame = createMapVisualFrame({ frameId: ++id, projectGeneration: 9, viewRevision: id,
        viewState: { projection: 'flat', translate: [64, 64], scale: 500, dpr: 1, size: { width: 128, height: 128 }, flatCenter: [0, 0] } });
      const prepared = prepareGpuBaseScene({ frame, scene: desired, presentedStrokeDomains }, { strokeRenderer });
      const result = drawGpuBaseScene({ gl, frame, width: 128, height: 128, countriesVisible: false, terrainVisible: false,
        surfacePresentation: { quality: 'pending' },
        countries: {}, prepared }, { strokeRenderer, drawOceanSubstrate() {}, renderTerrain() {}, drawHydro() {}, drawCountryBoundaryStrokes() {} });
      const pixels = sign => [2, 4].map(latitude => {
        const point = frame.projectVisibleCoordinate([0, sign * latitude]);
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(point[0]), 127 - Math.floor(point[1]), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      });
      const before = strokeRenderer.stats().resourceCount;
      commitGpuStrokeDomains(result, frame, presentedStrokeDomains, strokeRenderer);
      rows.push({ frameId: id, revisions: prepared.overlayItems.map(item => item.packet.geometryRevision),
        oldPixels: pixels(-1), newPixels: pixels(1), before, after: strokeRenderer.stats().resourceCount,
        pending: [...prepared.deferredOverlayKeys], missing: result.overlayMissingKeys,
        recovered: result.recoveredStrokeDomains, presentationFailed: result.strokePresentationFailed,
        presentedRevisions: (presentedStrokeDomains.get('territorial-boundaries') || []).map(item => item.packet.geometryRevision) });
      return prepared;
    };
    const a = scene(1, -1), b = scene(2, 1);
    draw(a); strokeRenderer.setUploadScheduler(scheduler);
    draw(b);
    // Drain the real shared scheduler until only the first replacement has
    // completed. No GPU resource, pixels or preparation result is mocked.
    for (let count = 0; ready.length < 1 && count < 100; count++) callbacks.shift()?.();
    draw(b);
    for (let count = 0; ready.length < 2 && count < 100; count++) callbacks.shift()?.();
    if (ready.length !== 2) throw new Error('Actual replacement uploads did not finish');
    // Fail a real GL submission after successful upload. The production pass
    // must redraw A in this same frame; it cannot publish a partial B.
    const actualDraw = gl.drawArraysInstanced.bind(gl);
    let failOnce = true;
    gl.drawArraysInstanced = (...args) => { if (failOnce) { failOnce = false; throw new Error('M3 injected GPU draw failure'); } actualDraw(...args); };
    draw(b);
    gl.drawArraysInstanced = actualDraw;
    const preparedB = draw(b);
    const staleKey = preparedB.overlayItems[0].resourcePacket.key;
    // Deletion clears the domain and releases its displayed resources too.
    draw({ ...b, strokes: [] });
    const deleted = !strokeRenderer.hasResource(staleKey);
    const obsolete = { ...preparedB.overlayItems[0].resourcePacket, key: 'scene-stroke:9:obsolete-upload', geometryRevision: 3 };
    strokeRenderer.ensureResource(obsolete);
    callbacks.shift()?.(); // Allocate a real staging buffer before cancellation.
    strokeRenderer.retain([]);
    for (let count = 0; callbacks.length && count < 100; count++) callbacks.shift()();
    const cancelledUpload = !strokeRenderer.hasResource(obsolete.key) && !ready.includes(obsolete.key);
    const finalStats = strokeRenderer.stats();
    scheduler.dispose(); strokeRenderer.dispose();
    return { rows, ready, errors, deleted, cancelledUpload, finalStats };
  });
  expect(evidence.errors).toEqual([{ stage: 'gpu-stroke-draw', message: 'M3 injected GPU draw failure' }]);
  expect(evidence.rows.map(row => row.revisions)).toEqual([[1, 1], [1, 1], [1, 1], [2, 2], [2, 2], []]);
  for (const row of evidence.rows.slice(0, 4)) {
    expect(row.oldPixels.every(pixel => pixel[2] > 150 && pixel[3] > 0)).toBe(true);
    expect(row.newPixels.every(pixel => pixel[3] === 0)).toBe(true);
    expect(row.missing).toEqual([]);
  }
  expect(evidence.rows[3].recovered).toEqual(['territorial-boundaries']);
  expect(evidence.rows[3].presentedRevisions).toEqual([1, 1]);
  expect(evidence.rows[3].before).toBe(4);
  expect(evidence.rows[3].after).toBe(4);
  expect(evidence.rows[4].newPixels.every(pixel => pixel[2] > 150 && pixel[3] > 0)).toBe(true);
  expect(evidence.rows[4].oldPixels.every(pixel => pixel[3] === 0)).toBe(true);
  expect(evidence.rows[4].before).toBe(4);
  expect(evidence.rows[4].after).toBe(2);
  expect(evidence.deleted).toBe(true);
  expect(evidence.cancelledUpload).toBe(true);
  expect(evidence.finalStats.resourceCount).toBe(0);
  await writeFile(test.info().outputPath('gpu-domain-frames.json'), JSON.stringify(evidence, null, 2));
});
});
// Preserved Viewer feature contract: country-border-coverage.spec.mjs
featureTest.describe("country-border-coverage", () => {
  const assert = __suiteDependency7.default;
  const {  readFile  } = __suiteDependency8;
  const {  createServer  } = __suiteDependency9;
  const path = __suiteDependency10.default;
  const {  test  } = __suiteDependency11;
test('country and interaction coverage stay uniform across dense joins and preserve GPU state and resources', async ({ page }) => {
  test.setTimeout(60_000);
  const root = process.cwd();
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><body>'); return; }
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) throw new Error('Outside test root');
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const proof = await page.evaluate(async () => {
      const { createGpuStrokeRenderer } = await import('/src/rendering/gpu-stroke-renderer.js');
      const { createRenderDevice } = await import('/src/rendering/render-device.js');
      const { resolveMapStrokeStyle, resolveMapInteractionStyle } = await import('/src/map/map-interaction-style.js');
      const results = [];
      for (const version of [2, 1]) for (const dpr of [1, 2]) for (const role of ['country', 'hover', 'secondary', 'primary']) {
        const canvas = globalThis.document.createElement('canvas'); canvas.width = 256 * dpr; canvas.height = 64 * dpr;
        const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', { alpha: true, antialias: false, preserveDrawingBuffer: true });
        if (!gl) throw new Error(`WebGL${version} unavailable`);
        const errors = [], renderer = createGpuStrokeRenderer({ onError: event => errors.push(event.error.message) });
        if (!renderer.initialize(createRenderDevice({ gl, canvas, version }))) throw new Error('Stroke initialization failed');
        const counts = { textures: 0, textureDeletes: 0, framebuffers: 0, framebufferDeletes: 0, storage: 0 };
        for (const [method, counter] of [['createTexture', 'textures'], ['deleteTexture', 'textureDeletes'], ['createFramebuffer', 'framebuffers'], ['deleteFramebuffer', 'framebufferDeletes'], ['texImage2D', 'storage']]) {
          const original = gl[method].bind(gl); gl[method] = (...args) => { counts[counter]++; return original(...args); };
        }
        const marker = gl.createTexture(); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, marker);
        const frame = { viewport: [canvas.width, canvas.height], translate: [0, 32.25 * dpr], scale: 180 / Math.PI * dpr,
          dpr, rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1], flatCenter: [0, 0], mode: 1, worldOffsets: [0] };
        const stroke = resolveMapStrokeStyle(role === 'country'
          ? { theme: { border: '#ffffff', borderAlpha: 1 } }
          : resolveMapInteractionStyle(), role);
        function draw(key, step, alpha = 1, multiply = false, duplicate = false) {
          const values = [];
          for (let x = 32; x < 224; x += step) values.push(x, 0, Math.min(x + step, 224), 0);
          const coords = duplicate ? [...values, ...values] : values;
          gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.colorMask(true, true, true, true);
          gl.viewport(0, 0, ...frame.viewport); gl.clearColor(0.2, 0.3, 0.4, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.enable(gl.SCISSOR_TEST); gl.scissor(8 * dpr, 8 * dpr, 240 * dpr, 48 * dpr);
          gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          const result = renderer.drawBatches([{ key, startsEnds: new Float32Array(coords),
            style: { ...stroke, alpha, color: multiply ? '#447799' : '#ffffff', blendMode: multiply ? 'multiply' : 'normal' } }], frame);
          const rgba = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          const interior = [];
          for (let y = 28 * dpr; y < 37 * dpr; y++) for (let x = 48 * dpr; x < 208 * dpr; x++) interior.push(...rgba.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4));
          const state = { framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING) === null,
            texture: gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE3 && gl.getParameter(gl.TEXTURE_BINDING_2D) === marker,
            viewport: Array.from(gl.getParameter(gl.VIEWPORT)), clear: Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)),
            scissor: gl.isEnabled(gl.SCISSOR_TEST), stencil: gl.isEnabled(gl.STENCIL_TEST),
            equation: gl.getParameter(gl.BLEND_EQUATION_RGB), error: gl.getError() };
          return { result, interior, state };
        }
        const sparse = draw('sparse', 192), dense = draw('dense', 1);
        const transparent = draw('alpha', 1, 0.4), repeated = draw('repeat', 1, 0.4, false, true);
        const multiply = draw('multiply', 192, 0.4, true), multiplyRepeated = draw('multiply-repeat', 1, 0.4, true, true);
        const maxDiff = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
        const beforeResize = { ...counts };
        canvas.width += 32 * dpr; frame.viewport[0] = canvas.width;
        draw('resized', 192);
        const afterResize = { ...counts };
        renderer.dispose();
        const afterDispose = { ...counts };
        results.push({ version, dpr, role, coverage: stroke.coverage,
          densityDifference: maxDiff(sparse.interior, dense.interior), duplicateDifference: maxDiff(transparent.interior, repeated.interior),
          multiplyDifference: maxDiff(multiply.interior, multiplyRepeated.interior),
          occupied: dense.interior.some((value, index) => index % 4 === 3 && value > 0),
          intermediate: dense.interior.some((value, index) => index % 4 === 3 && value > 0 && value < 255),
          states: [sparse, dense, transparent, repeated, multiply, multiplyRepeated].map(row => row.state),
          succeeded: [sparse, dense, transparent, repeated, multiply, multiplyRepeated].every(row => row.result.succeeded),
          beforeResize, afterResize, afterDispose, errors });
        gl.deleteTexture(marker); gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      return results;
    });
    for (const row of proof) {
      const label = `WebGL${row.version}/DPR${row.dpr}/${row.role}`;
      assert.equal(row.coverage, 'union', label);
      assert.ok(row.densityDifference <= 1, `${label}: density changed coverage by ${row.densityDifference}`);
      assert.ok(row.duplicateDifference <= 1, `${label}: alpha was applied more than once`);
      assert.ok(row.multiplyDifference <= 1, `${label}: multiply coverage accumulated`);
      assert.ok(row.occupied && row.intermediate && row.succeeded, label);
      assert.deepEqual(row.errors, [], label);
      for (const state of row.states) {
        assert.ok(state.framebuffer && state.texture && state.scissor && state.stencil, `${label}: GPU state leaked`);
        assert.deepEqual(state.viewport, [0, 0, 256 * row.dpr, 64 * row.dpr]);
        assert.equal(state.equation, 32774); assert.equal(state.error, 0);
        assert.ok(Math.abs(state.clear[0] - 0.2) < 1e-6);
      }
      assert.equal(row.beforeResize.textures, 2, `${label}: one reusable mask plus marker`);
      assert.equal(row.beforeResize.framebuffers, 1);
      assert.equal(row.beforeResize.storage, 1);
      assert.equal(row.afterResize.textures, row.beforeResize.textures);
      assert.equal(row.afterResize.storage, 2);
      assert.equal(row.afterDispose.textureDeletes, 1); assert.equal(row.afterDispose.framebufferDeletes, 1);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
});
