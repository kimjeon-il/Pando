import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

test('country focus uses its own label anchor while scope extent remains zoom-only', () => {
  const source = functionSource('focusObjectRef', 'layerGroupForObjectRef');
  assert.match(source, /countryLabelAnchors\.get\(String\(ref\.id\)\)/);
  assert.match(source, /validLabelAnchor\(runtimeAnchor\)/);
  assert.match(source, /if \(countryScope\?\.members\.length\) feature = countryScope\.extent;/);
  assert.doesNotMatch(source, /editor_label_anchor/);
  assert.match(source, /fitMapToFeature\(feature, \{ maxZoom: isMobile\(\) \? 12 : 10, preferredAnchor \}\)/);
  assert.doesNotMatch(source, /sovereignId|parentId|territorialChildren|territorialRelations/);
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
