import assert from 'node:assert/strict';
import test from 'node:test';
import { createDistributionService } from "../../apps/editor/frontend/js/modules/distribution-service.js";

function fixture(initial = { distributionLayers: [], distributionEntries: [], distributionSettings: { renderMode: 'overlap', boundaryVisible: true } }) {
  let projection = Object.freeze(initial), acknowledge;
  const commands = [];
  const service = createDistributionService({
    documentModel: { list: domain => projection[domain === 'distributionLayer' ? 'distributionLayers' : 'distributionEntries'] },
    commandOwner: { executeCommand(command) {
      commands.push(command);
      return new Promise(resolve => { acknowledge = (result, before, after) => {
        if (after) projection = Object.freeze(after);
        resolve({ ...result, before, after });
      }; });
    } },
  });
  return { service, commands, reply: (result, before = projection, after = projection) => acknowledge(result, before, after) };
}
const layer = (id, extra = {}) => Object.freeze({ id, name: id, locked: false, parentId: '', ...extra });

test('distribution creation and metadata wait for the canonical owner publication', async () => {
  const { service, commands, reply } = fixture();
  const options = { id: 'parent', name: '  Parent  ', color: '#123456' };
  const creation = service.createLayer(options);
  assert.equal(service.getLayer('parent'), null);
  assert.deepEqual(commands[0], { commandId: 'distribution.layer.create', targets: [{ domain: 'distributionLayer', id: 'parent' }], payload: { options } });
  const parent = layer('parent', { name: 'Parent' });
  reply({ ok: true, changed: true }, { distributionLayers: [] }, { distributionLayers: [parent], distributionEntries: [] });
  assert.equal(await creation, parent);
  const update = service.updateLayer('parent', 'name', '  Renamed  ');
  assert.equal(commands[1].payload.value, '  Renamed  ', 'Core owns the field normalization');
  assert.equal(service.getLayer('parent'), parent);
  const renamed = layer('parent', { name: 'Renamed' });
  reply({ ok: true, changed: true }, { distributionLayers: [parent] }, { distributionLayers: [renamed], distributionEntries: [] });
  assert.deepEqual(await update, { ok: true, changed: true, layer: renamed });
});

test('distribution entry result shapes come from the exact acknowledged projections', async () => {
  const parent = layer('parent');
  const { service, commands, reply } = fixture({ distributionLayers: [parent], distributionEntries: [] });
  const options = { id: 'entry', layerId: 'parent', mode: 'territorial', territorialUnitId: 'A', value: 0 };
  const create = service.addEntry(options);
  const entry = Object.freeze({ ...options });
  reply({ ok: true, changed: true }, { distributionLayers: [parent], distributionEntries: [] },
    { distributionLayers: [parent], distributionEntries: [entry] });
  assert.deepEqual(await create, { ok: true, entry, layer: parent });
  const update = service.updateEntry('entry', -2.5);
  const edited = Object.freeze({ ...entry, value: -2.5 });
  reply({ ok: true, changed: true }, { distributionLayers: [parent], distributionEntries: [entry] },
    { distributionLayers: [parent], distributionEntries: [edited] });
  assert.deepEqual(await update, { ok: true, changed: true, entry: edited });
  const noop = service.updateEntry('entry', -2.5);
  reply({ ok: true, changed: false });
  assert.deepEqual(await noop, { ok: true, changed: false });
  const remove = service.removeEntry('entry');
  reply({ ok: true, changed: true }, { distributionLayers: [parent], distributionEntries: [edited] },
    { distributionLayers: [parent], distributionEntries: [] });
  assert.deepEqual(await remove, { ok: true, entry: edited, layer: parent });
  assert.deepEqual(commands.map(command => command.commandId),
    ['distribution.entry.create', 'distribution.entry.value', 'distribution.entry.value', 'distribution.entry.remove']);
});

