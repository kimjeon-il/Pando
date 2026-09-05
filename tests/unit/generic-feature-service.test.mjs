import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERIC_FEATURE_SCHEMA_VERSION,
  createGenericFeatureService,
  genericFeatureGeometryKind,
  genericFeatureLandBinding,
  genericFeatureRole,
  normalizeGenericFeatureCollection,
  normalizeGenericFeatureSemantics,
} from '../../assets/js/modules/generic-feature-service.js';

const genericFeature = (id, geometry = { type: 'Point', coordinates: [1, 2] }, properties = {}) => ({
  type: 'Feature', id, geometry, properties: { name: id, color: '#123456', ...properties },
});

test('legacy Generic Feature normalizes to fallback v2 without losing old semantics or source fields', () => {
  const legacy = genericFeature('one', undefined, {
    schemaVersion: 1,
    role: 'territory',
    ownerId: 'country-a',
    landBinding: 'hard',
    category: 'custom',
    source: { format: 'geojson', provider: 'legacy-provider' },
  });
  const [normalized] = normalizeGenericFeatureCollection([legacy]);
  assert.equal(normalized.properties.schemaVersion, GENERIC_FEATURE_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(normalized.properties).sort(), ['color', 'locked', 'name', 'notes', 'schemaVersion', 'source'].sort());
  assert.equal(normalized.properties.source.kind, 'legacy');
  assert.equal(normalized.properties.source.sourceFormat, 'geojson');
  assert.equal(normalized.properties.source.details.unmappedSourceFields.provider, 'legacy-provider');
  assert.equal(normalized.properties.source.details.legacyProperties.category, 'custom');
  assert.equal(normalized.properties.source.details.legacyGenericSemantics.ownerId, 'country-a');
  assert.equal(genericFeatureRole(normalized), 'territory');
  assert.equal(genericFeatureLandBinding(normalized), 'hard');
  assert.equal(genericFeatureGeometryKind(normalized), 'point');
  assert.equal(legacy.properties.schemaVersion, 1, 'normalization must not mutate legacy input');
});

test('direct compatibility normalization remains in-place for legacy app callers', () => {
  const feature = genericFeature('compat', undefined, { schemaVersion: 1, role: 'generic' });
  assert.equal(normalizeGenericFeatureSemantics(feature), feature);
  assert.equal(feature.properties.schemaVersion, 2);
  assert.equal('role' in feature.properties, false);
});

test('new v2 Generic Feature uses canonical fallback provenance and rejects duplicate IDs', () => {
  const [normalized] = normalizeGenericFeatureCollection([genericFeature('one', undefined, {
    schemaVersion: 2,
    source: { schemaVersion: 1, kind: 'gis', dataset: 'roads', sourceId: 'r-1', sourceFormat: 'geojson', sourceType: 'road' },
  })]);
  assert.equal(normalized.properties.source.kind, 'gis');
  assert.equal(genericFeatureRole(normalized), 'generic');
  assert.throws(() => normalizeGenericFeatureCollection([genericFeature('one'), genericFeature('one')]), /중복/);
});

test('genericFeature service keeps canonical fields while compatibility metadata lives in provenance', () => {
  let genericFeatures = [];
  const transactions = [];
  const commandPipeline = {
    runMutation(meta, mutate, options) {
      transactions.push({ ...meta, renderDirty: options.renderDirty });
      const value = mutate();
      return { ok: true, value };
    },
  };
  const service = createGenericFeatureService({
    documentStore: {
      readFeatures: () => genericFeatures,
      replaceFeatures: value => { genericFeatures = value; },
    },
    commandPipeline,
    writeColor(feature, value) { feature.properties.color = value; },
  });
  service.add(genericFeature('one', undefined, { schemaVersion: 1, role: 'generic' }));
  service.updateMetadata('one', 'color', '#abcdef');
  service.updateMetadata('one', 'role', 'administrative');
  assert.equal(service.get('one').properties.color, '#abcdef');
  assert.equal('role' in service.get('one').properties, false);
  assert.equal(genericFeatureRole(service.get('one')), 'administrative');
  let removed = '';
  service.remove('one', { beforeRemove: feature => { removed = feature.id; } });
  assert.equal(removed, 'one');
  assert.equal(service.list().length, 0);
  assert.deepEqual(transactions.map(meta => meta.type), ['generic-feature-create', 'generic-feature-metadata', 'generic-feature-metadata', 'generic-feature-delete']);
});
