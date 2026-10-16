// Refresh only this mutable current-contract fixture; frozen oracle inputs stay intact.
import { readFileSync, writeFileSync } from 'node:fs';
import { coreFileProjection, productionGeoPackage } from '../../tests/helpers/production-geopackage.mjs';

const source = new URL('../tests/fixtures/lineage-v10-content/content.json', import.meta.url);
const receipt = await coreFileProjection(JSON.parse(readFileSync(source, 'utf8')));
const packed = await productionGeoPackage('write', new ArrayBuffer(0), receipt.project, receipt.spatialState);
writeFileSync(new URL('../tests/fixtures/current-content.gpkg', import.meta.url), new Uint8Array(packed.buffer));
