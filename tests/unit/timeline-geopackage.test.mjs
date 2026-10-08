import { productionGeoPackage as request, spatialLayerCount } from '../helpers/production-geopackage.mjs';
import { timelineStorageCases } from '../fixtures/timeline-storage-cases.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { prepareProjectForStorage } from '../../assets/js/modules/project-state.js';
import { projectForStorage, staticSerializerSnapshot } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { readFile } from 'node:fs/promises';
import { prepareProjectForActivation } from '../../assets/js/modules/project-state.js';

const serialize = snapshot => createProjectSerializer({ appVersion: '0.34.0', baseDataset: 'base',
  distributionModes: ['territorial','geometry'], terrainDataset: 'terrain', hydroDataset: 'hydro', readSnapshot: () => snapshot }).buildProject();

for (const kind of ['complex','static','empty']) test(`production GeoPackage worker round-trips ${kind} v10 project`, async () => {
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

const exchangeFile = name => new URL(`../fixtures/timeline-exchange/${name}`, import.meta.url);
const exchangeJson = async name => JSON.parse(await readFile(exchangeFile(name), 'utf8'));
const exchangeContent = project => ({ territorialEntities: project.territorialEntities,
  timelineRecords: project.timelineRecords, geometries: project.geometries });

for (const kind of ['static', 'complex', 'calendar-boundaries']) test(`fixed ${kind} JSON and real GeoPackage match the independent exchange oracle`, async () => {
  const expected = await exchangeJson(`${kind}.expected.json`);
  const project = await exchangeJson(`${kind}.json`);
  assert.deepEqual(exchangeContent(prepareProjectForStorage(project)), expected);
  const bytes = await readFile(exchangeFile(`${kind}.gpkg`));
  const read = await request('read', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.deepEqual(exchangeContent(prepareProjectForStorage(read.metadata.projectState)), expected);
  const written = await request('write', new ArrayBuffer(0), project);
  const reread = await request('read', written.buffer);
  assert.deepEqual(exchangeContent(prepareProjectForStorage(reread.metadata.projectState)), expected);
  if (kind !== 'static') assert.equal(spatialLayerCount(written.buffer), 0);
  assert.deepEqual(exchangeContent(prepareProjectForActivation(project)), expected);
});

for (const [name, mutate, code] of [
  ['year zero', p => { p.timelineRecords.lifetimes[0].validFrom = '0000-02'; }, 'TIMELINE_INTERVAL'],
  ['1900 is not leap', p => { p.timelineRecords.geometryBindings.find(r => r.id === 'B:new').validFrom = '1900-02-29'; }, 'TIMELINE_INTERVAL'],
  ['shared inclusive boundary', p => { p.timelineRecords.geometryBindings.find(r => r.id === 'A:new').validFrom = '+12000-02-28'; }, 'TIMELINE_OVERLAP'],
  ['missing leap day', p => { p.timelineRecords.geometryBindings.find(r => r.id === 'A:new').validFrom = '+12000-03'; }, 'TIMELINE_GAP'],
]) test(`production calendar exchange rejects ${name} without changing its input`, async () => {
  const project = await exchangeJson('calendar-boundaries.json'); mutate(project);
  const before = structuredClone(project);
  assert.throws(() => prepareProjectForStorage(project), { code });
  await assert.rejects(request('write', new ArrayBuffer(0), project), { code });
  assert.deepEqual(project, before);
});
