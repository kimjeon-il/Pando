import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../helpers/core-command-services/distribution-service.mjs";
import * as __dep3 from "../../shared/frontend/js/modules/distribution-model.js";

// Original feature contract: distribution-service.test.mjs
contractSuite("distribution-service", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { createDistributionService }=__dep2;

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
});

// Original feature contract: distribution-model.test.mjs
contractSuite("distribution-model", () => {
const test=__dep1.default;
const assert=__dep0.default;
const { DISTRIBUTION_MODES, DISTRIBUTION_SCHEMA_VERSION, createDistributionEntry, createDistributionLayer, distributionValueAlpha, distributionValueRange, normalizeDistributionEntries, normalizeDistributionLayers, validateDistributionModel }=__dep3;

const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

test('independent distributions preserve signed numbers without comparing layers', () => {
  const layers = [
    createDistributionLayer({ id: 'population', name: '인구', unit: '명', color: '#3366aa' }),
    createDistributionLayer({ id: 'temperature', name: '기온', unit: '°C', color: '#cc6644' }),
  ];
  const entries = normalizeDistributionEntries([
    createDistributionEntry({ id: 'e1', layerId: 'population', mode: 'territorial', territorialUnitId: 'attica', value: 95.5 }),
    createDistributionEntry({ id: 'e2', layerId: 'temperature', mode: 'territorial', territorialUnitId: 'attica', value: -20 }),
  ], { layerExists: id => layers.some(layer => layer.id === id) });
  assert.deepEqual(entries.map(entry => entry.value), [95.5, -20]);
  assert.equal(validateDistributionModel(layers, entries, { territorialExists: id => id === 'attica' }).ok, true);
  assert.deepEqual(distributionValueRange(layers[0], entries.filter(entry => entry.layerId === layers[0].id)), { min: 95.5, max: 95.5 });
});

test('territorial and free geometry modes normalize independently', () => {
  const layer = createDistributionLayer({ id: 'temperature', name: '기온' });
  const territorial = createDistributionEntry({ id: 'r', layerId: layer.id, mode: DISTRIBUTION_MODES.TERRITORIAL, territorialUnitId: 'unit', value: 0 });
  const geometry = createDistributionEntry({ id: 'g', layerId: layer.id, mode: DISTRIBUTION_MODES.GEOMETRY, geometry: square, value: -4.25 });
  assert.equal(territorial.geometry, null);
  assert.deepEqual(geometry.geometry, square);
});

test('canonical fields and unique IDs are required', () => {
  assert.throws(() => normalizeDistributionLayers([{ id: 'invalid', schemaVersion: DISTRIBUTION_SCHEMA_VERSION, type: 'language' }]), /지원하지 않는 필드/);
  const layer = createDistributionLayer({ id: 'same' });
  assert.throws(() => normalizeDistributionLayers([layer, layer]), /중복/);
  assert.throws(() => normalizeDistributionEntries([{
    id: 'entry', schemaVersion: DISTRIBUTION_SCHEMA_VERSION, layerId: 'same', mode: 'geometry', geometry: square, value: 1, unknownField: true,
  }]), /지원하지 않는 필드/);
});

test('missing and non-finite values fail while signed values and clamped display survive', () => {
  const base = { id: 'entry', layerId: 'layer', mode: DISTRIBUTION_MODES.GEOMETRY, geometry: square };
  for (const value of [null, '', Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => createDistributionEntry({ ...base, value }), /유한한 숫자/);
  }
  assert.equal(createDistributionEntry({ ...base, value: 0 }).value, 0);
  assert.equal(createDistributionEntry({ ...base, value: -1.5 }).value, -1.5);
  assert.equal(distributionValueAlpha(-10, { min: 0, max: 10 }), 0.12);
  assert.equal(distributionValueAlpha(20, { min: 0, max: 10 }), 0.7);
});
});

// Original feature contract: distribution-numeric-model.test.mjs
contractSuite("distribution-numeric-model", () => {
const test=__dep1.default;
const assert=__dep0.default;
const { createDistributionEntry, createDistributionLayer, distributionValueRange, distributionValueAlpha, normalizeDistributionLayers }=__dep3;

test('generic distribution stores a unit, a scale, and signed values without a type', () => {
  const parent = createDistributionLayer({ id: 'population', name: '인구밀도', unit: '명/km²' });
  const child = createDistributionLayer({ id: 'temperature', name: '기온', unit: '°C', parentId: parent.id });
  assert.equal('type' in parent, false);
  assert.equal(parent.valueScale.mode, 'auto');
  assert.equal(normalizeDistributionLayers([parent, child]).length, 2);
  const entry = createDistributionEntry({ id: 'cold', layerId: child.id, mode: 'territorial', territorialUnitId: 'region', value: -5.5 });
  assert.equal(entry.value, -5.5);
  assert.equal('share' in entry, false);
});

test('missing or invalid numbers and unordered manual ranges fail', () => {
  const base = { id: 'entry', layerId: 'layer', mode: 'territorial', territorialUnitId: 'region' };
  for (const value of [undefined, null, '', '   ', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createDistributionEntry({ ...base, value }), /유한한 숫자/);
  }
  assert.equal(createDistributionEntry({ ...base, value: 0 }).value, 0);
  assert.throws(() => createDistributionLayer({ id: 'bad', valueScale: { mode: 'manual', min: 5, max: 5 } }), /범위/);
});

test('automatic range uses all values and display alpha clamps without changing data', () => {
  const layer = createDistributionLayer({ id: 'layer' });
  const range = distributionValueRange(layer, [{ value: -10 }, { value: 0 }, { value: 20 }]);
  assert.deepEqual(range, { min: -10, max: 20 });
  assert.equal(distributionValueAlpha(-10, range), 0.12);
  assert.equal(distributionValueAlpha(20, range), 0.7);
  assert.equal(distributionValueAlpha(100, { min: 0, max: 10 }), 0.7);
  assert.equal(distributionValueAlpha(5, { min: 5, max: 5 }), 0.7);
  assert.equal(distributionValueRange(layer, []), null);
});
});
