import { describe as contractSuite } from 'node:test';
import * as __dep0 from "../../apps/viewer/js/modules/viewer-load-status.js";
import * as __dep1 from "node:test";
import * as __dep2 from "node:assert/strict";
import * as __dep3 from "node:fs";
import * as __dep4 from "node:vm";
import * as __dep5 from "../../shared/frontend/js/modules/reliability-core.js";
import * as __dep6 from "../../apps/viewer/js/modules/viewer-initial-presentation.js";
import * as __dep7 from "../../apps/viewer/js/modules/viewer-post-presentation.js";
import * as __dep8 from "../../shared/frontend/js/modules/application-lifecycle.js";

// Original feature contract: viewer-bootstrap-recovery.test.mjs
contractSuite("viewer-bootstrap-recovery", () => {
const { presentViewerLoadStatus } = __dep0;
const test = __dep1.default;
const assert = __dep2.default;
const { readFileSync } = __dep3;
const vm = __dep4.default;
const { isRecoverableLoadError } = __dep5;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element extends EventTarget {
  constructor(){super();this.dataset={};this.children=[];this.hidden=false;}
  set textContent(value){this.text=value;this.children=[];}
  get textContent(){return this.text;}
  setAttribute(name,value){this[name]=value;}
  appendChild(value){this.children.push(value);}
}
function fixture({failures=0,hold=false,fatal=false}={}){
  const status=new Element(),document=new EventTarget(),window=new EventTarget();
  document.visibilityState='visible';document.getElementById=()=>status;document.createElement=()=>new Element();
  window.navigator={onLine:true};window.document=document;
  let reads=0,imports=0,compositions=0,release,signal;
  const core={verified:true},errors=[];
  const context=vm.createContext({presentViewerLoadStatus,window,document,navigator:window.navigator,AbortController,URL,
    console:{error:(...args)=>errors.push(args),warn:(...args)=>errors.push(args)},
    PANDOLAB_BUILD_META:{appVersion:'fixture'},isRecoverableLoadError,
    loadVerifiedCore:async options=>{reads++;signal=options.signal;
      if(fatal)throw Object.assign(new Error('bad engine digest'),{code:'PL-CORE-WASM-INTEGRITY'});
      if(failures-->0)throw Object.assign(new Error('offline'),{code:'PL-NETWORK-001',retryable:true});
      if(hold)await new Promise(resolve=>{release=resolve;});return core;},
    composeViewer:async()=>{compositions++;},
    importViewer:async()=>{imports++;assert.equal(context.PandoLabSphericalCore,core,'engine must be ready before evaluating the application graph');return {composeViewer:async()=>{compositions++;}};},
  });
  // Replace only module loading boundaries; execute the actual entry behavior.
  const source=readFileSync(new URL('../../apps/viewer/js/viewer.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?$/gm,'')
    .replaceAll('import.meta.url',JSON.stringify('https://test.local/assets/js/viewer.js'))
    .replace("import('./modules/viewer-composition.js')",'importViewer()');
  vm.runInContext(source,context);
  return {status,document,window,errors,release:()=>release(),signal:()=>signal,
    stats:()=>({reads,imports,compositions}),wake:()=>window.dispatchEvent(new Event('focus'))};
}

test('viewer verifies the engine before loading the application module graph',async()=>{
  const f=fixture();await tick();assert.deepEqual(f.stats(),{reads:1,imports:1,compositions:1});f.wake();await tick();assert.equal(f.stats().compositions,1);
});
test('pre-composition network failure recovers on wake without refresh or duplicate composition',async()=>{
  const f=fixture({failures:1});await tick();assert.deepEqual(f.stats(),{reads:1,imports:0,compositions:0});
  assert.equal(f.status.children[0].textContent,'다시 시도');f.wake();f.window.dispatchEvent(new Event('online'));await tick();
  assert.deepEqual(f.stats(),{reads:2,imports:1,compositions:1});
});
test('pre-composition failure exposes a retry action even when no new wake event arrives',async()=>{
  const f=fixture({failures:1});await tick();assert.equal(f.status.children.length,1);
  f.status.children[0].dispatchEvent(new Event('click'));await tick();assert.equal(f.stats().compositions,1);
});
test('engine integrity failures are not retried on focus',async()=>{
  const f=fixture({fatal:true});await tick();f.wake();await tick();assert.deepEqual(f.stats(),{reads:1,imports:0,compositions:0});assert.equal(f.status.role,'alert');
});
test('actual page exit cancels preflight and rejects late completion; BFCache does not',async()=>{
  const f=fixture({hold:true});await tick();
  f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));assert.equal(f.signal().aborted,false);
  f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:false}));assert.equal(f.signal().aborted,true);
  f.release();await tick();assert.equal(f.stats().compositions,0);assert.equal(f.stats().imports,0);
});

