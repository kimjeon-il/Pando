import assert from 'node:assert/strict';
import test from 'node:test';
import { createGpuScene } from "../../shared/frontend/js/modules/gpu-scene.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";
import { normalizeGenericFeatureSemantics } from "../../shared/frontend/js/modules/generic-feature-normalization.js";

test('generic display preserves canonical geometry independently of country revisions and source attributes', () => {
  const feature = normalizeGenericFeatureSemantics({
    type: 'Feature', id: 'independent-area',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 5], [5, 5], [5, 0], [0, 0]]] },
    properties: { schemaVersion: 2, name: 'Area', source: {
      kind: 'gis', sourceFormat: 'geojson', sourceId: 'original',
      details: { legacyGenericSemantics: { ownerId: 'country-a', landBinding: 'hard' } },
    } },
  });
  const before = structuredClone(feature);
  const state = { genericFeatures: [feature] };
  const scene = createGpuScene();
  scene.connect({ projectState: { state }, selectionServices: { normalizeObjectRef } });
  const ref = { domain: 'generic', type: 'feature', id: feature.id };
  assert.strictEqual(scene.mapFeatureForObjectRef(ref), feature);
  assert.equal(scene.mapFeatureForObjectRef({ ...ref, id: 'missing' }), null);
  assert.deepEqual(feature, before);
});
