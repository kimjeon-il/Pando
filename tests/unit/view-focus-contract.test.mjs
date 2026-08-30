import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
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
  assert.doesNotMatch(source, /fitBounds|focusCountry|panMapBy/);
  assert.match(source, /renderViewFrame\(\)/);
});

test('object focus uses the actual viewport center and safe insets only for zoom sizing', () => {
  const source = functionSource('focusCountry', 'focusCoordinate');
  assert.match(source, /const safe = currentObjectFitInsets\(\)/);
  assert.match(source, /const viewportCenter = \[width \/ 2, height \/ 2\]/);
  assert.match(source, /alignGeographicAnchor\(preferredAnchor, viewportCenter\)/);
  assert.match(source, /path\.bounds\(feature\)/);
  assert.match(source, /panMapBy\(offsetX, offsetY\)/);
  assert.doesNotMatch(source, /safeCenterX|safeCenterY|projectionCenterX|projectionCenterY/);
  assert.doesNotMatch(source, /largest|sovereign|parentId|children/i);
});

test('country focus prefers its own label anchor without expanding the focus geometry', () => {
  const source = functionSource('focusObjectRef', 'layerGroupForObjectRef');
  assert.match(source, /feature\.properties\?\.editor_label_anchor/);
  assert.match(source, /focusCountry\(feature, \{ maxZoom: isMobile\(\) \? 12 : 10, preferredAnchor \}\)/);
  assert.doesNotMatch(source, /sovereignId|parentId|territorialChildren|territorialRelations/);
});

test('desktop and mobile controls call the action whole-map view', () => {
  assert.equal((htmlSource.match(/전체 지도 보기/g) || []).length, 3);
  assert.doesNotMatch(htmlSource, /전체 지도 맞춤/);
});
