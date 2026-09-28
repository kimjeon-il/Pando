import assert from 'node:assert/strict';
import test from 'node:test';
import { DISTRIBUTION_SCHEMA_VERSION } from '../../assets/js/modules/distribution-model.js';
import { createDistributionService } from '../../assets/js/modules/distribution-service.js';

function fixture() {
  let layers = [], entries = [], renderMode = 'overlap';
  const transactions = [];
  const service = createDistributionService({
    documentStore: {
      readLayers: () => layers,
      replaceLayers: value => { layers = value; },
      readEntries: () => entries,
      replaceEntries: value => { entries = value; },
    },
    presentationStore: {
      setRenderMode: value => { renderMode = value; },
      setBoundaryVisible() {},
    },
    commandPipeline: {
      runMutation(meta, mutate, options) {
        transactions.push({ ...meta, renderDirty: options.renderDirty });
        return { ok: true, value: mutate() };
      },
    },
    writeLayerColor(layer, value) { layer.color = value; },
    territorialExists: id => id === 'region-a',
  });
  return { service, transactions, layers: () => layers, entries: () => entries, renderMode: () => renderMode };
}

const layerInput = (id, extra = {}) => ({
  id, schemaVersion: DISTRIBUTION_SCHEMA_VERSION, name: id, color: '#123456', unit: '', valueScale: { mode: 'auto' }, ...extra,
});

test('service owns cross-unit hierarchy and locked metadata rules', () => {
  const { service, transactions } = fixture();
  service.createLayer(layerInput('parent', { unit: '명' }));
  service.createLayer(layerInput('child', { parentId: 'parent', unit: 'km²' }));
  assert.deepEqual(service.parentCandidates('parent').map(layer => layer.id), []);
  assert.equal(service.updateLayer('parent', 'parentId', 'child').code, 'invalid');
  assert.equal(service.updateLayer('parent', 'locked', true).ok, true);
  assert.equal(service.updateLayer('parent', 'name', 'blocked').code, 'locked');
  assert.equal(service.getLayer('parent').name, 'parent');
  assert.equal(transactions.length, 3);
});

test('entry CRUD validates references, values, locks, and cascading deletion', () => {
  const { service, entries } = fixture();
  service.createLayer(layerInput('layer'));
  assert.equal(service.addEntry({ id: 'bad', layerId: 'layer', mode: 'territorial', territorialUnitId: 'missing', value: 50 }).code, 'territorial-unit-not-found');
  assert.equal(service.addEntry({ id: 'entry', layerId: 'layer', mode: 'territorial', territorialUnitId: 'region-a', value: 0 }).ok, true);
  assert.equal(service.updateEntry('entry', -2.5).ok, true);
  assert.equal(entries()[0].value, -2.5);
  assert.equal(service.updateEntry('entry', '').code, 'invalid');
  assert.equal(entries()[0].value, -2.5);
  service.updateLayer('layer', 'locked', true);
  assert.equal(service.updateEntry('entry', 1).code, 'locked');
  service.updateLayer('layer', 'locked', false);
  assert.equal(service.deleteLayer('layer').removedEntryCount, 1);
  assert.equal(entries().length, 0);
});

test('presentation defaults to overlap and supports single layer', () => {
  const { service, renderMode } = fixture();
  assert.equal(service.setRenderMode('single'), 'single');
  assert.equal(renderMode(), 'single');
  assert.equal(service.setRenderMode('unsupported'), 'overlap');
  assert.equal(renderMode(), 'overlap');
});
