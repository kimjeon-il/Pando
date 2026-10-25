import { readFileSync } from 'node:fs';
import { createInitialDocument } from "../../shared/frontend/js/modules/initial-document.js";
import { coreFileProjection, productionGeoPackage } from '../helpers/production-geopackage.mjs';

/** Current C++ export receipt and the editor's real GeoPackage byte encoder. */
export async function createViewerProjectPackage(name = '파일 지도 A', fields = {}) {
  const corpus = JSON.parse(readFileSync(new URL('./timeline-exchange/complex.json', import.meta.url), 'utf8'));
  corpus.territorialEntities[0].properties.name = name;
  const seed = {
    ...createInitialDocument({ appVersion: '0.36.0', baseDataset: 'viewer-file-test' }),
    ...corpus,
    ...fields,
    projectSetup: { initialMonth: '1914-06', sourceMode: 'empty', timelineRange: null,
      initialMapBounds: { west: -5, east: 20, south: -5, north: 20 } },
  };
  const { project, spatialState } = await coreFileProjection(seed);
  const encoded = await productionGeoPackage('write', new ArrayBuffer(0), project, spatialState);
  return { project, bytes: Buffer.from(encoded.buffer) };
}
