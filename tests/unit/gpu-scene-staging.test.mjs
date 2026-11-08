import { describe as contractSuite } from 'node:test';
import * as __contract_dep0 from "node:assert/strict";
import * as __contract_dep1 from "node:test";
import * as __contract_dep2 from "../../shared/frontend/js/modules/gpu-scene-preparation.js";
import * as __contract_dep3 from "../../shared/frontend/js/modules/gpu-base-scene-pass.js";
import * as __contract_dep4 from "node:fs";
import * as __contract_dep5 from "../../shared/frontend/js/modules/map-content-presentation.js";
contractSuite("gpu-scene-staging", () => {
const assert = __contract_dep0.default;
const test = __contract_dep1.default;
const { prepareGpuBaseScene, commitGpuStrokeDomains } = __contract_dep2;
const { drawGpuBaseScene } = __contract_dep3;

const packet = (key, revision, domain = 'boundaries', objectKey = '') => ({
  key, domain, objectKey, sourceKey: `stroke:${key}:${revision}:high:flat`, geometryRevision: revision,
  startsEnds: new Float32Array([revision, 0, revision + 1, 1]), byteLength: 16,
  style: { alpha: 1, width: 2 },
});
function harness() {
  const presentedStrokeDomains = new Map(), resources = new Set(), uploaded = [], released = [];
  const strokeRenderer = {
    hasPreparedResource: value => resources.has(value.key), hasResource: key => resources.has(key),
    ensureResource: value => { uploaded.push(value); return { resource: null, reason: 'upload-pending' }; },
    releaseResource: key => { resources.delete(key); released.push(key); },
  };
  const prepare = strokes => prepareGpuBaseScene({ scene: { polygons: [], strokes },
    frame: { projectGeneration: 7 }, presentedStrokeDomains }, { strokeRenderer });
  const ready = (...rows) => rows.forEach(row => resources.add(`scene-stroke:${row.sourceKey}`));
  const accept = result => commitGpuStrokeDomains({ frameId: 1, projectGeneration: 7,
    overlayRenderedKeys: result.overlayItems.map(row => row.packet.key), overlayMissingKeys: [],
    strokeDomainReplacements: result.strokeDomainReplacements }, { frameId: 1, projectGeneration: 7 }, presentedStrokeDomains, strokeRenderer);
  return { prepare, ready, accept, presentedStrokeDomains, resources, uploaded, released };
}
test('a stroke domain retains A while every replacement resource in B is prepared', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2), extra = packet('new-line', 2);
  h.ready(a); h.accept(h.prepare([a]));
  const waiting = h.prepare([b, extra]);
  assert.deepEqual(waiting.overlayItems.map(row => row.packet), [a]);
  assert.deepEqual(waiting.strokeDomainReplacements, []);
  assert.equal(waiting.deferredOverlayKeys.has('line'), true);
  assert.equal(waiting.failedOverlayKeys.size, 0, 'pending uploads are not failures');
  h.ready(b);
  assert.deepEqual(h.prepare([b, extra]).overlayItems.map(row => row.packet), [a], 'partial readiness cannot promote a domain');
  h.ready(extra);
  const prepared = h.prepare([b, extra]);
  assert.deepEqual(prepared.overlayItems.map(row => row.packet), [b, extra]);
  assert.equal(h.presentedStrokeDomains.get('boundaries')[0].packet, a, 'preparation is not presentation');
  h.accept(prepared);
  assert.deepEqual(h.presentedStrokeDomains.get('boundaries').map(row => row.packet), [b, extra]);
  assert.deepEqual(h.released, [`scene-stroke:${a.sourceKey}`]);
});
test('failed and stale presentation cannot release A or promote a prepared B', () => {
  const h = harness(), a = packet('a', 1), b = packet('a', 2); h.ready(a); h.accept(h.prepare([a])); h.ready(b);
  const prepared = h.prepare([b]);
  const result = { frameId: 1, projectGeneration: 7, overlayRenderedKeys: [], overlayMissingKeys: ['a'],
    strokeDomainReplacements: prepared.strokeDomainReplacements };
  const renderer = { releaseResource: () => assert.fail('failed presentation released A') };
  assert.equal(commitGpuStrokeDomains(result, { frameId: 1, projectGeneration: 7 }, h.presentedStrokeDomains, renderer), false);
  assert.equal(commitGpuStrokeDomains({ ...result, overlayRenderedKeys: ['a'], overlayMissingKeys: [] },
    { frameId: 2, projectGeneration: 7 }, h.presentedStrokeDomains, renderer), false);
  assert.equal(h.presentedStrokeDomains.get('boundaries')[0].packet, a);
});
test('an aggregate visibility scope change rejects the old boundary archive while replacement uploads wait', () => {
  const h = harness(), a = { ...packet('a', 1), continuityOwnerIds: ['A', 'B'] }; h.ready(a); h.accept(h.prepare([a]));
  const b = { ...packet('a', 2), continuityOwnerIds: ['A'] };
  assert.deepEqual(h.prepare([b]).overlayItems, [], 'deleted or hidden B cannot survive in an aggregate resource');
});
test('adding a visible object preserves the still-valid old aggregate during its replacement upload', () => {
  const h = harness(), a = { ...packet('a', 1), continuityOwnerIds: ['A', 'B'] }; h.ready(a); h.accept(h.prepare([a]));
  const b = { ...packet('a', 2), continuityOwnerIds: ['A', 'B', 'C'] };
  assert.deepEqual(h.prepare([b]).overlayItems.map(row => row.packet), [a]);
});
test('same-key revisions get independent GPU resource identities', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2);
  h.prepare([a]); h.prepare([b]);
  assert.equal(new Set(h.uploaded.map(row => row.key)).size, 2);
});
test('deleting a distribution sibling sharing an objectKey removes that exact visual while another upload waits', () => {
  const h = harness(), one = packet('entry:one:line', 1, 'distribution', 'layer:one'), two = packet('entry:two:line', 1, 'distribution', 'layer:one');
  h.ready(one, two); h.accept(h.prepare([one, two]));
  const next = packet('entry:one:line', 2, 'distribution', 'layer:one');
  assert.deepEqual(h.prepare([next]).overlayItems.map(row => row.packet), [one]);
  assert.equal(h.prepare([next]).canPreserveStrokeScene, false, 'the old whole-scene texture still contains the deleted sibling');
});
test('a superseded ready B cannot replace the current desired C or an A return', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2), c = packet('line', 3);
  h.ready(a); h.accept(h.prepare([a])); h.prepare([b]); h.ready(b);
  assert.deepEqual(h.prepare([c]).overlayItems.map(row => row.packet), [a]);
  assert.deepEqual(h.prepare([a]).overlayItems.map(row => row.packet), [a]);
});
test('independent domains can promote while another retains its old strokes', () => {
  const h = harness(), a = packet('a', 1), other = packet('other', 1, 'other');
  h.ready(a, other); h.accept(h.prepare([a, other]));
  const b = packet('a', 2), next = packet('other', 2, 'other'); h.ready(next);
  const result = h.prepare([b, next]);
  assert.deepEqual(result.overlayItems.map(row => row.packet), [a, next]);
});
test('empty domains, removed objects and disabled strokes do not leave old geometry', () => {
  const h = harness(), a = packet('a', 1, 'boundaries', 'object:a'), other = packet('other', 1, 'boundaries', 'object:other');
  h.ready(a, other); h.accept(h.prepare([a, other]));
  assert.deepEqual(h.prepare([packet('a', 2, 'boundaries', 'object:a')]).overlayItems.map(row => row.packet), [a]);
  assert.deepEqual(h.prepare([{ ...a, style: { alpha: 0, width: 2 } }]).overlayItems, []);
  assert.deepEqual(h.prepare([]).overlayItems, []);
});
test('a new project can reuse the exact requested resource but cannot display previous project fallback', () => {
  const h = harness(), a = packet('a', 1); h.ready(a); h.accept(h.prepare([a]));
  const result = prepareGpuBaseScene({ scene: { strokes: [a] }, frame: { projectGeneration: 8 },
    presentedStrokeDomains: new Map() }, { strokeRenderer: {
    hasPreparedResource: row => h.resources.has(row.key), ensureResource: () => ({ resource: null, reason: 'upload-pending' }),
  } });
  assert.deepEqual(result.overlayItems.map(row=>row.packet), [a]);
  const changed=prepareGpuBaseScene({scene:{strokes:[packet('a',2)]},frame:{projectGeneration:8},
    presentedStrokeDomains:h.presentedStrokeDomains},{strokeRenderer:{
      hasPreparedResource:row=>h.resources.has(row.key),ensureResource:()=>({resource:null,reason:'upload-pending'}),
    }});
  assert.deepEqual(changed.overlayItems,[]);
});
test('a failed prepared B draw redraws eligible A before publication and cannot promote B', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2); h.ready(a); h.accept(h.prepare([a])); h.ready(b);
  const prepared = h.prepare([b]), drawn = [];
  const gl = new Proxy({}, { get: (_target, key) => /^[A-Z_]+$/.test(key) ? key : () => {} });
  const result = drawGpuBaseScene({ gl, frame: { frameId: 1, projectGeneration: 7 }, surfacePresentation:{quality:'canonical'}, countries: {}, prepared }, {
    drawOceanSubstrate() {}, drawHydro() {}, drawCountryBoundaryStrokes() {}, strokeRenderer: { ...h,
      hasResource: key => h.resources.has(key),
      drawBatches: rows => { const row = rows[0]; drawn.push(row.geometryRevision);
        return row.geometryRevision === 2 ? { renderedKeys: [], missingKeys: [row.key], failures: [{ key: row.key, reason: 'GPU draw failed' }] }
          : { renderedKeys: [row.key], missingKeys: [], failures: [] }; },
    },
  });
  assert.deepEqual(drawn, [2, 1], 'retry is one same-frame redraw of the previously presented domain');
  assert.deepEqual(result.overlayMissingKeys, []);
  assert.deepEqual(result.strokeDomainReplacements, []);
  assert.deepEqual(result.recoveredStrokeDomains, ['boundaries']);
  assert.equal(result.strokePresentationFailed, false);
  assert.equal(prepared.canPreserveStrokeScene, true);
  assert.equal(commitGpuStrokeDomains(result, { frameId: 1, projectGeneration: 7 }, h.presentedStrokeDomains,
    { releaseResource: () => assert.fail('failed B must not release A') }), false);
});
test('failure of both B and eligible A is a failed presentation with no promotion', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2); h.ready(a); h.accept(h.prepare([a])); h.ready(b);
  const gl = new Proxy({}, { get: (_target, key) => /^[A-Z_]+$/.test(key) ? key : () => {} });
  const result = drawGpuBaseScene({ gl, frame: { frameId: 1, projectGeneration: 7 }, surfacePresentation:{quality:'canonical'}, countries: {}, prepared: h.prepare([b]) }, {
    drawOceanSubstrate() {}, drawHydro() {}, drawCountryBoundaryStrokes() {}, strokeRenderer: {
      hasResource: () => true, drawBatches: rows => ({ renderedKeys: [], missingKeys: rows.map(row => row.key) }),
    },
  });
  assert.equal(result.strokePresentationFailed, true);
  assert.deepEqual(result.strokeDomainReplacements, []);
});
});
contractSuite("gpu-scene-worker-presentation", () => {
const test = __contract_dep1.default;
const assert = __contract_dep0.default;
const { readFileSync } = __contract_dep4;

test('after polygon preparation, Canvas Worker schedules a base redraw rather than interaction-only invalidation',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-scene.js',import.meta.url),'utf8');
  assert.match(source,/builder\.preparePolygons\([\s\S]*?\.then\(\(\) => \{[\s\S]*?syncGpuRenderScene\(\);[\s\S]*?mode === 'canvas-worker'[\s\S]*?requestPreparedCanvasFrame\?\.\(\);[\s\S]*?invalidateBaseScene\('canvas-scene-ready'\)/);
  assert.match(source,/else\s+dependencies\.domains\.renderingDomain\.invalidateGpuInteraction\('overlay-mesh-ready'\)/);
});


test('restored base country strokes invalidate the base scene rather than interaction only',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const begin=source.indexOf('    function overlayResourceReady(key) {');
  const end=source.indexOf('    function buildCountryStrokeResource(',begin);
  assert.ok(begin>=0 && end>begin);
  const events=[];
  const ready=new Function('sceneColorCache','invalidateGpuFrame','scheduleGpuInteractionFrame',
    'renderScene','sceneStrokeResourcePacket','projectGeneration','promotePreparedCountryBoundary',
    source.slice(begin,end)+'\nreturn overlayResourceReady;')(
    {invalidate:reason=>events.push(['cache',reason])},
    reason=>events.push(['base',reason]),reason=>events.push(['interaction',reason]),
    {polygons:[],strokes:[]},()=>({key:''}),1,()=>events.push(['shared','promote'])
  );
  ready('country-boundary:canonical');
  assert.ok(events.some(([kind])=>kind==='base'),'base country stroke upload must schedule a composited frame');
  assert.equal(events.some(([kind])=>kind==='interaction'),false);
  events.length=0;
  ready('ui-selection-only');
  assert.deepEqual(events,[['interaction','interaction-resource-ready']]);
});

test('Canvas first canonical country frame schedules optional terrain only after physical bitmap acceptance',()=>{
  const renderer=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  assert.match(renderer,/presentBeforeTerrain:\s*!temporalPending\(\)\s*&&\s*countriesPublishedGeneration\s*!==\s*projectGeneration/);
  assert.match(renderer,/message\.presentBeforeTerrain\s*&&\s*fullSceneReady/);
  assert.match(renderer,/invalidateGpuFrame\('canvas-country-before-terrain'\)/);
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
    let interactionActive=false, rendererMode='canvas-worker', lastVisualFrame=null, projectGeneration=1;
    const sent=[], canvasWorker={queueFrame:frame=>sent.push(frame)};
    const resize=()=>{}, syncCanvasWorkerState=()=>{}, canvasWorkerViewMessage=frame=>frame||lastVisualFrame;
    ${source.slice(renderStart,renderEnd)}
    ${source.slice(latestStart,latestEnd)}
    return {sent, move:frame=>{lastVisualFrame=frame;renderCanvasWorker(frame);},
      setGeneration:value=>{projectGeneration=value;},
      begin:()=>{interactionActive=true;}, finish:()=>{interactionActive=false;prioritizeLatest();}};
  `);
  const h=create();h.setGeneration(0);h.move({id:'pre-document'});
  h.begin();h.finish();
  assert.deepEqual(h.sent,[],'pre-document work cannot block the current project');
  h.setGeneration(1);h.move({id:0});h.begin();h.move({id:1});h.move({id:2});h.finish();
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
    'currentCanvasPhysical','canvasBackgroundEligible','currentCanvasBackgroundKey','canvasPhysicalStyleRevision',
    source.slice(begin,end)+';return canvasFrameRejectionReason;');
  const make=()=>factory(map,()=> 'current',{committedRevision:()=>geom},style,
    {quality},()=>physical,()=>({}),()=>({context:{ready:true}}),()=>false,()=> 'background',3);
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
  assert.match(dispatch,/if \(message\.type === 'ready'\) \{[\s\S]*?syncCanvasWorkerState\(\);[\s\S]*?requestPreparedCanvasFrame\(\)/);
  assert.match(dispatch,/if \(message\.type === 'data-ready'\) \{[\s\S]*?if \(!requestPreparedCanvasFrame\(\)\) invalidateGpuFrame\('canvas-data-ready'\)/);
  const gate=source.slice(source.indexOf('    function requestPreparedCanvasFrame() {'),
    source.indexOf('    function renderLatestVisualFrame()',source.indexOf('    function requestPreparedCanvasFrame() {')));
  assert.match(gate,/projectRenderBlocked/);
  assert.match(gate,/lastVisualFrame\.projectGeneration/);
  assert.match(gate,/physicalSceneMatchesContext/);
  assert.doesNotMatch(dispatch,/canvasTerrainStats = message\.terrainStats[^\n]*\n[^\n]*recordMapPresentation/,
    'worker-local stats must not be mistaken for a committed bitmap');
});
});
contractSuite("gpu-scene-presentation-ownership", () => {
const test = __contract_dep1.default;
const assert = __contract_dep0.default;
const { createMapContentPresentation } = __contract_dep5;

function fixture() {
  const actions={pending:0,replace:0,sync:0,draw:0,coverage:[]};
  const countries={
    getState:()=>({layerVisibility:{objects:true},pendingCountryRenderIds:new Set()}),
    renderPendingCountryOverlays:()=>{actions.pending++;},
    replaceGpuSceneDomain:()=>{actions.replace++;},
    syncGpuRenderScene:()=>{actions.sync++;},
    applyGpuSceneCoverage:value=>actions.coverage.push(value),
    gpuMapRenderer:{renderFrame:()=>{actions.draw++;return{succeeded:true};}},
  };
  const content=createMapContentPresentation({countries,active:()=>{},requireFrame:value=>value});
  return {actions,content,frame:{__mapVisualFrame:true,frameId:9}};
}

test('presentation-only country pass cannot replace scene after GPU draw but retains coverage',()=>{
  const f=fixture(), result={succeeded:true,frameId:9};
  const outcome=f.content.renderCountries(f.frame,{presentationOnly:true,gpuResult:result});
  assert.equal(outcome,result);
  assert.equal(f.actions.pending,1,'SVG pending-country outlines still update on the approved frame');
  assert.equal(f.actions.replace,0,'presentation must not overwrite drawn GPU scene');
  assert.equal(f.actions.sync,0,'presentation must not advance rendered scene identity');
  assert.equal(f.actions.draw,0,'presentation must not draw a second GPU frame');
  assert.deepEqual(f.actions.coverage,[result]);
});

test('normal country pass still synchronizes geometry and draws before presenting',()=>{
  const f=fixture(),result=f.content.renderCountries(f.frame);
  assert.deepEqual([f.actions.pending,f.actions.replace,f.actions.sync,f.actions.draw],[1,1,1,1]);
  assert.deepEqual(f.actions.coverage,[result]);
});
});
