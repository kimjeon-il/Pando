import {presentViewerLoadStatus} from '../../apps/viewer/js/modules/viewer-load-status.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createViewerInitialPresentation} from '../../apps/viewer/js/modules/viewer-initial-presentation.js';
import {createApplicationLifecycle} from '../../shared/frontend/js/modules/application-lifecycle.js';
import {isRecoverableLoadError} from '../../shared/frontend/js/modules/reliability-core.js';
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
async function fixture({engineFailure=false,mapFailure=false}={}){
  const elements=new Map(),document=new EventTarget(),window=new EventTarget();
  document.visibilityState='visible';document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  document.createElement=()=>new Element();window.document=document;window.navigator={onLine:true};window.CustomEvent=CustomEvent;window.location={search:''};
  let loads=0,maps=0,reads=0,disposed=0,nowSelections=0,manual=false,openRevision=0,ready=0;
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
  const map={finishInitialPreview:noop,viewState:{},objectCatalog,objectQuery,objectPresentation:{LAYER_SEARCH_GROUP_KEYS:[]},navigation:{selectObjectSearchItem:noop},
    renderer:{},refreshAppearance:noop,loadPhysicalResources:noop,capturePresentation:()=>({zoom:7}),refreshSelection:noop,
    prepareBuiltinProject:async()=>{reads++;if(mapFailure&&reads===1)throw network();return {};},loadPhysicalLandMask:async()=>{},
    update:async()=>{},dispose:()=>disposed++,cancelSearch:noop,searchPlaces:noop,closeObjectChooser:noop};
  const bindings={presentViewerLoadStatus,window,document,CustomEvent,URL,URLSearchParams,structuredClone,console:{warn:noop,error:noop},
    createRuntimeContext:({meta})=>({meta,platform:{}}),createBrowserFileAccess:()=>({}),connectMapOwner:noop,
    createBrowserProjectStorage:()=>({}),initialBoundsView:noop,
    createNotificationPresentation:()=>({...controller(),reportOperationError:noop}),createApplicationLifecycle,createViewerInitialPresentation,
    createPreferencePresentation:()=>({...controller(),current:{}}),
    createMapOwners:()=>({workspaceSurfaces:surfaces,mapHost:{queueMapResize:noop},physicalResources:{loadHydroData:noop},territorialLabels:{preparePlaces:noop}}),
    saveUserPreferences:noop,createDiagnosticLog:()=>({snapshot:()=>[]}),isRecoverableLoadError,
    createNavigationBindings:controller,createSelectController:controller,createSelectionUiController:controller,createTooltipController:controller,
    installTimelineControls:()=>noop,createAppObjectSearchController:()=>objectCatalog,createSemanticIcon:noop,createEmptyState:noop,
    createSelectionDomain:controller,coreSelectionRefToWeb:noop,webSelectionRefToCore:noop,createDocumentSession:()=>session,
    createProjectDomain:()=>({...controller(),getOpenRevision:()=>openRevision,getGeneration:()=>openRevision,isOpening:()=>false,
      open:async reader=>{openRevision++;await reader();preparationObserver({status:'ready'},openRevision);return true;}}),
    createInitialDocument:()=>snapshot,createViewerMap:options=>{maps++;preparationObserver=options.onMapPreparationStatus;return map;},createFileController:controller,readProjectFile:noop,
    createMapSettings:controller,layerStyle:noop,DISTRIBUTION_RENDER_MODES:{},createSurfaceController:noop,createPreferencesDialog:noop,
    createBuiltinMonthClock:options=>({...controller(),month:()=>null,isAutomatic:()=>!manual,
      refresh:()=>manual?false:options.applyMonth('1953-07',{isCurrent:()=>true,commit:noop}),
      followNow:()=>{nowSelections++;return options.applyMonth('1953-07',{isCurrent:()=>true,commit:noop});}}),
  };
  const source=readFileSync(new URL('../../apps/viewer/js/modules/viewer-composition.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?$/gm,'').replace('export async function composeViewer','async function composeViewer')
    .replaceAll('import.meta.url',JSON.stringify('https://test.local/assets/js/modules/viewer-composition.js'));
  const context=vm.createContext(bindings);vm.runInContext(source+'\nglobalThis.run=composeViewer;',context);
  await context.run({productMode:'viewer',meta:{appVersion:'test'}});
  return {window,initialLoading:()=>document.getElementById('viewer').dataset.initialLoading,status:document.getElementById('viewerStatus'),manual:()=>{manual=true;},
    stats:()=>({loads,maps,reads,disposed,nowSelections,ready}),wake:()=>window.dispatchEvent(new Event('focus'))};
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
