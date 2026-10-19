import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapSettings } from '../../assets/js/modules/app-map-settings.js';

function fixture(t,{ projectReady=true }={}) {
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{ configurable: true,value: { querySelectorAll: () => [],querySelector: () => null } });
  t.after(() => { if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document; });
  let resolve,reject,generation=1,visibility=Object.freeze({ objects: true });
  const events=[],calls=[],state=Object.freeze({ get layerVisibility() { return visibility; },layerPresentation: Object.freeze({}) });
  const project={ getGeneration: () => generation,executeCommand: envelope => {
    calls.push(envelope);return new Promise((yes,no) => { resolve=yes;reject=no; });
  } };
  const settings=createMapSettings();
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
