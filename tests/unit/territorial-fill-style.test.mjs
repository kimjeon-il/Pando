import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialFillResolver } from '../../assets/js/modules/territorial-fill-style.js';
import { resolveLayerDisplayColor } from '../../assets/js/modules/layer-presentation.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';

const country = { id: 'A', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] } };
const subunit = { id: 'S', properties: { unitType: 'subunit', parentId: 'A', sovereignId: 'A', style: { color: '#cc5500' } } };
const region = { id: 'R', properties: { unitType: 'region', sovereignId: 'A', style: { color: '#0055cc' } } };

function repository(state) {
  return createTerritorialEntityRepository({ getCountries: () => state.countriesData,
    getUnits: () => state.territorialUnits || [], getCountryOverride: id => state.countryOverrides?.[id] || {} });
}

test('disabled territorial paint reveals the map substrate without changing stored colors', () => {
  const state = {
    countriesData: { features: [country] },
    countryOverrides: { A: { color: '#aa0000' } },
    territorialUnits: [subunit, region],
    layerPresentation: { styles: {
      countries: { colorVisible: false },
      subunits: { colorVisible: true },
      regions: { colorVisible: false },
    }, objectStyles: { 'territorial:country:A': { colorVisible: true } } },
  };
  const resolve = createTerritorialFillResolver({ state, entityRepository: repository(state) });
  assert.equal(resolve(country).fillAlpha, 0);
  assert.equal(resolve(subunit).color, '#cc5500');
  assert.equal(resolve(region).color, '');
  assert.equal(resolve(region).fillAlpha, 0);
  assert.equal(state.countryOverrides.A.color, '#aa0000');
  assert.equal(region.properties.style.color, '#0055cc');
});

test('country palette and territorial fills can resolve an absent color channel', () => {
  const presentation = { styles: { countries: { colorVisible: false }, subunits: { colorVisible: true } } };
  assert.equal(resolveLayerDisplayColor(presentation, 'countries', {
    explicitColor: '#aa0000', fallbackColor: '',
  }), '');
  assert.equal(resolveLayerDisplayColor(presentation, 'subunits', {
    objectKey: 'territorial:subunit:S', explicitColor: '#cc5500', fallbackColor: '#f1f2f3',
  }), '#cc5500');
});

test('map modes own unpainted land; explicit gray is still object paint', () => {
  const state = { countriesData: { features: [country] }, territorialUnits: [] };
  const entityRepository = repository(state);
  for (const terrainAlpha of [1, 0.68, 0.22]) {
    state.countryOverrides = {};
    let resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha });
    assert.equal(resolve(country).color, '');
    assert.equal(resolve(country).fillAlpha, 0);
    state.countryOverrides = { A: { color: '#cccccc' } };
    resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha });
    assert.equal(resolve(country).color, '#cccccc');
    assert.equal(resolve(country).fillAlpha, terrainAlpha);
  }
});

test('children inherit only assigned colors and retain their opacity and blend', () => {
  const parent = { ...subunit, properties: { ...subunit.properties, style: {} } };
  const child = { id: 'C', properties: { unitType: 'subunit', parentId: 'S', sovereignId: 'A', style: {} } };
  const state = { countriesData: { features: [country] }, territorialUnits: [parent, child],
    layerPresentation: { styles: { countries: { opacity: 0.5, blendMode: 'multiply' } },
      objectStyles: { 'territorial:country:A': { colorVisible: true } } } };
  const entityRepository = repository(state);
  let resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 });
  assert.equal(resolve(child).fillAlpha, 0);
  state.countryOverrides = { A: { color: '#aa0000' } };
  resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 });
  assert.equal(resolve(child).color, '#aa0000');
  assert.equal(resolve(child).fillAlpha, 0.11);
  assert.equal(resolve(child).blendMode, 'multiply');
  state.layerPresentation.styles.countries.colorVisible = false;
  resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 });
  assert.equal(resolve(child).fillAlpha, 0);
});

test('pending no-terrain country patches use the map substrate without assigning a color', () => {
  const state = { countriesData: { features: [country] }, territorialUnits: [] };
  const resolve = createTerritorialFillResolver({ state, entityRepository: repository(state),
    mapSubstrate: { color: '#cccccc', fillAlpha: 1 } });
  assert.equal(resolve(country).color, '#cccccc');
  assert.equal(resolve(country).fillAlpha, 1);
  assert.equal(country.properties.style, undefined);
});
