import { nextEventTurn } from "../../helpers/async-test-ports.mjs";
import { describe as contractSuite } from 'node:test';
import * as __merge_dep0 from "node:test";
import * as __merge_dep1 from "node:assert/strict";
import * as __merge_dep2 from "../../../src/app/viewer-initial-presentation.js";
import * as __merge_dep3 from "../../../src/app/viewer-post-presentation.js";
import * as __merge_dep4 from "node:fs";
import * as __merge_dep5 from "../../../src/app/viewer-load-status.js";
import * as __merge_dep6 from "../../../src/app/product-mode-policy.js";
import * as __merge_dep7 from "../../../src/document/project-session.js";
import * as __merge_dep8 from "../../../src/app/map-state-transition.js";
import * as __merge_dep9 from "../../../src/map/camera-navigation.js";
import * as __merge_dep10 from "../../../src/map/map-layout-metrics.js";
import * as __merge_dep11 from "../../../src/document/project-setup.js";
contractSuite("viewer-initial-presentation", () => {
const { describe : contractSuite } = __merge_dep0;
const __dep0 = __merge_dep0;
const __dep1 = __merge_dep1;
const __dep2 = __merge_dep2;
const __dep3 = __merge_dep3;
const __dep4 = __merge_dep4;
const __dep5 = __merge_dep5;
contractSuite("viewer-initial-presentation", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { createViewerInitialPresentation } = __dep2;

function fixture() {
  let notifications = 0;
  const state = createViewerInitialPresentation({onPresented: () => notifications++});
  return {state, notifications: () => notifications};
}

test('first page stays initial until an accepted project has a ready map frame', () => {
  const {state, notifications} = fixture(), request = state.track(() => true);
  assert.equal(state.hasPresented(), false);
  request.accept(1);
  for (const status of ['loading', 'error']) state.observe({status}, 1);
  assert.equal(state.hasPresented(), false);
  state.observe({status: 'ready',mapReady:true}, 1);
  assert.equal(state.hasPresented(), true);
  assert.equal(notifications(), 1);
});

test('the initial Viewer reveals a committed map while optional DEM is still loading', () => {
  const {state}=fixture(), request=state.track(()=>true);
  request.accept(2);
  state.observe({status:'ready',mapReady:false},2);
  assert.equal(state.hasPresented(),false,'a status label is not a frame certificate');
  state.observe({status:'terrain',mapReady:true,terrainReady:false},2);
  assert.equal(state.hasPresented(),true,'DEM cannot retain the first-page preview');
});

test('a frame displayed before project acceptance is remembered without accepting an empty substrate', () => {
  const {state} = fixture();
  state.observe({status: 'ready',mapReady:true}, 0);
  const request = state.track(() => true);
  state.observe({status: 'ready',mapReady:true}, 0);
  request.accept(1);
  assert.equal(state.hasPresented(), false);
  state.observe({status: 'ready',mapReady:true}, 1);
  assert.equal(state.hasPresented(), true);
});

test('accepted frame ends initial mode before search hydration settles', () => {
  const {state, notifications} = fixture(), request = state.track(() => true);
  state.observe({status: 'ready',mapReady:true}, 4);
  assert.equal(state.hasPresented(), false);
  request.accept(4);
  assert.equal(state.hasPresented(), true);
  request.cancel(); // A later search error must not restore initial mode.
  assert.equal(state.hasPresented(), true);
  assert.equal(notifications(), 1);
});

test('failed first request and its rollback stay initial; a retry can complete', () => {
  const {state} = fixture(), first = state.track(() => true);
  state.observe({status: 'ready',mapReady:true}, 1);
  first.cancel();
  state.observe({status: 'ready',mapReady:true}, 2); // Rollback may display the empty document.
  first.accept(1);
  assert.equal(state.hasPresented(), false);
  const retry = state.track(() => true);
  retry.accept(3);
  state.observe({status: 'ready',mapReady:true}, 3);
  assert.equal(state.hasPresented(), true);
});

test('superseded request and stale generation cannot finish initial mode', () => {
  const {state} = fixture();
  let current = true;
  const first = state.track(() => current);
  current = false;
  state.observe({status: 'ready',mapReady:true}, 1);
  first.accept(1);
  assert.equal(state.hasPresented(), false);
  const next = state.track(() => true);
  next.accept(3);
  state.observe({status: 'ready',mapReady:true}, 1);
  assert.equal(state.hasPresented(), false);
  first.cancel();
  state.observe({status: 'ready',mapReady:true}, 3);
  assert.equal(state.hasPresented(), true);
});

test('a newer tracked request invalidates an older handle even before the next open begins', () => {
  const {state} = fixture(), first = state.track(() => true), second = state.track(() => true);
  state.observe({status: 'ready',mapReady:true}, 1);
  first.accept(1);
  assert.equal(state.hasPresented(), false);
  second.accept(2);
  state.observe({status: 'ready',mapReady:true}, 2);
  assert.equal(state.hasPresented(), true);
});

test('losing readiness before acceptance does not count as a successful first presentation', () => {
  const {state} = fixture(), request = state.track(() => true);
  state.observe({status: 'ready',mapReady:true}, 1);
  state.observe({status: 'loading'}, 1);
  request.accept(1);
  assert.equal(state.hasPresented(), false);
  state.observe({status: 'ready',mapReady:true}, 1);
  assert.equal(state.hasPresented(), true);
});

test('year changes, search delays and foreground retries never reset first presentation', () => {
  const {state, notifications} = fixture(), first = state.track(() => true);
  first.accept(1); state.observe({status: 'ready',mapReady:true}, 1);
  for (let generation = 2; generation <= 5; generation++) {
    const request = state.track(() => true);
    state.observe({status: 'loading'}, generation);
    state.observe({status: 'error'}, generation);
    assert.equal(state.hasPresented(), true);
    request.accept(generation);
    state.observe({status: 'ready',mapReady:true}, generation);
    request.cancel();
  }
  assert.equal(notifications(), 1);
});

test('a new page instance starts initial without resetting the existing page', () => {
  const {state} = fixture(), request = state.track(() => true);
  request.accept(1); state.observe({status: 'ready',mapReady:true}, 1);
  assert.equal(fixture().state.hasPresented(), false);
  assert.equal(state.hasPresented(), true);
});

test('disposal makes late ready signals and late acceptance inert', () => {
  const {state, notifications} = fixture(), request = state.track(() => true);
  state.dispose(); state.dispose();
  request.accept(1); state.observe({status: 'ready',mapReady:true}, 1);
  state.track(() => true).accept(2); state.observe({status: 'ready',mapReady:true}, 2);
  assert.equal(state.hasPresented(), false);
  assert.equal(notifications(), 0);
});

test('invalid request predicates and generations fail visibly', () => {
  const {state} = fixture();
  assert.throws(() => state.track(null), TypeError);
  for (const generation of [0, -1, null, undefined, NaN, 1.5]) {
    assert.throws(() => state.track(() => true).accept(generation), TypeError);
  }
});


test('resolution-limited but fully presented country frame ends only the first-page preview', () => {
  const {state, notifications} = fixture(), first = state.track(() => true);
  first.accept(4);
  for (const status of ['terrain', 'presenting', 'boundaries', 'error', 'loading']) {
    state.observe({status},4);
    assert.equal(state.hasPresented(),false,status+' has no presented-frame certificate');
  }
  state.observe({status:'limited',mapReady:true},3);
  assert.equal(state.hasPresented(),false,'different generation cannot dismiss the preview');
  state.observe({status:'limited',mapReady:true},4);
  assert.equal(state.hasPresented(),true);
  assert.equal(notifications(),1);
});

test('resolution-limited frame before acceptance is observed only for its own generation', () => {
  const {state} = fixture(), first = state.track(() => true);
  state.observe({status:'limited',mapReady:true},8);
  first.accept(8);
  assert.equal(state.hasPresented(),true);
});
});
contractSuite("viewer-post-presentation", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { createViewerPostPresentation } = __dep3;

const tick = nextEventTurn;
test('post work starts after map open, never owns map readiness and waits only for search hydration',async()=>{
 let release,rendered=0,extras=0;
 const gate=new Promise(resolve=>{release=resolve;});
 let ready=true;
 const owner=createViewerPostPresentation({hydrate:()=>gate,
   refresh:()=>{rendered++;},afterMap:[()=>{extras++;}]});
 owner.schedule(()=>ready);
 assert.equal(extras,0,'nonessential work must not run in the synchronous map path');
 await tick();assert.equal(extras,1);assert.equal(rendered,0);
 release();await tick();assert.equal(rendered,1);
 ready=false;owner.dispose();
});

test('old hydration resolution never refreshes a newer project or republishes an old search',async()=>{
 const gates=[],render=[],errors=[];
 const owner=createViewerPostPresentation({
   hydrate:()=>new Promise(resolve=>gates.push(resolve)),
   refresh:()=>render.push('current'),
   onError:(error)=>errors.push(error),
 });
 owner.schedule(()=>true);await tick();assert.equal(gates.length,1);
 owner.invalidate();
 owner.schedule(()=>true);await tick();assert.equal(gates.length,2);
 gates[0]();await tick();assert.deepEqual(render,[]);
 gates[1]();await tick();assert.deepEqual(render,['current']);
 assert.deepEqual(errors,[]);owner.dispose();
});

test('a failed post-hydration stage reports independently without rejecting the next map',async()=>{
 const failures=[],render=[];
 let failed=true;
 const owner=createViewerPostPresentation({
   hydrate:()=>{if(failed){failed=false;throw Error('search unavailable');}},
   refresh:()=>render.push('rendered'),
   onError:(error,stage)=>failures.push([stage,error.message]),
 });
 owner.schedule(()=>true);await tick();
 assert.deepEqual(failures,[['hydrate','search unavailable']]);
 assert.deepEqual(render,[]);
 owner.schedule(()=>true);await tick();
 assert.deepEqual(render,['rendered']);owner.dispose();
});

test('optional surface and resource work failures are isolated from subsequent search rendering',async()=>{
 const errors=[],calls=[];
 const owner=createViewerPostPresentation({
   afterMap:[
     ()=>{throw Error('resource failed');},
     async()=>{throw Error('surface failed');},
     ()=>calls.push('selection synchronized'),
   ],
   hydrate:async()=>{calls.push('hydrated');},
   refresh:()=>calls.push('search rendered'),
   onError:(error,stage)=>errors.push([stage,error.message]),
 });
 owner.schedule(()=>true);await tick();
 assert.deepEqual(calls,['selection synchronized','hydrated','search rendered']);
 assert.deepEqual(errors,[['auxiliary','resource failed'],['auxiliary','surface failed']]);
 owner.dispose();
});

test('no late refresh or error after disposal or supersession',async()=>{
 let release,reject;const rendered=[],errors=[];
 const owner=createViewerPostPresentation({
   hydrate:()=>new Promise((resolve,failed)=>{release=resolve;reject=failed;}),
   refresh:()=>rendered.push(1),
   onError:e=>errors.push(e.message),
 });
 owner.schedule(()=>true);await tick();owner.dispose();reject(Error('late'));
 await tick();assert.deepEqual(rendered,[]);assert.deepEqual(errors,[]);
 assert.throws(()=>owner.schedule(null),/current project/);
 release();await tick();
});

test('stale caller predicate blocks pending work before any layer mutation',async()=>{
 let current=false,calls=0;
 const owner=createViewerPostPresentation({hydrate:()=>{calls++;},refresh:()=>{calls++;},
   afterMap:[()=>{calls++;}]});
 owner.schedule(()=>current);await tick();assert.equal(calls,0);
 current=true;owner.schedule(()=>current);await tick();assert.equal(calls,3);owner.dispose();
});
});
contractSuite("viewer-load-status", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { readFileSync } = __dep4;
const { createViewerInitialPresentation } = __dep2;
const { presentViewerLoadStatus } = __dep5;

const read = path => readFileSync(new URL("../../../" + path, import.meta.url), 'utf8');

test('viewer status stays accessible without covering the displayed map', () => {
  const html = read('src/app/index.html');
  const region = html.match(/<span\b[^>]*\bid="viewerStatus"[^>]*>/)?.[0];
  assert.ok(region, 'Viewer must expose an accessible status region');
  for (const [attribute, value] of [['class', 'ui-visually-hidden'], ['role', 'status'],
    ['aria-live', 'polite'], ['aria-atomic', 'true']])
    assert.match(region, new RegExp('\\b' + attribute + '="' + value + '"'));
  assert.doesNotMatch(html, /\bid="viewer-loading"/);
  assert.match(html, /\bid="mapPreparationRetry"/);
});

test('first real map frame publishes once independently of status labels and optional terrain', () => {
  let presented = 0;
  const owner = createViewerInitialPresentation({onPresented: () => presented++});
  const request = owner.track(() => true);
  assert.equal(owner.hasPresented(), false);
  assert.equal(request.accept(4), false, 'project acceptance is not paint confirmation');
  assert.equal(owner.observe({status: 'ready', mapReady: false}, 4), false);
  assert.equal(owner.observe({status: 'terrain', mapReady: true, terrainReady: false}, 3), false,
    'a previously painted generation cannot complete this request');
  assert.equal(owner.observe({status: 'terrain', mapReady: true, terrainReady: false}, 4), true);
  assert.equal(owner.hasPresented(), true);
  assert.equal(presented, 1);
  assert.equal(owner.observe({status: 'ready', mapReady: true}, 4), false);
  request.cancel();
  owner.dispose();
  assert.equal(presented, 1);
});

test('quiet completion preserves accessibility without declaring the renderer ready', () => {
  const element = {dataset: {ready: 'false'}, hidden: true, children: [],
    setAttribute(name, value) { this[name] = value; },
    set textContent(value) { this.text = value; this.children = []; }};
  presentViewerLoadStatus(element, '연결 실패', {error: true});
  element.children.push({type: 'button'});
  assert.equal(element.className, 'ui-floating-surface viewer-map-error');
  presentViewerLoadStatus(element, '지도 준비 완료.');
  assert.equal(element.hidden, false);
  assert.equal(element.role, 'status');
  assert.equal(element['aria-live'], 'polite');
  assert.equal(element['aria-atomic'], 'true');
  assert.equal(element.className, 'ui-visually-hidden');
  assert.equal(element.dataset.ready, 'false');
  assert.deepEqual(element.children, []);
});
});
});
contractSuite("viewer-globe-only", () => {
const test = __merge_dep0.default;
const assert = __merge_dep1.default;
const { createProductModePolicy } = __merge_dep6;
const { createProjectSession } = __merge_dep7;
const { createAtomicMapStateController } = __merge_dep8;
const { createCameraNavigation } = __merge_dep9;
const { createMapLayoutMetricsSnapshot } = __merge_dep10;
const { initialBoundsView } = __merge_dep11;

for (const [mode, projection, rejected] of [['viewer','globe','flat'],['editor','flat','globe']]) {
  test(`${mode} admits its fixed projection and rejects an explicit switch`,()=>{
    const policy=createProductModePolicy(mode);
    assert.doesNotThrow(()=>policy.assertProjection(projection));
    assert.throws(()=>policy.assertProjection(rejected),{code:'PL-PRODUCT-PROJECTION'});
    assert.throws(()=>policy.assertProjection('unknown'),{code:'PL-PRODUCT-PROJECTION'});
    assert.doesNotThrow(()=>policy.assertProjection(undefined)); // A camera-only host update.
  });
  test(`${mode} atomic camera restore keeps the product projection and geographic center`,()=>{
    const layout=createMapLayoutMetricsSnapshot({width:900,height:624});
    const navigation=createCameraNavigation();
    navigation.connect({platform:{clamp:(value,min,max)=>Math.max(min,Math.min(max,value))},mapView:{projectionLayoutMetrics:()=>layout}});
    const session=createProjectSession({productMode:mode});
    session.connect({readiness:{DATA_READINESS:{PREVIEW:'preview'}},applicationConstantsA:{DISTRIBUTION_RENDER_MODES:{OVERLAP:'overlap'}},
      modelValidation:{normalizeLayerPresentation:()=>({})},physicalConfig:{PHYSICAL_DATASET:'fixture'},domains:{},
      uiFactoriesA:{createAtomicMapStateController},mapNavigation:navigation});
    session.initializeMapWorkScheduler();
    const view={...session.state.view,flatCenter:[175,25],flatZoom:3,globeRotation:[-175,-25,0],globeZoom:3};
    const camera=session.atomicMapStateController;
    camera.commit(camera.begin(),{projection:rejected,view});
    assert.equal(session.state.projection,projection);
    assert.deepEqual(projection==='globe'?session.state.view.globeRotation:session.state.view.flatCenter,projection==='globe'?[-175,-25,0]:[175,25]);
    assert.deepEqual(view.flatCenter,[175,25]);
  });
}

test('globe initial bounds fit across the dateline on desktop and mobile',()=>{
  for(const size of [{width:1440,height:900},{width:390,height:844}]){
    const layout=createMapLayoutMetricsSnapshot(size),bounds={west:170,east:-170,south:-10,north:10};
    const initial=initialBoundsView(bounds,layout,'globe');
    assert.equal(initial.projection,'globe');
    assert.equal(Math.abs(initial.view.globeRotation[0]),180);
    assert.equal(initial.view.globeRotation[1],0);
    assert.ok(initial.view.globeZoom>1);
    const angle=Math.acos(Math.cos(10*Math.PI/180)**2);
    assert.ok(2*layout.globeBaseScale*initial.view.globeZoom*Math.sin(angle)<=Math.min(layout.contentWidth,layout.contentHeight));
  }
});

test('world bounds keep a complete globe and editor bounds keep a flat fit',()=>{
  const layout=createMapLayoutMetricsSnapshot({width:900,height:624});
  const world=initialBoundsView({west:-180,east:180,south:-90,north:90},layout,'globe');
  assert.equal(world.projection,'globe');assert.equal(world.view.globeZoom,1);
  assert.equal(initialBoundsView(null,layout,'globe').projection,'globe');
  const flat=initialBoundsView({west:170,east:-170,south:-10,north:10},layout,'flat');
  assert.equal(flat.projection,'flat');assert.equal(Math.abs(flat.view.flatCenter[0]),180);
});


test('flat review keeps editor projection but never creates edit-draft or save state',()=>{
 const policy=createProductModePolicy('editor',{readOnly:true});
 assert.equal(policy.projection,'flat');assert.equal(policy.readOnly,true);
 assert.throws(()=>policy.assertProjection('globe'),{code:'PL-PRODUCT-PROJECTION'});
 assert.throws(()=>policy.assertOperation('core.document-execute'),{code:'PL-PRODUCT-READONLY'});
 assert.doesNotThrow(()=>policy.assertOperation('core.document-selection-apply'));
 const session=createProjectSession({productMode:'editor',readOnly:true});
 session.connect({readiness:{DATA_READINESS:{PREVIEW:'preview'}},applicationConstantsA:{DISTRIBUTION_RENDER_MODES:{OVERLAP:'overlap'}},
  modelValidation:{normalizeLayerPresentation:()=>({})},physicalConfig:{PHYSICAL_DATASET:'fixture'},domains:{},
  uiFactoriesA:{createAtomicMapStateController},
  mapNavigation:{clampViewZooms:view=>view,reprojectView:view=>view}});
 session.initializeMapWorkScheduler();
 assert.equal(session.state.projection,'flat');assert.equal(Object.hasOwn(session.state,'geometryPreview'),false);
 assert.equal(session.saveState,undefined);
 assert.throws(()=>createProductModePolicy('viewer',{readOnly:false}),TypeError);
 assert.throws(()=>createProductModePolicy('editor',{readOnly:'true'}),TypeError);
});
});
