import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as projectState from '../../assets/js/modules/project-state.js';
import * as serializerModule from '../../assets/js/modules/project-serializer.js';
import { projectForStorage, staticSerializerSnapshot } from '../helpers/timeline-project.mjs';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createPersistenceService } from '../../assets/js/modules/persistence-service.js';
import { projectPreviewGeometryRows } from '../../assets/js/modules/project-preview-policy.js';
import { normalizeSourceProvenance } from '../../assets/js/modules/source-provenance.js';

const shape = { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] };
const baseFeature = () => createTerritorialFeature({ id: 'A', entityKind: 'general', name: 'A', geometry: shape });
const serializer = snapshot => serializerModule.createProjectSerializer({ appVersion: '0.34.0', baseDataset: 'base',
  distributionModes: ['territorial', 'geometry'], readSnapshot: () => snapshot });

test('preview geometry comes from canonical bindings at the initial resolved month', () => {
  const snapshot = staticSerializerSnapshot({ territorialEntities: [baseFeature()], fullAutosave: true });
  const project = serializer(snapshot).buildProject();
  assert.deepEqual(projectPreviewGeometryRows(project).countries, [['A', shape]]);
  assert.deepEqual(projectPreviewGeometryRows(serializer(projectForStorage()).buildProject()).countries.map(row => row[0]), ['A']);
});

test('storage candidates preserve complex timelines and reject dangling project references', () => {
  const project = serializer(projectForStorage()).buildProject();
  const candidate = projectState.prepareProjectForStorage(project);
  assert.deepEqual(candidate, project);
  assert.notEqual(candidate, project);
  assert.deepEqual(projectState.prepareProjectForActivation(project).timelineRecords, project.timelineRecords);
  project.labels = [{ id: '00000000-0000-4000-8000-000000000001', coordinates: [0,0], countryId: 'missing' }];
  assert.throws(() => projectState.prepareProjectForStorage(project), { code: 'PL-INV-001' });
});

test('production serializer refuses unsupported fields and dangling references before file creation', () => {
  const source = projectForStorage();
  source.projectFields.labels = [{ id: '00000000-0000-4000-8000-000000000001', countryId: 'missing' }];
  assert.throws(() => serializer(source).buildProject(), { code: 'PL-INV-001' });
  source.projectFields.labels = [];
  source.projectFields.sovereignty = {};
  assert.throws(() => serializer(source).buildProject(), { code: 'PL-SCHEMA-FIELD' });
});

test('storage rejects malformed identity types instead of coercing or dropping values', () => {
  const project = serializer(projectForStorage()).buildProject();
  for (const [key, value] of [['name', 7], ['notes', {}], ['locked', 'true'], ['metadata', null], ['style', []], ['sourceFolderId', 5]]) {
    const bad = structuredClone(project);
    bad.territorialEntities[0].properties[key] = value;
    assert.throws(() => projectState.prepareProjectForStorage(bad), { code: 'PL-SCHEMA-FIELD' }, key);
  }
  assert.throws(() => projectState.prepareProjectForStorage({ ...project, baseDatasetFingerprint: '1'.repeat(64) }), { code: 'PL-SCHEMA-FIELD' });
});

test('malformed other object geometry is rejected on detached storage and activation candidates', () => {
  const project = serializer(staticSerializerSnapshot({ territorialEntities: [baseFeature()] })).buildProject();
  for (const field of ['genericFeatures','hydroEdits']) {
    const bad = structuredClone(project);
    bad[field] = [{ type: 'Feature', id: '00000000-0000-4000-8000-000000000001', geometry: null,
      properties: field === 'genericFeatures' ? { schemaVersion:2, name:'X',notes:'',color:'#123456',locked:false,
        source: normalizeSourceProvenance({kind:'unsupported'}) } : { pandolab_schema_version:1,category:'river' } }];
    assert.throws(() => projectState.prepareProjectForStorage(bad));
    assert.throws(() => projectState.prepareProjectForActivation(bad));
  }
});

test('baseline SHA-256 covers metadata and geometry, independent of object key order', async () => {
  const feature = baseFeature();
  const digest = await serializerModule.fingerprintProjectBaseline([feature]);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, await serializerModule.fingerprintProjectBaseline([{ ...feature, properties:
    Object.fromEntries(Object.entries(feature.properties).reverse()) }]));
  assert.notEqual(digest, await serializerModule.fingerprintProjectBaseline([{ ...feature,
    properties: { ...feature.properties, metadata: { capital: 'new' } } }]));
  assert.notEqual(digest, await serializerModule.fingerprintProjectBaseline([{ ...feature,
    geometry: { ...shape, coordinates: [[[0,0],[2,0],[1,1],[0,0]]] } }]));
  assert.equal(createHash('sha256').update('test').digest('hex').length, digest.length);
});

test('delta validates actual baseline fingerprint before reconstructing omitted identities', async () => {
  const features = [baseFeature()];
  const snapshot = staticSerializerSnapshot({ territorialEntities: features, entityDelta: { changed: [], removedIds: [] } });
  snapshot.baseDatasetFingerprint = await serializerModule.fingerprintProjectBaseline(features);
  const delta = serializer(snapshot).buildAutosave();
  assert.equal(delta.baseDatasetFingerprint, snapshot.baseDatasetFingerprint);
  const options = { baseEntities: snapshot.territorialEntities, baseDataset: 'base', baseDatasetFingerprint: snapshot.baseDatasetFingerprint };
  const recovered = projectState.prepareProjectForActivation(delta, options);
  assert.deepEqual(recovered.territorialEntities, snapshot.territorialEntities);
  assert.deepEqual(recovered.geometries, delta.geometries);
  assert.throws(() => projectState.prepareProjectForActivation(delta, { ...options, baseDatasetFingerprint: '0'.repeat(64) }), { code: 'PL-SCHEMA-BASE' });
  assert.throws(() => serializer({ ...snapshot, baseDatasetFingerprint: undefined }).buildAutosave(), { code: 'PL-SCHEMA-BASE' });
});

test('autosave waits for asynchronous candidate rejection before promoting a stored save', async () => {
  let writes = 0;
  const service = createPersistenceService({ storage: {
    readView: async () => null, readProject: async () => ({ savedAt: '2026-10-04T00:00:00Z' }),
    readFallback: () => null, writeProject: async () => { writes++; },
  }, scheduler: { cancel() {}, scheduleIdle() {} }, onWarning() {},
  validateProject: async () => { throw Object.assign(new Error('baseline mismatch'), { code: 'PL-SCHEMA-BASE' }); } });
  const result = await service.restore();
  assert.equal(result.project, null);
  assert.equal(result.error.code, 'PL-SCHEMA-BASE');
  assert.equal(writes, 0);
});


test('delta autosave rejects unsupported project fields before persisting them', () => {
  const source = staticSerializerSnapshot({ territorialEntities:[baseFeature()], entityDelta:{changed:[],removedIds:[]} });
  source.projectFields.sovereignty = {};
  assert.throws(()=>serializer(source).buildAutosave(), {code:'PL-SCHEMA-FIELD'});
});
