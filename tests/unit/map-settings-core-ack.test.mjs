import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapSettings } from '../../assets/js/modules/app-map-settings.js';
import { resourceCapabilities } from '../../assets/js/modules/resource-capabilities.js';
import { createInitialDocument } from '../../assets/js/modules/initial-document.js';
import { createDistributionLayer, createDistributionEntry } from '../../assets/js/modules/distribution-model.js';

test('map settings require the existing resource capabilities', () => {
  assert.throws(() => createMapSettings(), /capabilities/i);
});

test('display menus follow registered data and available sources without changing the project', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const groups = Object.fromEntries(['objects', 'distribution', 'rivers', 'lakes', 'labels', 'genericFeatures', 'terrain']
    .map(key => [key, { classList: { contains(name) { return this[name] === true; }, toggle(name, hidden) { this[name] = hidden; } }, contains: () => false }]));
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelectorAll: () => [], querySelector: selector => groups[selector.match(/data-map-display-group="([^"]+)"/)?.[1]] || null,
  } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document; });
  const layer = createDistributionLayer({ id: 'distribution-A' });
  const entry = createDistributionEntry({ id: 'entry-A', layerId: layer.id, mode: 'territorial', territorialUnitId: 'A', value: 0 });
  const cases = [
    { name: 'empty document', data: {}, shown: [] },
    { name: 'empty distribution layer', data: { distributionLayers: [layer] }, shown: [] },
    { name: 'zero is distribution data', data: { distributionLayers: [layer], distributionEntries: [entry] }, shown: ['distribution'] },
    { name: 'project river only', data: { hydroEdits: [{ properties: { category: 'river' } }] }, shown: ['rivers'] },
    { name: 'project lake only', data: { hydroEdits: [{ properties: { category: 'lake' } }] }, shown: ['lakes'] },
    { name: 'registered objects and labels', data: { territorialEntities: [{ id: 'A' }], labels: [{ id: 'label-A' }], genericFeatures: [{ id: 'feature-A' }] }, shown: ['objects', 'labels', 'genericFeatures'] },
    { name: 'unloaded builtin sources remain available', data: {}, builtin: true, shown: ['rivers', 'lakes', 'labels'] },
    { name: 'viewer retains supported terrain', data: {}, productMode: 'viewer', shown: ['terrain'] },
  ];
  for (const { name, data, builtin = false, productMode = 'editor', shown } of cases) {
    const state = { ...createInitialDocument({ appVersion: '0.36.0' }), ...data, layerVisibility: { objects: false, rivers: false, lakes: false, labels: false, distributions: false },
      distributionSettings: { renderMode: 'overlap', activeLayerId: '', boundaryVisible: true }, hydroManifest: null };
    const before = structuredClone(state);
    const settings = createMapSettings({ capabilities: resourceCapabilities(productMode, { builtinHydroAvailable: builtin, builtinPlacesAvailable: builtin }) });
    settings.connect({ projectState: { state }, platform: { $: id => id === 'distributionMenuGroup' ? groups.distribution : null },
      feedback: { reportOperationError: error => assert.fail(error.stack) }, objectModelA: { expandedMapDisplayGroups: new Set() },
      preferences: { userPreferences: { labels: { place: { languages: {} } } } }, hydroModel: { syncPhysicalControls() {} } });
    settings.initializeLAYER_STYLE_TARGETS();
    settings.renderMapDisplaySettings();
    assert.deepEqual(Object.keys(groups).filter(key => !groups[key].classList.hidden), shown, name);
    assert.deepEqual(state, before, name + ' must not write project or viewing data');
  }
});

function fixture(t,{ projectReady=true }={}) {
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{ configurable: true,value: { querySelectorAll: () => [],querySelector: () => null } });
  t.after(() => { if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document; });
  let resolve,reject,generation=1,visibility=Object.freeze({ objects: true });
  const events=[],calls=[],state=Object.freeze({ get layerVisibility() { return visibility; },layerPresentation: Object.freeze({}) });
  const project={ getGeneration: () => generation,executeCommand: envelope => {
    calls.push(envelope);return new Promise((yes,no) => { resolve=yes;reject=no; });
  } };
  const settings=createMapSettings({capabilities:resourceCapabilities('editor')});
  settings.connect({ projectState: { state },platform: { $: () => null },feedback: { reportOperationError: error => { throw error; } },
    objectModelA: { expandedMapDisplayGroups: new Set() },preferences: { userPreferences: { labels: { place: { languages: { ko: true } } } } },
    objectDisplay: { invalidateObjectPresentation: () => events.push('tree') },
    rendering: { gpuMapRenderer: { invalidateCountryPalette: () => events.push('palette') } },
    domains: { get projectDomain() { return projectReady ? project : null; },
      renderingDomain: { invalidateBaseScene: () => events.push('base'),invalidateLabels: () => events.push('labels') } } });
  return { settings,state,events,calls,complete(ack={ ok: true,changed: true }) { visibility=Object.freeze({ objects: false });resolve(ack); },
    fail: error=>reject(error),switchProject() { generation+=1; },connectProject() { projectReady=true; } };
}

test('map settings prepare static targets before Core admission and require its owner when binding input',t => {
  const f=fixture(t,{ projectReady: false });
  assert.doesNotThrow(() => f.settings.initializeLAYER_STYLE_TARGETS());
  assert.throws(() => f.settings.bindMapDisplayUI(),/Core project command owner/);
  f.connectProject();
  assert.doesNotThrow(() => f.settings.bindMapDisplayUI());
});
test('map visibility dispatches one typed intent and updates presentation only after its accepted Core ACK',async t => {
  const f=fixture(t),pending=f.settings.setLayerVisibility('objects',false);
  assert.equal(f.state.layerVisibility.objects,true);assert.deepEqual(f.events,[]);
  assert.deepEqual(f.calls,[{ commandId: 'presentation.apply',targets: [],payload: { action: 'visibility',key: 'objects',visible: false } }]);
  await f.complete();await pending;
  assert.equal(f.state.layerVisibility.objects,false);assert.deepEqual(f.events,['tree','palette','base','labels']);
});
test('old map visibility ACK cannot publish effects after a project replacement',async t => {
  const f=fixture(t),pending=f.settings.setLayerVisibility('objects',false);f.switchProject();f.complete();
  assert.equal(await pending,false);assert.deepEqual(f.events,[]);
});
test('failed map intent does not write immutable state or hide its technical error',async t => {
  const f=fixture(t),pending=f.settings.setLayerVisibility('objects',false),failure=Object.assign(new Error('Core rejected view'),{ code: 'STALE_REVISION' });
  f.fail(failure);await assert.rejects(pending,error=>error===failure);
  assert.equal(f.state.layerVisibility.objects,true);assert.deepEqual(f.events,[]);
});
