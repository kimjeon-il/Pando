import "../../helpers/spherical-core.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs';

import test from 'node:test';


import {normalizeTerritorialLibraryIndex} from "../../../tools/gis/territorial-library.js";
import {executeTerritorialTestCommand} from "../../helpers/timeline-project.mjs";
import {createGisCoreFixture} from "../../helpers/gis-core-fixture.mjs";
import vm from 'node:vm';
import {createTerritorialFeature} from "../../../src/document/territorial-units.js";

test('snapshot input cannot mutate the normalized reference list',()=>{
  const raw={schemaVersion:2,entities:[{schemaVersion:2,entityId:'state:fixture',entityKind:'general',
    lineageId:'fixture',names:{ko:'Fixture'},file:'state-fixture.json.gz',sha256:'a'.repeat(64),
    compressedBytes:1,decodedBytes:1,geometryVersionCount:1,bbox:[0,0,1,1],lifetime:{validFrom:null,validTo:null},
    validFrom:null,validTo:null,geometryVersions:[{versionId:'border',validFrom:null,validTo:null}]}],
    lineages:[{lineageId:'fixture',names:{ko:'Fixture'},entityRefs:['state:fixture'],relations:[]}],
    snapshots:[{schemaVersion:1,id:'snapshot',referenceDate:'2000-01-01',entityRefs:['state:fixture']}]};
  const index=normalizeTerritorialLibraryIndex(raw),before=[...index.snapshots[0].entityRefs];
  raw.snapshots[0].entityRefs.length=0;
  assert.deepEqual(index.snapshots[0].entityRefs,before);
  assert.throws(()=>index.snapshots[0].entityRefs.push('unrelated'),TypeError);
});

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL("../../../assets/js-vendor/polygon-clipping.min.js", import.meta.url), 'utf8'), context);
const clipper = context.polygonClipping;
const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 8], [8, 8], [8, 0], [0, 0]]] };

async function harness(overrides = {}) {
  return createGisCoreFixture([createTerritorialFeature({id:'A',entityKind:'general',geometry})],{runtime:{polygonClipping:clipper,...overrides}});
}

test('current GIS uses one entity import contract for general parents and independent regions', async () => {
  const h = await harness();
  assert.equal(typeof h.committer.commitTerritorialImport, 'function');
  await h.committer.commitTerritorialImport({ targetType: 'general', mapping: { parentId: 'A', idField: 'code', nameField: 'title' },
    collection: { features: [{ type: 'Feature', properties: { code: 'child', title: 'Child' }, geometry }] } }, 'objects.geojson');
  assert.equal(h.repository.get('child').properties.parentId, 'A');
  assert.equal(h.repository.get('child').properties.entityKind, 'general');
  await h.committer.commitTerritorialImport({ targetType: 'regional', collection: {
    features: [{ type: 'Feature', id: 'region', properties: { name: 'Cross-border region' }, geometry }],
  } }, 'regions.geojson');
  assert.equal(h.repository.get('region').properties.parentId, '');
  assert.equal(h.repository.get('region').properties.entityKind, 'regional');
  assert.deepEqual(h.repository.get('A').geometry, geometry);
  assert.deepEqual(h.calls, ['history', 'save', 'history', 'save']);
});

test('invalid imported parent aborts the entire current batch before history or storage changes', async () => {
  const h = await harness();
  const before = h.repository.list();
  await assert.rejects(() => h.committer.commitTerritorialImport({ targetType: 'general', collection: { features: [
    { type: 'Feature', id: 'ok', properties: { parent_id: 'A' }, geometry },
    { type: 'Feature', id: 'bad', properties: { parent_id: 'missing' }, geometry },
  ] } }, 'objects.geojson'), /parent|부모|상위/);
  assert.strictEqual(h.repository.list(), before);
  assert.deepEqual(h.calls, []);
});

test('a GIS FID of zero preserves its identity and imported child parent reference', async () => {
  const h = await harness();
  await h.committer.commitTerritorialImport({ targetType: 'general', mapping: { idField: '__fid__' }, collection: { features: [
    { type: 'Feature', id: 0, properties: { name: 'Zero' }, geometry },
    { type: 'Feature', id: 1, properties: { name: 'Child', parent_id: '0' }, geometry },
  ] } }, 'objects.geojson');
  assert.equal(h.repository.get('0').properties.name, 'Zero');
  assert.equal(h.repository.get('1').properties.parentId, '0');
});

test('new general roots reach the existing GPU and Worker geometry mutation boundary', async () => {
  const h = await harness();
  await h.committer.commitTerritorialImport({ targetType: 'general', collection: { features: [{ type: 'Feature', id: 'new-root', properties: {}, geometry }] } }, 'objects.geojson');
  assert.deepEqual(h.rootPatches, [['new-root']]);
  assert.equal(h.state.stateRevision, 1);
});
test('edits during a coast decision cancel the detached import before any publication', async () => {
  let release, entered;
  const wait = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const h = await harness({ buildSharedBoundaryTopology: () => ({}), analyzeAdminCountryCoast: () => ({ status: 'ready', conflicts: [{}] }),
    ensureGisRuntime: async () => {}, getCoastReconciliationController: async () => ({ open: async () => { entered(); return wait; } }),
    normalizeCoastDecision: value => value, territorialEntityName: feature => feature.id, countryName: feature => feature.id,
    createCancellationError: message => Object.assign(new Error(message), { cancelled: true }) });
  const before = h.repository.list();
  const pending = h.committer.commitTerritorialImport({ targetType: 'regional', mapping: { coastReferenceId: 'A' }, collection: {
    features: [{ type: 'Feature', id: 'R', properties: {}, geometry }] } }, 'regions.geojson');
  const stored = h.state.territorialEntities;
  await started;
  await executeTerritorialTestCommand(h.state,'territorial.metadata',{id:'A',field:'notes',valuePresent:true,value:'edited while prompt held'});
  const accepted=h.state.territorialEntities,calls=[...h.calls];release('independent');
  await assert.rejects(pending,error=>error.cancelled===true || error.code==='stale-revision' || error.code==='PL-CORE-STALE');
  assert.notStrictEqual(accepted,stored);assert.strictEqual(h.state.territorialEntities,accepted);
  assert.deepEqual(h.repository.list().map(row=>row.id),before.map(row=>row.id));assert.equal(h.repository.get('R'),null);
  assert.deepEqual(h.calls,calls,'late import adds no commit or autosave after the independent edit');
});