test('preflight has no visual waiting panel but keeps an accessible loading status',async()=>{
  const f=fixture({hold:true});await tick();
  try {
    assert.equal(f.status.className,'ui-visually-hidden');
    assert.equal(f.status.hidden,false);assert.equal(f.status.role,'status');
    assert.equal(f.status.dataset.ready,'false');
  } finally { f.release();await tick(); }
});
test('preflight error and retry never leave a visible loading panel behind',async()=>{
  const f=fixture({failures:1,hold:true});await tick();
  assert.equal(f.status.className,'ui-floating-surface viewer-map-error');
  assert.equal(f.status.hidden,false);assert.equal(f.status.role,'alert');
  f.status.children[0].dispatchEvent(new Event('click'));await tick();
  try {
    assert.equal(f.status.className,'ui-visually-hidden');
    assert.equal(f.status.children.length,0);assert.equal(f.status.dataset.ready,'false');
  } finally { f.release();await tick(); }
});
});

// Original feature contract: viewer-composition-recovery.test.mjs
contractSuite("viewer-composition-recovery", () => {
const { presentViewerLoadStatus } = __dep0;
const test = __dep1.default;
const assert = __dep2.default;
const { readFileSync } = __dep3;
const vm = __dep4.default;
const { createViewerInitialPresentation } = __dep6;
const { createViewerPostPresentation } = __dep7;
const { createApplicationLifecycle } = __dep8;
const { isRecoverableLoadError } = __dep5;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const noop=()=>{};
const network=()=>Object.assign(new Error('network unavailable'),{code:'PL-NETWORK-001',retryable:true});
class Element extends EventTarget {
  constructor(){super();this.dataset={};this.children=[];}
  set textContent(value){this.text=value;this.children=[];}
  get textContent(){return this.text;}
  appendChild(value){this.children.push(value);}
  setAttribute(name,value){this[name]=value;}
}
async function fixture({engineFailure=false,mapFailure=false,suppressReadyCertificate=false}={}){
  const elements=new Map(),document=new EventTarget(),window=new EventTarget();
  document.visibilityState='visible';document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  document.createElement=()=>new Element();window.document=document;window.navigator={onLine:true};window.CustomEvent=CustomEvent;window.location={search:''};
  let loads=0,maps=0,reads=0,disposed=0,nowSelections=0,manual=false,openRevision=0,ready=0;
  let openUserProject;
  let preparationObserver=noop;
  window.addEventListener('pandolab:ready',()=>ready++);
  const controller=()=>({bind:noop,dispose:()=>disposed++,connect:noop,enhanceAll:noop,sync:noop,resetProject:noop,syncNow:noop,
    render:noop,cancelSearch:noop,syncSelection:noop,completeHydration:async()=>{},initializeLAYER_STYLE_TARGETS:noop,bindNavigationUI:noop});
  const state={timelineCursor:'1953-07'},snapshot={documentId:'test',projectSetup:{}};
  const session={commandOwner:{load:async()=>{if(++loads===1&&engineFailure)throw network();},state:()=>state,dispose:()=>disposed++},
    documentModel:{snapshot:()=>snapshot,get:()=>null}};
  const surfaces={...controller(),isMobile:()=>false,initializeWorkspaceSurfaces:noop,applyLayoutMode:noop,closeSurface:noop,syncOverlayState:noop,closeFileMenu:noop};
  const objectCatalog={...controller(),listObjectSearchItems:()=>[],invalidateObjectPresentation:noop,pruneLayerItemVisibility:async()=>{}};
  const objectQuery={layerItemObjectRef:noop,focusObjectRef:noop,objectRefExists:()=>true,objectDisplayInfo:()=>({name:'test'})};
  const map={finishInitialPreview:noop,cancelInitialReveal:noop,viewState:{},objectCatalog,objectQuery,objectPresentation:{LAYER_SEARCH_GROUP_KEYS:[]},navigation:{selectObjectSearchItem:noop},
    renderer:{waitForMapPresentation:async generation=>{
      // The fake map acknowledges the current picture at the same boundary as
      // the real renderer's visual commit, not when the document merely opens.
      if(!suppressReadyCertificate)preparationObserver({mapReady:true,status:'ready'},generation);
      return true;
    }},refreshAppearance:noop,loadPhysicalResources:noop,capturePresentation:()=>({zoom:7}),refreshSelection:noop,
    prepareBuiltinProject:async()=>{reads++;if(mapFailure&&reads===1)throw network();return {};},loadPhysicalLandMask:async()=>{},
    update:async()=>{},dispose:()=>disposed++,cancelSearch:noop,searchPlaces:noop,closeObjectChooser:noop};
  const bindings={presentViewerLoadStatus,window,document,CustomEvent,URL,URLSearchParams,structuredClone,console:{warn:noop,error:noop},
    createViewerPostPresentation,
    createViewerInspectorController:()=>({syncMapSelection:noop,openAfterStartup:async()=>false,dispose:noop}),
    createViewerAdjacentPrefetch: () => ({afterPresented: noop,interrupt: noop,dispose: noop}),
    createPlatformPorts:()=>({}),createRuntimeContext:({meta})=>({meta,platform:{}}),createBrowserFileAccess:()=>({}),connectMapOwner:noop,
    createBrowserProjectStorage:()=>({}),initialBoundsView:noop,
    createNotificationPresentation:()=>({...controller(),reportOperationError:noop}),createApplicationLifecycle,createViewerInitialPresentation,
    createPreferencePresentation:()=>({...controller(),current:{}}),
    createMapOwners:()=>({workspaceSurfaces:surfaces,mapHost:{queueMapResize:noop},physicalResources:{loadHydroData:noop},
      territorialLabels:{preparePlaces:noop},builtinSession:{}}),
    saveUserPreferences:noop,createDiagnosticLog:()=>({snapshot:()=>[]}),isRecoverableLoadError,
    createNavigationBindings:controller,createSelectController:controller,createSelectionUiController:controller,createTooltipController:controller,
    installTimelineControls:()=>noop,createAppObjectSearchController:()=>objectCatalog,createSemanticIcon:noop,createEmptyState:noop,
    createSelectionDomain:controller,coreSelectionRefToWeb:noop,webSelectionRefToCore:noop,createDocumentSession:()=>session,
    createProjectDomain:()=>({...controller(),getOpenRevision:()=>openRevision,getGeneration:()=>openRevision,isOpening:()=>false,
      open:async reader=>{openRevision++;await reader();return true;}}),
    createInitialDocument:()=>snapshot,createViewerMap:options=>{maps++;preparationObserver=options.onMapPreparationStatus;return map;},createFileController:ports=>{openUserProject=ports.openProject;return controller();},readProjectFile:noop,
    createMapSettings:controller,layerStyle:noop,DISTRIBUTION_RENDER_MODES:{},createSurfaceController:noop,createPreferencesDialog:noop,
    createBuiltinMonthClock:options=>({...controller(),month:()=>null,suspend:()=>()=>true,isAutomatic:()=>!manual,
      refresh:()=>manual?false:options.applyMonth('1953-07',{isCurrent:()=>true,commit:noop}),
      followNow:()=>{nowSelections++;return options.applyMonth('1953-07',{isCurrent:()=>true,commit:noop});}}),
  };
  const source=readFileSync(new URL('../../apps/viewer/js/modules/viewer-composition.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?$/gm,'').replace('export async function composeViewer','async function composeViewer')
    .replaceAll('import.meta.url',JSON.stringify('https://test.local/assets/js/modules/viewer-composition.js'));
  const context=vm.createContext(bindings);vm.runInContext(source+'\nglobalThis.run=composeViewer;',context);
  await context.run({productMode:'viewer',meta:{appVersion:'test'}});
  return {window,initialLoading:()=>document.getElementById('viewer').dataset.initialLoading,status:document.getElementById('viewerStatus'),manual:()=>{manual=true;},
    stats:()=>({loads,maps,reads,disposed,nowSelections,ready}),wake:()=>window.dispatchEvent(new Event('focus')),
    openInvalidProject:()=>openUserProject(async()=>{throw new Error('invalid project payload');})};
}

test('actual viewer composition resumes initial engine admission before creating the map once',async()=>{
  const f=await fixture({engineFailure:true});assert.equal(f.stats().maps,0);assert.equal(f.stats().disposed,0);
  f.wake();await tick();assert.deepEqual(f.stats(),{loads:2,maps:1,reads:1,disposed:0,nowSelections:0,ready:1});assert.equal(f.status.dataset.ready,'true');
  f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:false}));assert.ok(f.stats().disposed>0);
});
test('actual viewer preserves composed map during a recoverable source failure',async()=>{
  const f=await fixture({mapFailure:true});assert.equal(f.stats().maps,1);assert.equal(f.stats().disposed,0);assert.equal(f.status.dataset.ready,'false');
  f.wake();await tick();assert.equal(f.stats().maps,1);assert.equal(f.stats().reads,2);assert.equal(f.status.dataset.ready,'true');
});
test('startup recovery does not force current date after the user takes control of the timeline',async()=>{
  const f=await fixture({mapFailure:true});f.manual();f.wake();await tick();assert.equal(f.stats().reads,1);assert.equal(f.stats().nowSelections,0);
});

test('focus, visibility and BFCache restore never replay initial presentation after a ready map',async()=>{
  const f=await fixture();assert.equal(f.initialLoading(),'false');const before=f.stats();
  f.window.document.visibilityState='hidden';f.window.document.dispatchEvent(new Event('visibilitychange'));
  f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));
  f.window.document.visibilityState='visible';f.window.document.dispatchEvent(new Event('visibilitychange'));
  f.window.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));f.wake();
  await tick();assert.equal(f.initialLoading(),'false');assert.deepEqual(f.stats(),before);
  f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:false}));
});

test('recoverable startup errors remain visible with retry; recovery returns to an accessible quiet status',async()=>{
  const f=await fixture({mapFailure:true});
  assert.equal(f.status.className,'ui-floating-surface viewer-map-error');
  assert.equal(f.status.role,'alert');assert.equal(f.status.hidden,false);
  assert.equal(f.status.children[0].textContent,'다시 시도');
  f.status.children[0].dispatchEvent(new Event('click'));await tick();
  assert.equal(f.status.className,'ui-visually-hidden');
  assert.equal(f.status.role,'status');assert.equal(f.status.hidden,false);
  assert.equal(f.status.dataset.ready,'true');assert.equal(f.status.children.length,0);
  f.window.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:false}));
});


test('rejected project read restores previously accepted map readiness even without first-frame certification',async()=>{
  const f=await fixture({suppressReadyCertificate:true});
  assert.equal(f.status.dataset.ready,'true');
  assert.equal(f.initialLoading(),'true');
  await assert.rejects(f.openInvalidProject(),/invalid project payload/);
  assert.equal(f.status.dataset.ready,'true');
});
});
