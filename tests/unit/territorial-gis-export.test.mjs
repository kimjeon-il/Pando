import {repositoryFrontendUrl} from '../helpers/frontend-source.mjs';
import { createProjectSerializer } from "../../apps/editor/frontend/js/modules/project-serializer.js";
import { staticSerializerSnapshot } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import {coreFileProjection} from '../helpers/production-geopackage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Blob, File } from 'node:buffer';
import { TextEncoder, TextDecoder } from 'node:util';
import { renderProductHtml } from '../../scripts/lib/product-html.mjs';

const read = path => readFileSync(path.startsWith('assets/js/') ? repositoryFrontendUrl(path) : new URL(`../../${path}`, import.meta.url), 'utf8');
const html = renderProductHtml(read).web;
test('the Viewer review interface cannot export or mutate GIS source layers',()=>{
  for(const id of ['reviewPanel','reviewEvidenceInput','reviewExportRequest','reviewSourceLinks'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(html,/(?:gis-export-layers|id="gisExportFormat"|id="dataExportBtn")/);
});


test('child-only GeoJSON export writes one layer and omits administrative fields', async () => {
  const context = vm.createContext({ URL, Blob, structuredClone, TextEncoder, TextDecoder,
    document: { currentScript: { src: 'https://example.test/assets/js/gis-io.js' } },
    location: { href: 'https://example.test/' } });
  context.window = context; context.self = context;
  for (const file of ['gis-adapters.js', 'vendor/fflate/fflate.min.js', 'gis-io.js']) {
    vm.runInContext(read(`assets/js/${file}`), context, {
      filename: repositoryFrontendUrl(`assets/js/${file}`).href,
      importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    });
  }
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
  const project = createProjectSerializer({ appVersion: '0.34.0', baseDataset: 'base', distributionModes: ['territorial','geometry'],
    readSnapshot: () => staticSerializerSnapshot({ fullAutosave: true, territorialEntities: [
      createTerritorialFeature({ id: 'C', entityKind: 'general', geometry }),
      createTerritorialFeature({ id: 's', entityKind: 'general', parentId: 'C', name: '자치령', geometry }),
    ] }) }).buildProject();
  const receipt=await coreFileProjection(project);
  const result = await context.PandoLabGIS.exportGeoJsonBundle(receipt.project,['subunits'],()=>{},{spatialState:receipt.spatialState});
  assert.equal(result.manifest.layers.length, 1);
  assert.equal(result.manifest.layers[0].category, 'entities');
  assert.equal(result.manifest.layers[0].targetType, 'general');
  const files = context.fflate.unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const feature = JSON.parse(new TextDecoder().decode(files['entities.geojson'])).features[0];
  assert.equal('admin_level' in feature.properties, false);
  assert.equal('is_remainder' in feature.properties, false);
  assert.equal(feature.properties.parent_id, 'C');
  assert.deepEqual(feature.geometry, geometry);
  await assert.rejects(context.PandoLabGIS.exportGeoJsonBundle(receipt.project,['regions'],()=>{},{spatialState:receipt.spatialState}), /내보낼 데이터가 없습니다/);
});

test('project GeoPackage routes the complete snapshot directly to the production Worker', async () => {
  const context = vm.createContext({ URL, Blob, File, structuredClone,
    document: { currentScript: { src: 'https://example.test/assets/js/gis-io.js' } },
    location: { href: 'https://example.test/' } });
  context.window = context; context.self = context;
  vm.runInContext(read('apps/editor/frontend/js/gis-adapters.js'), context);
  vm.runInContext(read('apps/editor/frontend/js/gis-io.js').replace('window.PandoLabGIS = Object.freeze({',
    'window.setExportDependencies = (gdal, worker) => { getGdal = async () => gdal; callGpkgWorker = worker; }; window.PandoLabGIS = Object.freeze({'), context);
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
  const territorialEntities = [['r', 'general', ''], ['c', 'general', 'r'], ['z', 'regional', '']]
    .map(([id, entityKind, parentId]) => ({ type: 'Feature', id, geometry,
      properties: { schemaVersion: 4, entityKind, parentId, name: id } }));
  let seed; let argumentsUsed; let payload;
  context.setExportDependencies({
    async open(file) { seed = JSON.parse(await file.text()); return { datasets: [{}] }; },
    async ogr2ogr(_dataset, args) { argumentsUsed = [...args]; return 'export'; },
    async getFileBytes() { return new Uint8Array([1]); },
    async close() {},
  }, async (_action, buffer, extra) => { payload = extra; return { buffer }; });
  const spatialState={territorialEntities};
  await context.PandoLabGIS.exportGeoPackage({territorialEntities},()=>{},{spatialState});
  assert.equal(argumentsUsed, undefined);
  assert.equal(seed, undefined);
  assert.equal(payload.exportMode, 'project');
  assert.equal(payload.spatialState,spatialState);
  assert.deepEqual(payload.projectState.territorialEntities, territorialEntities);
});
