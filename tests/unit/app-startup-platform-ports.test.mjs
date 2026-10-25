import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalResources } from "../../shared/frontend/js/modules/physical-resources.js";
import { createTerritorialLabels } from "../../shared/frontend/js/modules/territorial-labels.js";

test('an asset-free platform suppresses physical resource requests', async () => {
  const resources = createPhysicalResources({ capabilities: {terrain:false,builtinHydro:false} });
  assert.equal(await resources.loadTerrainManifest(), false);
  assert.equal(await resources.loadHydroData(), false);
  await resources.loadPhysicalData();
});

test('an asset-free platform suppresses automatic place preparation', async () => {
  const labels = createTerritorialLabels({ capabilities: {builtinPlaces:false} });
  assert.equal(await labels.preparePlaces({ force: true }), false);
});
