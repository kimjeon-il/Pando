import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialFillResolver } from '../../assets/js/modules/territorial-fill-style.js';
import { resolveLayerDisplayColor } from '../../assets/js/modules/layer-presentation.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';

const geometry = { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] };
const country = createTerritorialFeature({ id: 'A', unitType: 'country', geometry });
const subunit = createTerritorialFeature({ id: 'S', unitType: 'subunit', parentId: 'A', color: '#cc5500', geometry });
const region = createTerritorialFeature({ id: 'R', unitType: 'region', associatedCountryId: 'A', color: '#0055cc', geometry });

test('disabled territorial paint reveals the map substrate without changing stored colors', () => {
  const state = {
    territorialEntities: [country, subunit, region],
    layerPresentation: { styles: {
      countries: { colorVisible: false },
      subunits: { colorVisible: true },
      regions: { colorVisible: false },
    }, objectStyles: { 'territorial:country:A': { colorVisible: true } } },
  };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const resolve = createTerritorialFillResolver({ state, entityRepository, });
  assert.equal(resolve(country).fillAlpha, 0);
  assert.equal(resolve(subunit).color, '#cc5500');
  assert.equal(resolve(region).color, '');
  assert.equal(resolve(region).fillAlpha, 0);
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
  const state = { territorialEntities: [country] };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  for (const terrainAlpha of [1, 0.68, 0.22]) {
    entityStore.setField('A', 'color', '');
    let resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha });
    assert.equal(resolve(country).color, '');
    assert.equal(resolve(country).fillAlpha, 0);
    entityStore.setField('A', 'color', '#cccccc');
    resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha });
    assert.equal(resolve(country).color, '#cccccc');
    assert.equal(resolve(country).fillAlpha, terrainAlpha);
  }
});

test('children inherit only assigned colors and retain their opacity and blend', () => {
  const parent = { ...subunit, properties: { ...subunit.properties, style: {} } };
  const child = createTerritorialFeature({ id: 'C', unitType: 'subunit', parentId: 'S', geometry });
  const state = { territorialEntities: [country, parent, child],
    layerPresentation: { styles: { countries: { opacity: 0.5, blendMode: 'multiply' } },
      objectStyles: { 'territorial:country:A': { colorVisible: true } } } };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  let resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 });
  assert.equal(resolve(child).fillAlpha, 0);
  entityStore.setField('A', 'color', '#aa0000');
  resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 });
  assert.equal(resolve(child).color, '#aa0000');
  assert.equal(resolve(child).fillAlpha, 0.11);
  assert.equal(resolve(child).blendMode, 'multiply');
  state.layerPresentation.styles.countries.colorVisible = false;
  resolve = createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 });
  assert.equal(resolve(child).fillAlpha, 0);
});

test('pending no-terrain country patches use the map substrate without assigning a color', () => {
  const state = { territorialEntities: [country] };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const resolve = createTerritorialFillResolver({ state, entityRepository,
    mapSubstrate: { color: '#cccccc', fillAlpha: 1 } });
  assert.equal(resolve(country).color, '#cccccc');
  assert.equal(resolve(country).fillAlpha, 1);
  assert.deepEqual(country.properties.style, {});
});
