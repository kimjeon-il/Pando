import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Blob } from 'node:buffer';
import { TextEncoder, TextDecoder } from 'node:util';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
test('export choices use unique current categories and UI has no merged duplicate labels', () => {
  const fieldset = html.match(/<fieldset class="gis-export-layers">[\s\S]*?<\/fieldset>/)[0];
  const values = [...fieldset.matchAll(/value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(values, ['countries', 'subunits', 'regions', 'genericFeatures', 'distributions', 'labels']);
  assert.equal((fieldset.match(/<span>하위단위<\/span>/g) || []).length, 1);
  assert.doesNotMatch(html, /하위단위(?:·| 또는 )하위단위/);
});

test('subunit-only GeoJSON export writes one layer and omits administrative fields', async () => {
  const context = vm.createContext({ URL, Blob, structuredClone, TextEncoder, TextDecoder,
    document: { currentScript: { src: 'https://example.test/assets/js/gis-io.js' } },
    location: { href: 'https://example.test/' } });
  context.window = context; context.self = context;
  for (const file of ['gis-adapters.js', 'vendor/fflate/fflate.min.js', 'gis-io.js']) {
    vm.runInContext(read(`assets/js/${file}`), context);
  }
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
  const project = { territorialEntities: [{ type: 'Feature', id: 's', geometry,
    properties: { schemaVersion: 3, unitType: 'subunit', name: '자치령', parentId: 'C', associatedCountryId: '', coverageMode: 'explicit' } }] };
  const result = await context.PandoLabGIS.exportGeoJsonBundle(project, ['subunits']);
  assert.equal(result.manifest.layers.length, 1);
  assert.equal(result.manifest.layers[0].category, 'subunits');
  assert.equal(result.manifest.layers[0].targetType, 'subunit');
  const files = context.fflate.unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const feature = JSON.parse(new TextDecoder().decode(files['subunits.geojson'])).features[0];
  assert.equal('admin_level' in feature.properties, false);
  assert.equal('is_remainder' in feature.properties, false);
  assert.equal(feature.properties.parent_id, 'C');
  assert.deepEqual(feature.geometry, geometry);
  await assert.rejects(context.PandoLabGIS.exportGeoJsonBundle(project, ['countries']), /내보낼 데이터가 없습니다/);
});
