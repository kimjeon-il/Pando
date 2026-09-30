import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectPresentation } from '../../assets/js/modules/app-object-presentation.js';
import { normalizeGenericFeatureSemantics } from '../../assets/js/modules/generic-feature-service.js';

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
  const countries = { countryLandRevision: 1 };
  const presentation = createObjectPresentation();
  presentation.connect({ countries });
  assert.strictEqual(presentation.genericFeatureDisplayFeature(feature), feature);
  countries.countryLandRevision += 1;
  assert.strictEqual(presentation.genericFeatureDisplayFeature(feature), feature);
  assert.deepEqual(feature, before);
});
