import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalResources } from '../../assets/js/modules/app-physical-resources.js';
import { createTerritorialLabels } from '../../assets/js/modules/app-territorial-labels.js';

test('an asset-free platform suppresses physical resource requests', async () => {
  const resources = createPhysicalResources({ enabled: false });
  assert.equal(await resources.loadTerrainManifest(), false);
  assert.equal(await resources.loadHydroData(), false);
  resources.loadPhysicalData();
});

test('an asset-free platform suppresses automatic place preparation', async () => {
  const labels = createTerritorialLabels({ builtinPlacesEnabled: false });
  assert.equal(await labels.preparePlaces({ force: true }), false);
});
