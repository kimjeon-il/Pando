import test from 'node:test';
import assert from 'node:assert/strict';
import { createHydroSettings } from "../../shared/frontend/js/modules/physical-settings.js";

function createFixture() {
  const settings = createHydroSettings();
  settings.connect({ physicalConfig: { PHYSICAL_DATASET: 'test-physical-dataset' } });
  return settings;
}

test('device terrain settings start in physical color mode', () => {
  const settings = createFixture();

  assert.deepEqual(settings.normalizePhysicalSettings(null), {
    terrainVisible: true,
    terrainStyle: 'physical',
    terrainStyleVersion: 1,
    hydroLayers: { rivers_hydro: true, lakes_natural_earth: true },
    userFeaturesVisible: true,
    dataset: 'test-physical-dataset',
  });
  assert.equal(settings.normalizePhysicalSettings({ terrainStyle: 'political' }).terrainStyle, 'physical');
});

test('current terrain settings preserve an explicit grayscale choice', () => {
  const settings = createFixture();

  assert.equal(settings.normalizePhysicalSettings({
    terrainStyle: 'political',
    terrainStyleVersion: 1,
  }).terrainStyle, 'political');
});

test('built-in hydro lookup uses tiled features by cache key and logical ID', () => {
  const feature = { id: 'fragment', properties: { pandolab_id: 'river-1' } };
  const settings = createHydroSettings();
  settings.connect({ projectState: { state: { hydroFeatureCache: new Map([['fragment', feature]]) } } });
  assert.deepEqual(settings.allBuiltInHydroFeatures(), [feature]);
  assert.equal(settings.builtInHydroFeatureById('fragment'), feature);
  assert.equal(settings.builtInHydroFeatureById('river-1'), feature);
  assert.equal(settings.builtInHydroFeatureById('missing'), null);
});
