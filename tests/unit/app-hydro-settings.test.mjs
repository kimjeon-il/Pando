import test from 'node:test';
import assert from 'node:assert/strict';
import { createHydroSettings } from '../../assets/js/modules/app-hydro-settings.js';

function createFixture() {
  const settings = createHydroSettings();
  settings.connect({ physicalConfig: { PHYSICAL_DATASET: 'test-physical-dataset' } });
  return settings;
}

test('new and legacy terrain settings start in physical color mode', () => {
  const settings = createFixture();

  assert.deepEqual(settings.normalizePhysicalSettings(null), {
    terrainVisible: true,
    terrainStyle: 'physical',
    terrainStyleVersion: 1,
    hydroLayers: { rivers_hydro: true, lakes_natural_earth: true },
    userFeaturesVisible: true,
    hiddenHydroIds: {},
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
