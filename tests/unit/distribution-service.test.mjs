import assert from 'node:assert/strict';
import test from 'node:test';

import { DISTRIBUTION_SCHEMA_VERSION, DISTRIBUTION_TYPES } from '../../assets/js/modules/distribution-model.js';
import { createDistributionService } from '../../assets/js/modules/distribution-service.js';

function fixture() {
  let layers = [];
  let entries = [];
  let renderMode = 'dominant';
  const transactions = [];
  const commandPipeline = {
    runMutation(meta, mutate, options) {
      transactions.push({ ...meta, renderDirty: options.renderDirty });
      const value = mutate();
      return { ok: true, value };
    },
  };
  const service = createDistributionService({
    documentStore: {
      readLayers: () => layers,
      replaceLayers: value => { layers = value; },
      readEntries: () => entries,
      replaceEntries: value => { entries = value; },
    },
    presentationStore: {
      setRenderMode: value => { renderMode = value; },
    },
    commandPipeline,
    writeLayerColor(layer, value) { layer.color = value; },
    territorialExists: id => id === 'region-a',
  });
  return { service, transactions, layers: () => layers, entries: () => entries, renderMode: () => renderMode };
}

const layerInput = (id, extra = {}) => ({
  id, schemaVersion: DISTRIBUTION_SCHEMA_VERSION, type: DISTRIBUTION_TYPES.LANGUAGE,
  name: id, color: '#123456', ...extra,
});

test('distribution service owns layer hierarchy and locked metadata rules', () => {
  const { service, transactions } = fixture();
  service.createLayer(layerInput('parent'));
  service.createLayer(layerInput('child', { parentId: 'parent' }));
  assert.deepEqual(service.parentCandidates('parent').map(layer => layer.id), []);
  assert.equal(service.updateLayer('parent', 'parentId', 'child').code, 'invalid');
  assert.equal(service.updateLayer('parent', 'locked', true).ok, true);
  assert.equal(service.updateLayer('parent', 'name', 'blocked').code, 'locked');
  assert.equal(service.getLayer('parent').name, 'parent');
  assert.equal(transactions.length, 3);
});

test('distribution entry CRUD validates territorial references and cascades layer deletion', () => {
  const { service, entries } = fixture();
  service.createLayer(layerInput('layer'));
  assert.equal(service.addEntry({ id: 'bad', layerId: 'layer', mode: 'territorial', territorialUnitId: 'missing', share: 50 }).code, 'territorial-unit-not-found');
  const added = service.addEntry({ id: 'entry', layerId: 'layer', mode: 'territorial', territorialUnitId: 'region-a', share: 50 });
  assert.equal(added.ok, true);
  assert.equal(entries().length, 1);
  assert.equal(service.deleteLayer('layer').removedEntryCount, 1);
  assert.equal(entries().length, 0);
});

test('distribution presentation bridge normalizes render mode', () => {
  const { service, renderMode } = fixture();
  assert.equal(service.setRenderMode('intensity'), 'intensity');
  assert.equal(renderMode(), 'intensity');
  assert.equal(service.setRenderMode('unsupported'), 'dominant');
  assert.equal(renderMode(), 'dominant');
});
