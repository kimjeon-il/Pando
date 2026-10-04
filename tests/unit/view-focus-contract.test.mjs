import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import '../../assets/js/vendor/polygon-clipping.min.js';
import { initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import { createObjectCommands } from '../../assets/js/modules/app-object-commands.js';
import { createCountryIndex } from '../../assets/js/modules/app-country-index.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialScopeResolver } from '../../assets/js/modules/territorial-scope.js';

const appSource = readApplicationOwners('camera-navigation', 'object-commands');
const navigationBindingsSource = readApplicationOwners('navigation-bindings');
const htmlSource = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} source must exist`);
  return appSource.slice(start, end);
}

test('whole-map view resets only the active projection zoom', () => {
  const source = functionSource('resetView', 'bindHoldZoom');
  assert.match(source, /state\.view\.globeZoom = 1/);
  assert.match(source, /state\.view\.flatZoom = 1/);
  assert.doesNotMatch(source, /state\.view\.globeRotation\s*=/);
  assert.doesNotMatch(source, /state\.view\.flatCenter\s*=/);
  assert.doesNotMatch(source, /fitBounds|fitMapToFeature|panMapBy/);
  assert.match(source, /syncMapHostFromState\(\)/);
  assert.match(source, /renderingDomain\?\.endInteraction\?\.\('world-view-settle'\)/);
  assert.match(source, /projectDomain\.queueViewAutosave\(\)/);
  assert.doesNotMatch(source, /renderViewFrame\(\)/);
});

test('object focus uses the actual viewport center and safe insets only for zoom sizing', () => {
  const source = functionSource('fitMapToFeature', 'focusCoordinate');
  assert.match(source, /const safe = currentObjectFitInsets\(\)/);
  assert.match(source, /const viewportCenter = \[width \/ 2, height \/ 2\]/);
  assert.match(source, /alignGeographicAnchor\(anchor, viewportCenter\)/);
  assert.match(source, /path\.bounds\(feature\)/);
  assert.doesNotMatch(source, /panMapBy\(/);
  assert.doesNotMatch(source, /safeCenterX|safeCenterY|projectionCenterX|projectionCenterY/);
  assert.doesNotMatch(source, /largest|sovereign|parentId|children/i);
});

test('territorial focus uses the root label anchor and scope extent, while children and regions keep their own geometry', () => {
  const square = (x0, x1) => ({ type: 'Polygon', coordinates: [[[x0, 0], [x0, 2], [x1, 2], [x1, 0], [x0, 0]]] });
  const state = initializeTestTerritorialState({ territorialEntities: [
    createTerritorialFeature({ id: 'root', entityKind: 'general', geometry: square(0, 2) }),
    createTerritorialFeature({ id: 'child', entityKind: 'general', parentId: 'root', geometry: square(3, 5) }),
    createTerritorialFeature({ id: 'region', entityKind: 'regional', geometry: square(6, 8) }),
  ] });
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const entityRepository = createTerritorialEntityRepository({ entityStore });
  const territorialScope = createTerritorialScopeResolver({ entityRepository, getState: () => state,
    clipper: () => globalThis.polygonClipping });
  const anchor = [1, 1];
  const countryLabelAnchors = new Map([['root', anchor], ['child', [99, 99]], ['region', [88, 88]]]);
  const fits = [];
  let mobile = false;
  const owner = createObjectCommands();
  owner.connect({
    selectionServices: { normalizeObjectRef },
    territorialModel: { entityRepository },
    objectModelB: { territorialScope },
    labelPresentation: { countryLabelAnchors },
    countries: { validLabelAnchor: createCountryIndex().validLabelAnchor },
    surfaces: { isMobile: () => mobile },
    navigation: { fitMapToFeature: (feature, options) => fits.push({ feature, options }) },
  });
  const before = structuredClone(state.territorialEntities);
  const focus = id => owner.focusObjectRef({ domain: 'territorial', type: 'entity', id }, { announce: false });
  assert.equal(focus('root'), true);
  assert.strictEqual(fits[0].feature, territorialScope.scope('root').extent);
  assert.notDeepEqual(fits[0].feature.geometry, entityRepository.get('root').geometry);
  assert.deepEqual(fits[0].options, { maxZoom: 10, preferredAnchor: anchor });
  for (const id of ['child', 'region']) {
    assert.equal(focus(id), true);
    assert.strictEqual(fits.at(-1).feature, entityRepository.get(id));
    assert.deepEqual(fits.at(-1).options, { maxZoom: 10, preferredAnchor: null });
  }
  mobile = true;
  countryLabelAnchors.set('root', [NaN, 1]);
  assert.equal(focus('root'), true);
  assert.deepEqual(fits.at(-1).options, { maxZoom: 12, preferredAnchor: null });
  assert.equal(focus('missing'), false);
  assert.equal(fits.length, 4);
  assert.deepEqual(state.territorialEntities, before, 'focus must never change canonical geometry or hierarchy');
});

test('the shared whole-map control calls the camera action without restoring a removed mobile duplicate', () => {
  const button = htmlSource.match(/<button[^>]*id="resetViewBtn"[^>]*>/)?.[0] || '';
  assert.match(button, /aria-label="전체 지도 보기"/);
  assert.match(button, /data-tooltip="전체 지도 보기"/);
  assert.doesNotMatch(htmlSource, /id="mobileWorldBtn"/);
  assert.match(htmlSource, /id="mobileDisplayBtn"/);
  assert.equal((htmlSource.match(/aria-label="전체 지도 보기"/g) || []).length, 1);
  assert.doesNotMatch(htmlSource, /전체 지도 맞춤/);

  const start = navigationBindingsSource.indexOf("$('resetViewBtn')");
  const end = navigationBindingsSource.indexOf('const searchPanel', start);
  assert.ok(start >= 0 && end > start, 'reset view binding must exist');
  const binding = navigationBindingsSource.slice(start, end);
  assert.match(binding, /\bresetView\(\)/);
});
