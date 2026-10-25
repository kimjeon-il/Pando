import assert from 'node:assert/strict';
import test from 'node:test';
import { createPropertySelection } from "../../apps/editor/frontend/js/modules/app-property-selection.js";

function held() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
function setup(method, barrier) {
  let generation = 1;
  const layer = { id: 'D', name: 'Layer', locked: false };
  const state = { selected: { domain: 'distribution', type: 'distribution', id: 'D' },
    distributionLayers: [layer], distributionEntries: [{ id: 'E', layerId: 'D', mode: 'territorial', territorialUnitId: 'A' }],
    distributionSettings: Object.freeze({ activeLayerId: 'D' }), selectedDistributionLayerId: 'D' };
  const events = [], calls = [];
  const service = { getLayer: id => id === 'D' ? layer : null,
    [method]: (...args) => { calls.push(args); return barrier.promise; } };
  const owner = createPropertySelection();
  owner.connect({ projectState: { state }, objectModelA: { distributionService: service },
    platform: { $: id => ({ value: id === 'distributionTerritorialUnitInput' ? 'A' : '3' }) },
    territorialModel: { DISTRIBUTION_MODES: { TERRITORIAL: 'territorial' }, entityRepository: { get: id => ({ id, properties: { name: id } }) } },
    distributionServices: { createDistributionEntry: value => value }, surfaces: { uid: () => 'new-entry' },
    selectionServices: { normalizeObjectRef: value => value },
    objectDisplay: { invalidateObjectPresentation: () => events.push('tree') },
    feedback: { setActionStatus: (...args) => events.push(['status',...args]) },
    domains: { projectDomain: { getGeneration: () => generation, queuePresentationAutosave: () => events.push('autosave') },
      objectSearchController: { syncLocks: refs => events.push(['locks',refs]) },
      selectionUiController: { applyIntent: value => events.push(['select',value]), clear: () => events.push('clear') } } });
  return { owner, state, layer, calls, events, switchProject: () => { generation += 1; } };
}

for (const [method, action, result] of [
  ['updateLayer', owner => owner.commitDistributionMeta('name','New name'), { ok: true, changed: true }],
  ['addEntry', owner => owner.addTerritorialDistributionEntry(), { ok: true, entry: { mode: 'territorial', territorialUnitId: 'A' } }],
  ['removeEntry', owner => owner.removeDistributionEntry('E'), { ok: true }],
  ['updateEntry', owner => owner.updateDistributionEntryValue('E','4'), { ok: true, changed: true, entry: { layerId: 'D' } }],
]) {
  test(`distribution ${method} waits for its command and preserves a later selected target`, async () => {
    const barrier = held(), fixture = setup(method, barrier);
    const pending = action(fixture.owner);
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(fixture.events, []);
    fixture.state.selected = { domain: 'generic', type: 'feature', id: 'G' };
    barrier.resolve(result);
    assert.equal(await pending, true);
    assert.equal(fixture.events.some(event => Array.isArray(event) && event[0] === 'select'), false);
  });
}

test('distribution delete waits for the device-owned command and does not clear a newly selected object', async () => {
  const barrier = held(), fixture = setup('deleteLayer', barrier);
  const pending = fixture.owner.deleteDistributionLayer('D',{ confirm: false });
  assert.deepEqual(fixture.events, []);
  fixture.state.selected = { domain: 'generic', type: 'feature', id: 'G' };
  barrier.resolve({ ok: true });
  assert.equal(await pending, true);
  assert.equal(fixture.events.includes('clear'), false);
  assert.equal(fixture.state.distributionSettings.activeLayerId, 'D');
  assert.equal(fixture.events.includes('autosave'), false);
});

test('distribution command acknowledgement from a replaced project produces no new-project UI effects', async () => {
  const barrier = held(), fixture = setup('updateLayer', barrier);
  const pending = fixture.owner.commitDistributionMeta('name','Old project edit');
  fixture.switchProject(); barrier.resolve({ ok: true, changed: true });
  assert.equal(await pending, false);
  assert.deepEqual(fixture.events, []);
});

test('distribution Worker failures propagate to the property event operation boundary', async () => {
  const barrier = held(), fixture = setup('updateLayer', barrier);
  const pending = fixture.owner.commitDistributionMeta('name','Rejected');
  const error = Object.assign(new Error('Worker unavailable'), { code: 'PL-CORE-LOAD' });
  barrier.reject(error);
  await assert.rejects(pending, failure => failure === error);
  assert.deepEqual(fixture.events, []);
});
