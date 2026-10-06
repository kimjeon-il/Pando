import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationLifecycle } from '../../assets/js/modules/application-lifecycle.js';
import { createProjectUiBridge } from '../../assets/js/modules/project-ui-bridge.js';
import { createPropertyEditorBindings } from '../../assets/js/modules/property-editor-bindings.js';
import { createMapInputPresentation } from '../../assets/js/modules/map-input-presentation.js';
import { createGisWorkflowController } from '../../assets/js/modules/gis-workflow-controller.js';
import { createMapDebugController } from '../../assets/js/modules/map-debug-controller.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';

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

test('history UI routes preview/draft/project actions without owning history mutation', () => {
  const calls = [];
  let preview = true;
  let draft = false;
  const ui = createProjectUiBridge({
    getElement: () => null,
    requireCanonicalData: () => true, getEditingSnapshot: () => ({ processing: false, previewActive: preview }),
    discardActiveGeometryPreview: () => calls.push('preview'), draftInputActive: () => draft,
    undoDraft: () => calls.push('draft'), undoProject: () => { calls.push('project'); return true; },
    setActionStatus: () => calls.push('status'),
  });
  ui.undo();
  preview = false; draft = true; ui.undo();
  draft = false; ui.undo();
  assert.deepEqual(calls, ['preview', 'draft', 'project', 'status']);
});

test('new project waits for confirmation and save presenter only changes DOM', () => {
  let confirmation;
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
    openConfirmModal: options => { confirmation = options; }, createEmptyProject: () => resets++,
  });
  ui.requestNew();
  assert.equal(confirmation.title, '새 프로젝트');
  assert.equal(resets, 0);
  confirmation.onConfirm();
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
    createEmptyProject: () => resets++, setActionStatus: (...args) => statuses.push(args),
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
  let inputOptions;
  let state = { moving: false, projection: 'flat', flatZoom: 2, globeZoom: 3, tool: 'select' };
  const events = [];
  const window = fakeWindow();
  window.addEventListener('pandolab:interaction-state', event => events.push(event.detail.active));
  const svg = { on() { return this; } };
  const bridge = createMapInputPresentation({
    getElement: () => new FakeElement(), window, navigator: {}, d3: {},
    getInputSnapshot: () => ({ ...state }), setMoving: value => { state.moving = value; },
    getQualityTier: () => 'normal', createMapInputController: options => { inputOptions = options; return { destroy() {} }; },
    renderQualityController: { beginInteraction() {}, endInteraction() {} }, applyAdaptiveRenderQuality() {},
    renderingDomain: { beginInteraction() {}, endInteraction() {} },
    mapWorkScheduler: { setInteractionActive() {} },
    gpuMapRenderer: { setHydroInteractionActive() {}, prioritizeLatest() {} },
    editingDomain: { clearDraftHover() {} }, cancelCountryHoverPick() {},
    projectDomain: { queueViewAutosave: () => events.push('autosave') },
  });
  bridge.bindSvg(svg);
  assert.equal(inputOptions.getZoom(), 2);
  state = { ...state, projection: 'globe' };
  assert.equal(inputOptions.getZoom(), 3);
  bridge.beginMovement(); bridge.beginMovement();
  bridge.finishMovement(); bridge.finishMovement();
  assert.deepEqual(events, [true, false, 'autosave']);
  bridge.dispose();
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

test('map hover identifies territorial labels and areas through the same selection domain without selecting', () => {
  const handlers = new Map(), hovers = [], picks = [];
  const ref = { domain: 'territorial', type: 'entity', id: 'DEU' };
  let label = { dataset: { labelId: 'DEU' } };
  const d3 = { mouse: () => [100, 120], event: { target: { closest: selector => selector === '.territorial-label-item[data-label-id]' ? label : null } } };
  const bridge = createMapInputPresentation({
    getElement: () => new FakeElement(), window: fakeWindow(), navigator: {}, d3,
    createMapInputController: () => ({ destroy() {}, isPanning: () => false }),
    getInputSnapshot: () => ({ tool: 'select' }), getDraftSnapshot: () => ({}),
    isGenericFeatureDraftTool: () => false, isMobile: () => false, screenToGeo: () => [0, 0],
    getTerritorialLabelRef: id => id === 'DEU' ? ref : null,
    cancelCountryHoverPick() {}, queueCountryHoverPick: (...args) => picks.push(args),
    selectionDomain: { setHover: value => hovers.push(value) },
  });
  bridge.bindSvg({ on(type, callback) { handlers.set(type, callback); return this; } });
  handlers.get('mousemove')();
  assert.deepEqual(hovers, [ref]); assert.deepEqual(picks, []);
  label = null; handlers.get('mousemove')();
  assert.deepEqual(picks, [[[100, 120], [0, 0]]]);
});
