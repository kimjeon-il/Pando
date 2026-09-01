import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERIC_FEATURE_SCHEMA_VERSION,
  createGenericFeatureService,
  genericFeatureGeometryKind,
  normalizeGenericFeatureCollection,
} from '../../assets/js/modules/generic-feature-service.js';

const genericFeature = (id, geometry = { type: 'Point', coordinates: [1, 2] }) => ({
  type: 'Feature', id, geometry, properties: { name: id, role: 'generic', color: '#123456' },
});

test('genericFeature normalization keeps canonical generic semantics and rejects duplicate IDs', () => {
  const normalized = normalizeGenericFeatureCollection([genericFeature('one')]);
  assert.equal(normalized[0].properties.role, 'generic');
  assert.equal(normalized[0].properties.schemaVersion, GENERIC_FEATURE_SCHEMA_VERSION);
  assert.equal(normalized[0].properties.color, '#123456');
  assert.throws(() => normalizeGenericFeatureCollection([genericFeature('legacy', { type: 'Point', coordinates: [1, 2] })].map(feature => ({
    ...feature, properties: { ...feature.properties, category: 'custom' },
  }))), /지원하지 않는 필드 category/);
  assert.equal(genericFeatureGeometryKind(normalized[0]), 'point');
  assert.throws(() => normalizeGenericFeatureCollection([genericFeature('one'), genericFeature('one')]), /중복/);
});

test('genericFeature service owns create, metadata, and delete transactions', () => {
  let genericFeatures = [];
  const transactions = [];
  const service = createGenericFeatureService({
    documentStore: {
      readFeatures: () => genericFeatures,
      replaceFeatures: value => { genericFeatures = value; },
    },
    runDocumentMutation(meta, mutate) { transactions.push(meta); return mutate(); },
    writeColor(feature, value) { feature.properties.color = value; },
  });
  service.add(genericFeature('one'));
  service.updateMetadata('one', 'color', '#abcdef');
  assert.equal(service.get('one').properties.color, '#abcdef');
  let removed = '';
  service.remove('one', { beforeRemove: feature => { removed = feature.id; } });
  assert.equal(removed, 'one');
  assert.equal(service.list().length, 0);
  assert.deepEqual(transactions.map(meta => meta.type), ['generic-feature-create', 'generic-feature-metadata', 'generic-feature-delete']);
});
