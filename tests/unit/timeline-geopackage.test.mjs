import { productionGeoPackage as request, spatialLayerCount } from '../helpers/production-geopackage.mjs';
import { timelineStorageCases } from '../fixtures/timeline-storage-cases.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { prepareProjectForStorage } from '../../assets/js/modules/project-state.js';
import { projectForStorage, staticSerializerSnapshot } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';

const serialize = snapshot => createProjectSerializer({ appVersion: '0.34.0', baseDataset: 'base',
  distributionModes: ['territorial','geometry'], terrainDataset: 'terrain', hydroDataset: 'hydro', readSnapshot: () => snapshot }).buildProject();

for (const kind of ['complex','static','empty']) test(`production GeoPackage worker round-trips ${kind} v9 project`, async () => {
  const snapshot = kind === 'complex' ? projectForStorage() : staticSerializerSnapshot({ fullAutosave: true,
    territorialEntities: kind === 'empty' ? [] : [createTerritorialFeature({ id: 'A', entityKind: 'general', name: 'A',
      geometry: { type: 'Polygon', coordinates: [[[179,0],[-179,0],[-179,1],[179,0]]] }, metadata: { capital: '서울', source: 'original' } })] });
  const project = serialize(snapshot);
  const written = await request('write', new ArrayBuffer(0), project);
  const read = await request('read', written.buffer);
  assert.deepEqual(prepareProjectForStorage(read.metadata.projectState), prepareProjectForStorage(project));
  const count = spatialLayerCount(written.buffer);
  assert.equal(kind === 'complex' || kind === 'empty' ? count === 0 : count > 0, true);
});

for (const row of timelineStorageCases().filter(row => row.expected === 'OK')) test(`production file matrix: ${row.name}`, async () => {
  const project = serialize(projectForStorage(row));
  const written = await request('write', new ArrayBuffer(0), project);
  const read = await request('read', written.buffer);
  assert.deepEqual(prepareProjectForStorage(read.metadata.projectState), prepareProjectForStorage(project));
});


test('production GeoPackage rejects unsupported and malformed content with the original code', async () => {
  const project = serialize(projectForStorage());
  await assert.rejects(request('write', new ArrayBuffer(0), { ...project, sovereignty:{} }), { code:'PL-SCHEMA-FIELD' });
  const invalid = structuredClone(project); invalid.geometries.push(structuredClone(invalid.geometries[0]));
  await assert.rejects(request('write', new ArrayBuffer(0), invalid), { code:'DUPLICATE_ID' });
});
