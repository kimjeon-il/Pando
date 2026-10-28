import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationLifecycle } from "../../shared/frontend/js/modules/application-lifecycle.js";
import { createProjectUiBridge } from "../../apps/editor/frontend/js/modules/project-ui-bridge.js";
import { createPropertyEditorBindings } from "../../apps/editor/frontend/js/modules/property-editor-bindings.js";
import { createMapInputPresentation } from "../../shared/frontend/js/modules/map-input-presentation.js";
import {createMapInputController} from '../../shared/frontend/js/modules/map-input-controller.js';
import {createPointerTargets} from '../../shared/frontend/js/modules/pointer-targets.js';
import {createMapInteractionGate} from '../../shared/frontend/js/modules/map-interaction-gate.js';
import { createGisWorkflowController } from "../../apps/editor/frontend/js/modules/gis-workflow-controller.js";
import { createMapDebugController } from "../../apps/editor/frontend/js/modules/map-debug-controller.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";

const { EventTarget, Event, CustomEvent } = globalThis;

class FakeElement extends EventTarget {
  addEventListener(type, listener, options) {
    if (listener != null) super.addEventListener(type, listener, options);
  }
  dataset = {};
  classList = { toggle() {}, add() {}, remove() {} };
  setAttribute() {}
  querySelector() { return null; }
}
function fakeWindow() {
  return Object.assign(new EventTarget(), { CustomEvent });
}

test('one lifecycle awaits asynchronous ready work and suppresses completion after disposal',async()=>{
  const window=fakeWindow(),events=[];let release,entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  window.addEventListener('pandolab:ready',()=>events.push('ready'));
  const lifecycle=createApplicationLifecycle({window,startup:async()=>{},onReady:async({isActive})=>{
    entered();await new Promise(resolve=>{release=resolve;});if(isActive())events.push('attached');
  }});
  const start=lifecycle.start();assert.equal(lifecycle.start(),start);await waiting;
  assert.deepEqual(events,[]);lifecycle.dispose();release();assert.equal(await start,false);assert.deepEqual(events,[]);
});

test('composition runs before startup once, and BFCache does not dispose domains', async () => {
  const window = fakeWindow();
  const events = [];
  const lifecycle = createApplicationLifecycle({
    window, compose: [() => events.push('ui'), () => events.push('domains'), () => events.push('input')],
    startup: () => events.push('startup'), onReady: () => events.push('ready'),
    getDisposables: () => [{ dispose: () => events.push('dispose') }],
  });
  const start = lifecycle.start();
  assert.equal(lifecycle.start(), start);
  assert.equal(await start, true);
  assert.deepEqual(events, ['ui', 'domains', 'input', 'startup', 'ready']);
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  assert.equal(events.includes('dispose'), false);
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
  lifecycle.dispose();
  assert.equal(events.filter(value => value === 'dispose').length, 1);
});

test('composition failure is caught before startup; all remaining resources are disposed', async () => {
  const events = [];
  const lifecycle = createApplicationLifecycle({
    window: fakeWindow(), compose: [() => { throw new Error('factory failed'); }],
    startup: () => assert.fail('startup must not run'), onError: error => events.push(error.message),
    getDisposables: () => [{ dispose() { throw new Error('dispose failed'); } }, { dispose: () => events.push('released') }],
  });
  assert.equal(await lifecycle.start(), false);
  assert.deepEqual(events, ['factory failed', 'released']);
});

test('page termination during startup never emits a late ready event', async () => {
  let finish;
  const lifecycle = createApplicationLifecycle({
    window: fakeWindow(), startup: () => new Promise(resolve => { finish = resolve; }),
    onReady: () => assert.fail('late ready'),
  });
  const start = lifecycle.start();
  await Promise.resolve();
  lifecycle.dispose();
  finish();
  assert.equal(await start, false);
});

test('history UI routes preview/draft/project actions without owning history mutation', async () => {
  const calls = [];
  let preview = true;
  let draft = false;
  const ui = createProjectUiBridge({
    getElement: () => null,
    requireCanonicalData: () => true, getEditingSnapshot: () => ({ processing: false, previewActive: preview }),
    getDraftSnapshot: () => ({ historyCount: 1, futureCount: 0 }), canUndo: () => true, canRedo: () => false,
    returnToEditing: () => calls.push('preview'), draftInputActive: () => draft,
    undoDraft: () => calls.push('draft'), undoProject: () => { calls.push('project'); return true; },
    setActionStatus: () => calls.push('status'),
  });
  await ui.undo();
  preview = false; draft = true; await ui.undo();
  draft = false; await ui.undo();
  assert.deepEqual(calls, ['preview', 'draft', 'project', 'status']);
});

