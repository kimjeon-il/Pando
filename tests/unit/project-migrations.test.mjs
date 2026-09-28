import assert from 'node:assert/strict';
import test from 'node:test';

import {
  migrateProjectToCurrent,
  migrateProjectV3ToV4,
  migrateProjectV5ToV6,
  migrationPath,
} from '../../assets/js/modules/project-migrations.js';
import { PROJECT_SCHEMA_VERSION } from '../../assets/js/modules/version-contract.js';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const polygon = () => ({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] });

function projectV3() {
  return {
    format: 'pandolab-project-state',
    schemaVersion: 3,
    version: '0.30.0',
    countriesData: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'DEU',
        properties: {
          editor_id: 'DEU', editor_name: '독일', editor_color: '#123456',
          editor_original_name: 'Germany', validFrom: '1949',
        },
        geometry: polygon(),
      }],
    },
    countryOverrides: {},
    genericFeatures: [{
      type: 'Feature', id: uuid(1), geometry: { type: 'Point', coordinates: [1, 2] },
      properties: { schemaVersion: 1, name: 'legacy', role: 'territory', ownerId: 'DEU', category: 'custom' },
    }],
    drawings: [{
      type: 'Feature', id: uuid(2), geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      properties: { name: 'old drawing', category: 'line' },
    }],
    layerVisibility: { userDrawings: true },
    itemVisibility: { drawings: { [uuid(2)]: false } },
    layerPresentation: { schemaVersion: 2, overlayOrder: ['countries', 'userDrawings'], styles: { userDrawings: { opacity: 0.5 } } },
    landObjectModel: { schemaVersion: 1, coastlineAuthority: 'countries', roles: ['generic'] },
    territorialModel: { schemaVersion: 1 },
    distributionModel: { schemaVersion: 2 },
    territorialUnits: [], territorialRelations: [], distributionLayers: [], distributionEntries: [],
    labels: [], hydroEdits: [],
  };
}

test('v3 -> v4 migration preserves legacy country and Generic data', () => {
  const input = projectV3();
  const before = structuredClone(input);
  const migrated = migrateProjectV3ToV4(input);

  assert.deepEqual(input, before);
  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.countriesData.features[0].properties, { name: '독일', validFrom: '1949' });
  assert.deepEqual(migrated.countryOverrides.DEU, { name: '독일', color: '#123456' });
  assert.equal(migrated.genericFeatures.length, 2);
  assert.equal(migrated.genericFeatures[0].properties.schemaVersion, 2);
  assert.equal(migrated.genericFeatures[0].properties.source.kind, 'legacy');
  assert.equal(migrated.genericFeatures[0].properties.source.details.legacyGenericSemantics.role, 'territory');
  assert.equal(migrated.genericFeatures[0].properties.source.details.legacyProperties.category, 'custom');
  assert.equal(migrated.genericFeatures[1].properties.source.details.legacyProperties.category, 'line');
  assert.equal('drawings' in migrated, false);
  assert.equal(migrated.layerVisibility.genericFeatures, true);
  assert.deepEqual(migrated.itemVisibility.genericFeatures, { [uuid(2)]: false });
  assert.deepEqual(migrated.layerPresentation.overlayOrder, ['countries', 'genericFeatures']);
  assert.deepEqual(migrated.layerPresentation.styles.genericFeatures, { opacity: 0.5 });
  assert.equal(migrated.landObjectModel.purpose, 'lossless-fallback');
  assert.equal(migrated.landObjectModel.directCreation, false);
});

test('migration chain is sequential and rejects unsupported schema ranges', () => {
  assert.deepEqual(migrationPath(3), [{ from: 3, to: 4 }, { from: 4, to: 5 }, { from: 5, to: 6 }]);
  assert.equal(migrateProjectToCurrent(projectV3()).schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.throws(() => migrateProjectToCurrent({ schemaVersion: 2 }), /지원 범위/);
  assert.throws(() => migrateProjectToCurrent({ schemaVersion: PROJECT_SCHEMA_VERSION + 1 }), /새롭습니다/);
});

test('v5 distributions become generic numeric layers while geography remains intact', () => {
  const legacy = {
    ...projectV3(), schemaVersion: 5,
    layerVisibility: { countries: false, languages: true, ethnicities: false, religions: true },
    itemVisibility: { languages: { [uuid(3)]: false } },
    layerPresentation: { schemaVersion: 3, overlayOrder: ['languages', 'countries'],
      styles: { languages: { opacity: 0.4 } } },
    distributionLayers: [{ id: uuid(3), schemaVersion: 2, type: 'language', name: '언어', color: '#123456' }],
    distributionEntries: [{ id: uuid(4), schemaVersion: 2, layerId: uuid(3), mode: 'geometry',
      geometry: polygon(), share: 37.5 }],
    distributionSettings: { renderMode: 'dominant', boundaryVisible: false },
  };
  const before = structuredClone(legacy);
  const migrated = migrateProjectV5ToV6(legacy);
  assert.deepEqual(legacy, before);
  assert.deepEqual(migrated.countriesData, legacy.countriesData);
  assert.equal(migrated.layerVisibility.countries, false);
  assert.equal(migrated.layerVisibility.distributions, true);
  assert.equal(migrated.itemVisibility.distributions[uuid(3)], false);
  assert.equal(migrated.distributionLayers[0].unit, '%');
  assert.deepEqual(migrated.distributionLayers[0].valueScale, { mode: 'manual', min: 0, max: 100 });
  assert.equal('type' in migrated.distributionLayers[0], false);
  assert.equal(migrated.distributionEntries[0].value, 37.5);
  assert.equal('share' in migrated.distributionEntries[0], false);
  assert.equal(migrated.distributionSettings.renderMode, 'overlap');
  assert.equal(migrated.distributionSettings.boundaryVisible, false);
});