test('layer deletion uses the dispatch preimage instead of an earlier stale entry count', async () => {
  const parent = layer('parent');
  const { service, reply } = fixture({ distributionLayers: [parent], distributionEntries: [] });
  const pending = service.deleteLayer('parent');
  const entries = [{ id: 'new-1', layerId: 'parent' }, { id: 'new-2', layerId: 'parent' }, { id: 'other', layerId: 'other' }];
  reply({ ok: true, changed: true }, { distributionLayers: [parent], distributionEntries: entries },
    { distributionLayers: [], distributionEntries: [entries[2]] });
  assert.deepEqual(await pending, { ok: true, layer: parent, removedEntryCount: 2 });
});

test('Core validation failures retain current distribution service result fields', async () => {
  const parent = layer('parent', { locked: true });
  const { service, reply } = fixture({ distributionLayers: [parent], distributionEntries: [] });
  const locked = service.updateLayer('parent', 'name', 'blocked');
  reply({ ok: false, changed: false, error: { code: 'locked', message: 'locked object' } });
  assert.deepEqual(await locked, { ok: false, code: 'locked', layer: parent });
  const missing = service.addEntry({ id: 'entry', layerId: 'absent' });
  reply({ ok: false, changed: false, error: { code: 'layer-not-found', message: 'absent' } });
  assert.deepEqual(await missing, { ok: false, code: 'layer-not-found' });
  const invalid = service.updateEntry('entry', '');
  reply({ ok: false, changed: false, error: { code: 'invalid', message: 'non-finite value' } });
  const result = await invalid;
  assert.deepEqual(Object.keys(result).sort(), ['code', 'error', 'ok']);
  assert.equal(result.error.message, 'non-finite value');
  assert.equal(result.error.code, 'invalid');
});

test('imports preserve input target order and empty imports still reach Core', async () => {
  const { service, commands, reply } = fixture();
  const layers = [{ id: 'one' }, { id: 'two' }], entries = [{ id: 'entry', layerId: 'one' }];
  const imported = service.append({ layers, entries });
  assert.deepEqual(commands[0].targets, [{ domain: 'distributionLayer', id: 'one' },
    { domain: 'distributionLayer', id: 'two' }, { domain: 'distributionEntry', id: 'entry' }]);
  reply({ ok: true, changed: true });
  assert.deepEqual(await imported, { layers: 2, entries: 1 });
  const empty = service.append({});
  assert.equal(commands[1].commandId, 'distribution.import');
  assert.deepEqual(commands[1].payload, { layers: [], entries: [] });
  reply({ ok: true, changed: true });
  assert.deepEqual(await empty, { layers: 0, entries: 0 });
});

test('display options return Core normalization and do not write local presentation state', async () => {
  const { service, commands, reply } = fixture();
  const mode = service.setRenderMode('unsupported');
  assert.deepEqual(commands[0], { commandId: 'distribution.render-mode', targets: [], payload: { value: 'unsupported' } });
  reply({ ok: true, changed: true }, {}, { distributionLayers: [], distributionEntries: [],
    distributionSettings: { renderMode: 'overlap', boundaryVisible: true } });
  assert.equal(await mode, 'overlap');
  const boundary = service.setBoundaryVisible(false);
  reply({ ok: true, changed: true }, {}, { distributionLayers: [], distributionEntries: [],
    distributionSettings: { renderMode: 'overlap', boundaryVisible: false } });
  assert.equal(await boundary, false);
});

test('parent candidates are derived from the immutable accepted list', () => {
  const parent = layer('parent'), child = layer('child', { parentId: 'parent' }), other = layer('other');
  const { service } = fixture({ distributionLayers: Object.freeze([parent, child, other]), distributionEntries: [] });
  assert.deepEqual(service.parentCandidates('parent'), [other]);
  assert.deepEqual(service.parentCandidates('child'), [parent, other]);
  assert.deepEqual(service.listLayers(), [parent, child, other]);
});