test('preview recovery works without project history and blocks redo and duplicate requests', async () => {
  const elements = new Map(['undoBtn','redoBtn','mobileUndoBtn','mobileRedoBtn'].map(id => [id, {dataset:{}, setAttribute(){}, removeAttribute(){}}]));
  let preview = true, draft = false, restored = 0, projectUndos = 0, release;
  const ui = createProjectUiBridge({getElement: id => elements.get(id), requireCanonicalData: () => true,
    getEditingSnapshot: () => ({processing:false,previewActive:preview}),
    getDraftSnapshot: () => ({historyCount:0,futureCount:0}), draftInputActive: () => draft,
    canUndo: () => false, canRedo: () => true,
    returnToEditing: async () => {restored++; await new Promise(resolve => {release=resolve;}); preview=false;draft=true;},
    undoDraft: () => assert.fail('empty draft'), undoProject: () => {projectUndos++;}, setActionStatus() {},
  });
  ui.syncHistory();
  assert.equal(elements.get('undoBtn').disabled,false);
  assert.equal(elements.get('undoBtn').dataset.tooltip,'미리보기에서 수정으로 돌아가기');
  assert.equal(elements.get('redoBtn').disabled,true);
  const pending=ui.undo(); await ui.undo(); assert.equal(restored,1); release(); await pending;
  await ui.undo(); assert.equal(projectUndos,0); assert.equal(elements.get('undoBtn').disabled,true);
});

test('new project opens setup before creation and save presenter only changes DOM', () => {
  let setup,opened;
  let resets = 0;
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id);
  };
  const snapshot = Object.freeze({ file: 'saved', hasUnsavedChanges: false });
  const ui = createProjectUiBridge({
    getElement, getSaveSnapshot: () => snapshot, closeFileMenu() {},
    getAutosaveRecovery: () => null,
    setupDialogFactory: options => {setup=options;return {open:()=>{opened=true;}};},createProject:()=>resets++,
  });
  ui.requestNew();
  assert.equal(opened,true);
  assert.equal(resets, 0);
  setup.createProject();
  assert.equal(resets, 1);
  ui.syncSaveStatus();
  assert.equal(getElement('projectSaveStatusText').textContent, '저장됨');
});

test('new project defers to pending autosave recovery without resetting', async () => {
  const confirmations = [];
  const statuses = [];
  let resets = 0;
  let menuCloses = 0;
  const recovery = { kind: 'conflict', candidates: [{ source: 'indexeddb' }, { source: 'localstorage' }] };
  const ui = createProjectUiBridge({
    getElement: () => null,
    getSaveSnapshot: () => ({ file: 'saved', hasUnsavedChanges: false, autosaveRecovery: true }),
    getEditingSnapshot: () => ({ processing: false }), requireCanonicalData: () => true,
    getAutosaveRecovery: () => recovery,
    closeFileMenu: () => menuCloses++, openConfirmModal: options => confirmations.push(options),
    createProject: () => resets++, setActionStatus: (...args) => statuses.push(args),
  });
  ui.requestNew();
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].title, '저장본 선택');
  assert.deepEqual(confirmations[0].choices.map(choice => choice.value), ['indexeddb', 'localstorage']);
  assert.equal(resets, 0);
  assert.equal(menuCloses, 0);
  const pending = ui.requestAutosaveRecovery();
  assert.equal(confirmations.length, 1);
  confirmations[0].onCancel();
  assert.equal(await pending, null);
  assert.equal(resets, 0);
  assert.equal(menuCloses, 0);
  assert.deepEqual(statuses, []);
});

