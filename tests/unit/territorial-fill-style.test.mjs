import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialFillResolver } from '../../assets/js/modules/territorial-fill-style.js';
import { resolveLayerDisplayColor } from '../../assets/js/modules/layer-presentation.js';

const country = { id: 'A', properties: {} };
const subunit = { id: 'S', properties: { unitType: 'subunit', sovereignId: 'A', style: { color: '#cc5500' } } };
const region = { id: 'R', properties: { unitType: 'region', sovereignId: 'A', style: { color: '#0055cc' } } };

test('territorial color visibility independently falls back to the theme land color', () => {
  const state = {
    countriesData: { features: [country] },
    territorialUnits: [subunit, region],
    layerPresentation: { styles: {
      countries: { colorVisible: false },
      subunits: { colorVisible: true },
      regions: { colorVisible: false },
    } },
  };
  const resolve = createTerritorialFillResolver({ state, countryColor: () => '#aa0000', defaultColor: '#f1f2f3' });
  assert.equal(resolve(subunit).color, '#cc5500');
  assert.equal(resolve(region).color, '#f1f2f3');
});

test('country palette and territorial fills use the same color visibility rule', () => {
  const presentation = { styles: { countries: { colorVisible: false }, subunits: { colorVisible: true } } };
  assert.equal(resolveLayerDisplayColor(presentation, 'countries', {
    explicitColor: '#aa0000', fallbackColor: '#f1f2f3',
  }), '#f1f2f3');
  assert.equal(resolveLayerDisplayColor(presentation, 'subunits', {
    objectKey: 'territorial:subunit:S', explicitColor: '#cc5500', fallbackColor: '#f1f2f3',
  }), '#cc5500');
});
