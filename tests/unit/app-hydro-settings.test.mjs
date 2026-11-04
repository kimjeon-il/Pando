import test from 'node:test';
import assert from 'node:assert/strict';
import { createHydroSettings } from "../../shared/frontend/js/modules/physical-settings.js";

function createFixture() {
  const settings = createHydroSettings();
  settings.connect({ physicalConfig: { PHYSICAL_DATASET: 'test-physical-dataset' } });
  return settings;
}

test('retired editor normalization is absent from the viewer settings owner', () => {
  const settings = createFixture();
  for (const key of ['normalizePhysicalSettings', 'normalizeHydroEdit', 'normalizeHydroEditCollection']) {
    assert.equal(key in settings, false);
  }
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