test('generic object bindings pass the current parent contract and detach on dispose', () => {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement());
    return elements.get(id);
  };
  const conversions = [];
  const bindings = createPropertyEditorBindings({
    getElement, bindColorPickers() {}, document: {},
    reportOperationError: error => assert.fail(error.stack),
    getPrimary: () => ({ domain: 'generic', id: 'generic-1' }),
    convertSelectedGenericFeature: options => conversions.push(options),
  });
  bindings.bind(); bindings.bind();
  getElement('genericFeatureConvertType').value = 'general';
  getElement('genericFeatureConvertParentInput').value = 'parent-1';
  getElement('genericFeatureConvertDistributionInput').value = 'layer-1';
  getElement('genericFeatureConvertDistributionValueInput').value = '';
  getElement('convertGenericFeatureBtn').dispatchEvent(new Event('click'));
  assert.deepEqual(conversions, [{
    target: 'general',
    parentId: 'parent-1',
    distributionLayerId: 'layer-1',
    distributionValue: '',
  }]);
  bindings.dispose();
  getElement('convertGenericFeatureBtn').dispatchEvent(new Event('click'));
  assert.equal(conversions.length, 1);
});

test('common entity actions await completion inside the existing operation error boundary', async () => {
  const buttons = new Map(['editEntityBorderBtn', 'reconcileEntityCoastBtn'].map(id => [id, new FakeElement()]));
  const completed = [], errors = [];
  let settle, operation;
  const result = new Promise(resolve => { settle = resolve; });
  const bindings = createPropertyEditorBindings({
    getElement: id => buttons.get(id), bindColorPickers() {}, document: {},
    reportOperationError: error => assert.fail(error.stack),
    getPrimary: () => ({ domain: 'territorial', type: 'entity', id: 'child' }),
    entityRepository: { get: () => ({ id: 'child', properties: { entityKind: 'general', parentId: 'parent', locked: false } }) },
    requestDraftDiscard: action => action(),
    runModePrimaryAction: action => {
      operation = (async () => { try { return await action(); } catch (error) { errors.push(error); return false; } })();
      return operation;
    },
    runEntityEditAction: (action, id) => {
      assert.equal(action, 'boundary'); assert.equal(id, 'child'); return result;
    },
    completeToolStart: started => { completed.push(started); return started; },
    reconcileAdminCountryCoast: async () => { throw new Error('coast runtime unavailable'); },
  });
  bindings.bind();
  buttons.get('editEntityBorderBtn').dispatchEvent(new Event('click'));
  assert.deepEqual(completed, []);
  settle(true);
  assert.equal(await operation, true);
  assert.deepEqual(completed, [true]);
  buttons.get('reconcileEntityCoastBtn').dispatchEvent(new Event('click'));
  assert.equal(await operation, false);
  assert.equal(errors[0].message, 'coast runtime unavailable');
  bindings.dispose();
});

test('flat/globe input reads current zoom and movement transitions stay single-shot', () => {
  let inputOptions,state={mapMoving:false,projection:'flat',view:{flatZoom:2,globeZoom:3},tool:'select'};
  const events=[],window=fakeWindow();window.addEventListener('pandolab:interaction-state',event=>events.push(event.detail.active));
  const bridge=createMapInputPresentation({productMode:'editor',window,navigator:{},getRevision:()=>1,mapInteractionGate:{},
    createMapInputController:options=>{inputOptions=options;return {destroy(){}};},
    editing:{domain:{clearDraftHover(){}},getDraftSnapshot:()=>({}),dispatchInteraction(){}},
    ports:{platform:{$:()=>new FakeElement(),d3:{select:()=>({on(){return this;}})}},
      projectState:{get state(){return state;},mapWorkScheduler:{setInteractionActive(){}}},
      renderScene:{currentRenderQuality:{tier:'normal'}},renderQuality:{renderQualityController:{beginInteraction(){},endInteraction(){}},applyAdaptiveRenderQuality(){}},
      rendering:{gpuMapRenderer:{setHydroInteractionActive(){},prioritizeLatest(){}}},
      domains:{renderingDomain:{beginInteraction(){},endInteraction(){}},projectDomain:{queueViewAutosave:()=>events.push('autosave')}},
      pointerInteractionA:{cancelCountryHoverPick(){}},pointerInteractionB:{},navigation:{},surfaces:{},objectPicking:{},mapView:{},
      feedback:{reportOperationError:error=>{throw error;}}}});
  bridge.bindSvg({on(){return this;}});assert.equal(inputOptions.getZoom(),2);
  state={...state,projection:'globe'};assert.equal(inputOptions.getZoom(),3);
  bridge.beginMovement();bridge.beginMovement();bridge.finishMovement();bridge.finishMovement();
  assert.deepEqual(events,[true,false,'autosave']);bridge.dispose();
});

