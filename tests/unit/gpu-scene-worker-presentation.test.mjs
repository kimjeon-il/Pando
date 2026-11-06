import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('after polygon preparation, Canvas Worker schedules a base redraw rather than interaction-only invalidation',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-scene.js',import.meta.url),'utf8');
  assert.match(source,/builder\.preparePolygons\([\s\S]*?\.then\(\(\) => \{[\s\S]*?syncGpuRenderScene\(\);[\s\S]*?mode === 'canvas-worker'[\s\S]*?requestPreparedCanvasFrame\?\.\(\);[\s\S]*?invalidateBaseScene\('canvas-scene-ready'\)/);
  assert.match(source,/else\s+dependencies\.domains\.renderingDomain\.invalidateGpuInteraction\('overlay-mesh-ready'\)/);
});

test('Canvas Worker scene redraw is a base invalidation retaining document and geometry state owners',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-scene.js',import.meta.url),'utf8');
  const prep=source.slice(source.indexOf('builder.preparePolygons('),source.indexOf('if (pendingPreparation) { pendingPreparation = null;'));
  assert.doesNotMatch(prep,/documentLoad\(|setTimelineCursor\(|replaceSnapshot\(|resetProjectGeneration\(|dispose\(/);
  assert.doesNotMatch(prep,/invalidateProject\(/);
});

test('prepared Canvas Worker frames are requested only for a live current project and physical scene',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const begin=source.indexOf('    function requestPreparedCanvasFrame() {');
  const end=source.indexOf('    function renderLatestVisualFrame() {',begin);
  assert.ok(begin>=0&&end>begin);
  const handoff=source.slice(begin,end);
  for(const contract of [/disposed/,/rendererMode !== 'canvas-worker'/,/projectRenderBlocked/,
    /canvasWorker\?\.ready/,/lastVisualFrame/,/lastVisualFrame\.projectGeneration/,
    /projectGeneration/,/physicalSceneMatchesContext\(renderScene, getPhysicalContextState\(\)\)/,
    /renderCanvasWorker\(lastVisualFrame\)/])assert.match(handoff,contract);
  assert.doesNotMatch(handoff,/commitVisualFrame\(|recordMapPresentation\(|countriesPublishedGeneration\s*=/);
});

test('Canvas Worker submits the latest view when a drag finishes',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const renderStart=source.indexOf('    function renderCanvasWorker(visualFrame) {');
  const renderEnd=source.indexOf('\n    // Reconnect an asynchronously prepared physical scene',renderStart);
  const latestStart=source.indexOf('    function prioritizeLatest() {');
  const latestEnd=source.indexOf('\n    function ',latestStart+1);
  assert.ok(renderStart>=0&&renderEnd>renderStart&&latestStart>=0&&latestEnd>latestStart);
  const create=new Function(`
    let interactionActive=false, rendererMode='canvas-worker', lastVisualFrame=null;
    const sent=[], canvasWorker={queueFrame:frame=>sent.push(frame)};
    const resize=()=>{}, syncCanvasWorkerState=()=>{}, canvasWorkerViewMessage=frame=>frame||lastVisualFrame;
    ${source.slice(renderStart,renderEnd)}
    ${source.slice(latestStart,latestEnd)}
    return {sent, move:frame=>{lastVisualFrame=frame;renderCanvasWorker(frame);},
      begin:()=>{interactionActive=true;}, finish:()=>{interactionActive=false;prioritizeLatest();}};
  `);
  const h=create();h.move({id:0});h.begin();h.move({id:1});h.move({id:2});h.finish();
  assert.deepEqual(h.sent.map(frame=>frame.id),[0,2]);
});


test('Canvas acceptance rejects stale frame identity before transport acknowledges it',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const start=source.indexOf('          const canvasFrameRejectionReason =');
  const end=source.indexOf('          canvasWorker = createGpuCanvasWorker(',start);
  assert.ok(start>=0&&end>start,'canonical Canvas frame predicate is required');
  const accepted=source.slice(start,end);
  for(const marker of ['message.presentationKey',
    'currentCanvasPresentationKey(lastVisualFrame)','message.geometryRevision','geometryRevisionTracker.committedRevision()',
    'message.styleRevision','canvasStyleRevision','message.surfaceQuality',
    'canvasWorkerFrameMatchesPhysical'])
    assert.ok(accepted.includes(marker),'Canvas transport must reject mismatched '+marker);
  assert.match(source.slice(end,source.indexOf('onStale:',end)),/acceptFrame: message => canvasFrameRejectionReason\(message\) === ''/);
  const retry=source.slice(end,source.indexOf('\n          });',end));
  assert.ok(!retry.includes("message.renderRequestId == null\n"),
    'spontaneous resource frames must not be silently ignored');
  assert.ok(retry.includes('canvasWorker?.busy'),'in-flight current work must not be interrupted');
  assert.ok(retry.includes('canvasWorkerResubmitAttempts > 4'),'retries remain bounded');
  assert.ok(retry.includes('renderCanvasWorker(lastVisualFrame)'),'only current work is resubmitted');
});


test('Canvas rejection reasons classify stale style, physical scene and source identities without accepting old pixels',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const begin=source.indexOf('          const canvasFrameRejectionReason =');
  const end=source.indexOf('          canvasWorker = createGpuCanvasWorker(',begin);
  const map={frameId:4};
  let style=3,geom=7,quality='canonical',physical=true;
  const initial={frameId:4,presentationKey:'current',geometryRevision:7,
    styleRevision:3,surfaceQuality:'canonical'};
  const factory=new Function('lastVisualFrame','currentCanvasPresentationKey','geometryRevisionTracker',
    'canvasStyleRevision','surfacePresentation','canvasWorkerFrameMatchesPhysical','getPhysicalContextState',
    'currentCanvasPhysical',
    source.slice(begin,end)+';return canvasFrameRejectionReason;');
  const make=()=>factory(map,()=> 'current',{committedRevision:()=>geom},style,
    {quality},()=>physical,()=>({}),()=>({context:{ready:true}}));
  assert.equal(make()(initial),'');
  assert.equal(make()({...initial,frameId:3}),'',
    'a scheduling-only frameId must not discard an identical physical picture');
  assert.equal(make()({...initial,presentationKey:'old'}),'presentation');
  assert.equal(make()({...initial,geometryRevision:4}),'geometry');
  style=4;assert.equal(make()(initial),'style');style=3;
  quality='pending';assert.equal(make()(initial),'quality');quality='canonical';
  physical=false;assert.equal(make()(initial),'physical');
});

test('Canvas ready and data-ready reconnect the current physical scene without admitting stale bitmaps',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const start=source.indexOf('    function receiveCanvasWorkerMessage(event) {');
  const end=source.indexOf('    function activateCanvasFallback(',start);
  assert.ok(start>=0&&end>start);
  const dispatch=source.slice(start,end);
  assert.match(dispatch,/if \(message\.type === 'ready'\) \{[\s\S]*?syncCanvasWorkerState\(\);[\s\S]*?requestPreparedCanvasFrame\(\);/);
  assert.match(dispatch,/if \(message\.type === 'data-ready'\) \{[\s\S]*?if \(!requestPreparedCanvasFrame\(\)\) invalidateGpuFrame\('canvas-data-ready'\)/);
  const gate=source.slice(source.indexOf('    function requestPreparedCanvasFrame() {'),
    source.indexOf('    function renderLatestVisualFrame()',source.indexOf('    function requestPreparedCanvasFrame() {')));
  assert.match(gate,/projectRenderBlocked/);
  assert.match(gate,/lastVisualFrame\.projectGeneration/);
  assert.match(gate,/physicalSceneMatchesContext/);
  assert.doesNotMatch(dispatch,/canvasTerrainStats = message\.terrainStats[^\n]*\n[^\n]*recordMapPresentation/,
    'worker-local stats must not be mistaken for a committed bitmap');
});
