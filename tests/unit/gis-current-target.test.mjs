import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

test('unknown external layers require a type; current generic sources are explicitly selectable', () => {
  const window = { PandoLabGisAdapters: {} };
  const document = { currentScript: { src: 'http://localhost/assets/js/gis-io.js' }, getElementById: () => ({ value: '' }) };
  const source = fs.readFileSync(new URL('../../assets/js/gis-io.js', import.meta.url), 'utf8')
    .replace('window.PandoLabGIS = Object.freeze({', 'window.testApi = { suggestedTarget, importMappingFromUi }; window.PandoLabGIS = Object.freeze({');
  vm.runInNewContext(source, { window, document, URL });
  const layer = { layerName: 'unknown', geometryType: 'Polygon' };
  assert.equal(window.testApi.suggestedTarget(layer), '');
  assert.equal(window.testApi.suggestedTarget({ layerName: 'countries', geometryType: 'Polygon' }), 'general');
  assert.equal(window.testApi.suggestedTarget({ layerName: 'territory-map', geometryType: 'Polygon' }), 'general');
  assert.equal(window.testApi.suggestedTarget(layer, { layers: [{ name: 'unknown', targetType: 'generic' }] }), 'generic');
  assert.throws(() => window.testApi.importMappingFromUi(), /가져올 종류를 선택/);
  document.getElementById = () => ({ value: 'generic' });
  assert.equal(window.testApi.importMappingFromUi().targetType, 'generic');
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const select = html.match(/<select id="gisTargetType">([\s\S]*?)<\/select>/)[1];
  assert.match(select, /value="generic"/);
  assert.doesNotMatch(select, /value="(?:country|subunit|region)"/);
  assert.match(select, /value="" disabled/);
});