test('shared input uses canonical state and reports a hover rejection with its operation code',async()=>{
 const events=[],errors=[],state={mapMoving:false,tool:'select',projection:'flat',view:{flatZoom:2,globeZoom:3}};
 const hover={on(name,fn){events[name]=fn;return this;}},window=fakeWindow();
 const failure=new Error('selection rejected');
 const bridge=createMapInputPresentation({productMode:'viewer',window,navigator:{},getRevision:()=>1,
  createMapInputController:()=>({destroy(){}}),mapInteractionGate:{},
  ports:{platform:{$:()=>new FakeElement(),d3:{select:()=>hover}},projectState:{state},renderScene:{},renderQuality:{},rendering:{},navigation:{},mapView:{},objectPicking:{},surfaces:{},
   pointerInteractionA:{cancelCountryHoverPick(){}},pointerInteractionB:{},interactionStateCommands:{setHoverHit(){}},
   domains:{selectionDomain:{setHover:()=>Promise.reject(failure)}},feedback:{reportOperationError:(...args)=>errors.push(args)}}});
 bridge.bindSvg({on(){return this;}});events['mouseleave.map-input']();await new Promise(resolve=>globalThis.setImmediate(resolve));
 assert.equal(errors.length,1);assert.equal(errors[0][0],failure);assert.equal(errors[0][2],'PL-SELECTION-HOVER-001');
 assert.notEqual(errors[0][1],errors[0][2]);bridge.dispose();bridge.dispose();
});

test('both products select once and discard touch releases after replacement or input disposal',()=>{
 for(const productMode of ['viewer','editor']){
  const map=new FakeElement(),state={tool:'select',projection:'flat',view:{flatZoom:1,globeZoom:1}},window=fakeWindow();let clicks=0,clickHandler,revision=1;
  map.getBoundingClientRect=()=>({left:0,top:0});
  const d3={select:()=>({on(){return this;}}),mouse:()=>[20,20]},targets=createPointerTargets();targets.connect({platform:{d3},projectState:{state}});
  const bridge=createMapInputPresentation({productMode,window,navigator:{},createMapInputController,getRevision:()=>revision,
   mapInteractionGate:createMapInteractionGate(),
   editing:productMode==='editor'?{domain:{draftInputActive:()=>false},getDraftSnapshot:()=>({inputPhase:'idle'})}:null,
   ports:{platform:{$:()=>map,d3},projectState:{state},renderScene:{},renderQuality:{},rendering:{},navigation:{},mapView:{},surfaces:{isMobile:()=>true},
    objectPicking:{handleMapClick:()=>{clicks++;}},domains:{},pointerInteractionA:{cancelCountryHoverPick(){},mapNavigationEnabled:()=>true,mapClickBlocked:targets.mapClickBlocked},pointerInteractionB:{suppressNextMapClick:targets.suppressNextMapClick},feedback:{reportOperationError:error=>{throw error;}}}});
  const svg={on(name,fn){if(name==='click')clickHandler=fn;return this;}};
  const pointer=type=>map.dispatchEvent(Object.assign(new Event(type),{button:0,pointerId:1,pointerType:'touch',clientX:20,clientY:20}));
  bridge.bindSvg(svg);pointer('pointerdown');pointer('pointerup');
  assert.equal(clicks,1,productMode+' must handle a real touch release');clickHandler.call(map);assert.equal(clicks,1,'late browser click must not select twice');
  pointer('pointerdown');revision++;pointer('pointerup');assert.equal(clicks,1,'replacement cancels an old gesture');
  pointer('pointerdown');bridge.dispose();pointer('pointerup');assert.equal(clicks,1,'disposed input cannot select');
  bridge.bindSvg(svg);pointer('pointerdown');pointer('pointerup');assert.equal(clicks,2,'rebinding installs one input owner');
  bridge.dispose();bridge.dispose();assert.equal(clickHandler,null);
 }
});

