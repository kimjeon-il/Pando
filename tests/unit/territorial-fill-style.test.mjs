import { initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialFillResolver } from '../../assets/js/modules/territorial-fill-style.js';
import { resolveLayerDisplayColor } from '../../assets/js/modules/layer-presentation.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';

const geometry = { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] };
const country = createTerritorialFeature({ id: 'A', entityKind: 'general', geometry });
const subunit = createTerritorialFeature({ id: 'S', entityKind: 'general', parentId: 'A', color: '#cc5500', geometry });
const region = createTerritorialFeature({ id: 'R', entityKind: 'regional', color: '#0055cc', geometry });

test('disabled territorial paint reveals the map substrate without changing stored colors', () => {
  const state = {
    territorialEntities: [country, subunit, region],
    layerPresentation: { styles: {
      countries: { colorVisible: false },
      subunits: { colorVisible: true },
      regions: { colorVisible: false },
    }, objectStyles: {} },
  };
  initializeTestTerritorialState(state);
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
    objectKey: 'territorial:entity:S', explicitColor: '#cc5500', fallbackColor: '#f1f2f3',
  }), '#cc5500');
});

test('map modes own unpainted land; explicit gray is still object paint', () => {
  const state = { territorialEntities: [country] };
  initializeTestTerritorialState(state);
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
  const child = createTerritorialFeature({ id: 'C', entityKind: 'general', parentId: 'S', geometry });
  const state = { territorialEntities: [country, parent, child],
    layerPresentation: { styles: { countries: { opacity: 0.5, blendMode: 'multiply' } },
      objectStyles: { 'territorial:entity:A': { colorVisible: true } } } };
  initializeTestTerritorialState(state);
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
  initializeTestTerritorialState(state);
const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const resolve = createTerritorialFillResolver({ state, entityRepository,
    mapSubstrate: { color: '#cccccc', fillAlpha: 1 } });
  assert.equal(resolve(country).color, '#cccccc');
  assert.equal(resolve(country).fillAlpha, 1);
  assert.deepEqual(country.properties.style, {});
});


test('an independent region never inherits general opacity, blend or land ownership', () => {
  const state = { territorialEntities: [country, region], layerPresentation: { styles: {
    countries: { opacity: 0.25, blendMode: 'multiply' }, regions: { opacity: 0.8, blendMode: 'normal' },
  } } };
  initializeTestTerritorialState(state);
  const entityRepository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ getState: () => state }) });
  const material = createTerritorialFillResolver({ state, entityRepository })(region);
  assert.equal(material.opacity, 0.8);
  assert.equal(material.blendMode, 'normal');
  assert.equal(material.ownerId, '');
  assert.equal(material.depth, 0);
});

test('a direct child inherits the actual parent material, including per-object opacity and blend', () => {
  const state = { territorialEntities: [country, subunit], layerPresentation: { objectStyles: {
    'territorial:entity:A': { opacity: 0.4, blendMode: 'multiply' },
  } } };
  initializeTestTerritorialState(state);
  const entityRepository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ getState: () => state }) });
  const material = createTerritorialFillResolver({ state, entityRepository })(subunit);
  assert.equal(material.opacity, 0.4);
  assert.equal(material.blendMode, 'multiply');
  assert.equal(material.depth, 1);
  assert.equal(material.ownerId, 'A');
});

test('intrinsic country paint is inherited, explicit edits override it, and clearing restores it', () => {
  const korea = createTerritorialFeature({ id: 'KOR', entityKind: 'general', geometry });
  const child = createTerritorialFeature({ id: 'KOR-child', entityKind: 'general', parentId: 'KOR', geometry });
  const state = { territorialEntities: [korea, child] };
  initializeTestTerritorialState(state);
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const material = feature => createTerritorialFillResolver({ state, entityRepository, terrainAlpha: 0.22 })(feature);
  assert.equal(material(korea).color, '#003478');
  assert.equal(material(child).color, '#003478');
  assert.equal(material(korea).fillAlpha, 0.22);
  assert.deepEqual(korea.properties.style, {});
  entityStore.setField('KOR', 'color', '#ef4444');
  assert.equal(material(child).color, '#ef4444');
  entityStore.setField('KOR', 'color', '');
  assert.equal(material(child).color, '#003478');
  state.layerPresentation = { styles: { countries: { colorVisible: false } } };
  assert.equal(material(korea).fillAlpha, 0);
  assert.equal(material(child).fillAlpha, 0);
});

test('unassigned territories and new countries remain unpainted, while historical identities keep their own defaults', () => {
  const rows = [
    ['ATA', ''], ['BRT', ''], ['KAS', ''], ['SPI', ''], ['new-country', ''],
    ['RUS', '#3a9915'], ['state:soviet-union', '#a3101f'],
    ['CZE', '#6e63a2'], ['state:czechoslovakia', '#46d8cb'],
    ['state:east-prussia', '#003153'],
    ['state:deutsche-demokratische-republik', '#8b1a1a'],
    ['CNM', '#009edb'], ['COK', '#496a9c'], ['NIU', '#e2c65a'],
  ];
  const entities = rows.map(([id]) => createTerritorialFeature({ id, entityKind: 'general', geometry }));
  const state = { territorialEntities: entities };
  initializeTestTerritorialState(state);
  const entityRepository = createTerritorialEntityRepository({ entityStore: createTerritorialEntityStore({ getState: () => state }) });
  const resolve = createTerritorialFillResolver({ state, entityRepository });
  rows.forEach(([, color], index) => {
    assert.equal(resolve(entities[index]).color, color);
    assert.equal(resolve(entities[index]).fillAlpha, color ? 1 : 0);
    assert.deepEqual(entities[index].properties.style, {});
  });
});