test('map pinch cancellation waits for the draft owner and reports a rejected Core acknowledgement once', async () => {
  let inputOptions,reject;const pending=new Promise((resolve,fail)=>{reject=fail;}),errors=[],dispatched=[];
  const bridge=createMapInputPresentation({productMode:'editor',window:fakeWindow(),navigator:{},getRevision:()=>1,mapInteractionGate:{},
    createMapInputController:options=>{inputOptions=options;return {destroy(){}};},
    editing:{domain:{cancelActiveGesture:()=>pending},dispatchInteraction:(...args)=>{dispatched.push(args);return true;}},
    ports:{platform:{$:()=>new FakeElement(),d3:{select:()=>({on(){return this;}})}},projectState:{},rendering:{},renderScene:{},renderQuality:{},domains:{},
      pointerInteractionA:{cancelCountryHoverPick(){}},pointerInteractionB:{},navigation:{},surfaces:{},objectPicking:{},mapView:{},
      feedback:{reportOperationError:(...args)=>errors.push(args)}}});
  bridge.bindSvg({on(){return this;}});const operation=inputOptions.cancelStroke('pinch');
  assert.deepEqual(dispatched,[]);assert.deepEqual(errors,[]);
  const error=Object.assign(new Error('Draft cancellation source changed'),{code:'STALE_REVISION'});reject(error);assert.equal(await operation,false);
  assert.equal(errors.length,1);assert.equal(errors[0][0],error);assert.equal(errors[0][2],'PL-DRAFT-CANCEL-001');
  assert.deepEqual(dispatched,[]);bridge.dispose();
});

function gisFixture(loadFailure = false) {
  let loads = 0;
  let builds = 0;
  let options;
  const entity = (id, name, entityKind = 'general', parentId = '') => createTerritorialFeature({
    id, name, entityKind, parentId,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]] },
  });
  let countries = { features: [entity('A', 'Alpha')] };
  let units = [entity('child-a', 'Alpha child', 'general', 'A'), entity('region-a', 'Region', 'regional')];
  const service = {};
  const workflow = createGisWorkflowController({
    loadRuntime: async () => {
      loads++;
      if (loadFailure && loads === 1) throw new Error('network failed');
      return {
        createGisImportWizardController: value => { options = value; return { open() {} }; },
        importServiceModule: {
          createGisGeometryValidator: () => ({ validate: value => value, dispose() {} }),
          createCountryImportMergePlanner: () => () => 'plan',
          createImportService: () => { builds++; return service; },
        },
      };
    },
    onRuntimeReady() {}, getCountries: () => countries, getTerritorialUnits: () => units,
    getSaveSnapshot: () => ({ hasUnsavedChanges: false }),
    countryName: feature => feature.properties.name, territorialEntityName: feature => feature.properties.name,
    layerNameCollator: new Intl.Collator('en'),
  });
  return { workflow, service, counts: () => [loads, builds], options: () => options.getOptions(), replace: () => {
    countries = { features: [entity('B', 'Beta')] }; units = [entity('child-b', 'Beta child', 'general', 'B')];
  } };
}

test('GIS runtime stays lazy, coalesces first use and wizard options read the current project', async () => {
  const f = gisFixture();
  assert.deepEqual(f.counts(), [0, 0]);
  const first = f.workflow.ensure();
  assert.equal(f.workflow.ensure(), first);
  assert.equal(await first, f.service);
  assert.deepEqual(f.counts(), [1, 1]);
  assert.deepEqual(f.options().coastReferenceOptions, [{ id: 'A', name: 'Alpha' }]);
  assert.deepEqual(f.options().parentOptions, [{ id: 'A', name: 'Alpha' }, { id: 'child-a', name: 'Alpha child' }]);
  f.replace();
  assert.deepEqual(f.options().coastReferenceOptions, [{ id: 'B', name: 'Beta' }]);
  assert.deepEqual(f.options().parentOptions, [{ id: 'B', name: 'Beta' }, { id: 'child-b', name: 'Beta child' }]);
  f.workflow.dispose();
  await assert.rejects(f.workflow.ensure(), /disposed/);
});

test('failed GIS module loading can retry without duplicate service construction', async () => {
  const f = gisFixture(true);
  await assert.rejects(f.workflow.ensure(), /network failed/);
  assert.equal(await f.workflow.ensure(), f.service);
  assert.deepEqual(f.counts(), [2, 1]);
});

test('debug facade reads live view values instead of capturing install-time revision', () => {
  let revision = 1;
  const window = {};
  const controller = createMapDebugController({
    window, location: { search: '?debug=1' },
    readDiagnostics: () => ({ viewRevision: revision }),
    updateProjection() {}, projectionViewSnapshot: () => ({ kind: 'flat' }), deepClone: structuredClone,
  });
  controller.installViewFacade();
  assert.equal(window.__PANDOLAB_VIEW_DEBUG__.snapshot().revision, 1);
  revision = 2;
  assert.equal(window.__PANDOLAB_VIEW_DEBUG__.snapshot().revision, 2);
});
