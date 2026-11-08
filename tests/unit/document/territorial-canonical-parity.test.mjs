import "../../helpers/spherical-core.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {buildCurrentWorld} from "../../../tools/data/territorial-current-world.mjs";
import {encodeCanonicalCountryPacket} from "../../../tools/build/canonical-country-packet-encoder.mjs";
import {buildCountrySharedBoundarySegments, serializeCountrySharedBoundarySegments} from "../../../src/geometry/boundary-topology.js";
import {countryGeometrySignature} from "../../../src/rendering/country-shared-boundary-cache.js";
import {classifyBuiltinCountries} from "../../../src/document/builtin-subunits.js";
import {readTerritorialSources, territorialDataRoot} from "../../../tools/data/territorial-entity-sources.mjs";
import {normalizeTerritorialLibraryIndex, selectGeometryVersion} from "../../../tools/gis/territorial-library.js";
import path from 'node:path';
import {executeTerritorialTestCommand} from "../../helpers/timeline-project.mjs";
import {createGisCoreFixture} from "../../helpers/gis-core-fixture.mjs";
import vm from 'node:vm';
import {createTerritorialFeature} from "../../../src/document/territorial-units.js";

const root=new URL("../../../",import.meta.url);
const worldBundle=JSON.parse(fs.readFileSync(new URL('assets/data/world/current.json',root),'utf8'));
test('explicit world view exactly reproduces generated features and encoded PCG bytes',()=>{
 const original=JSON.parse(fs.readFileSync(new URL('assets/data/territorial-entities/generated/current-world.geojson',root),'utf8'));
 const candidate=buildCurrentWorld();
 assert.deepEqual(candidate,original);
 const bytes=gunzipSync(fs.readFileSync(new URL('assets/data/'+worldBundle.assets.canonicalCountryPacket.url,root)));
 assert.deepEqual(Buffer.from(encodeCanonicalCountryPacket(candidate)),bytes);
});
test('explicit world view reproduces canonical shared-boundary signatures and every segment',()=>{
 const candidate=classifyBuiltinCountries(buildCurrentWorld());
 const countries=[...candidate.countries.features,...candidate.subunits.map(unit=>({id:unit.properties.metadata.builtinSubunit.sourceCountryId,geometry:unit.geometry}))];
 const packet=JSON.parse(gunzipSync(fs.readFileSync(new URL('assets/data/'+worldBundle.compatibility.sharedBoundaries.canonical,root))));
 assert.deepEqual(Object.fromEntries(countries.map(f=>[String(f.id),countryGeometrySignature(f)])),packet.signatures);
 assert.deepEqual(serializeCountrySharedBoundarySegments(buildCountrySharedBoundarySegments(countries)),packet.segments);
});

test('current and dated snapshots use identical reference-only storage and covered versions',()=>{
  const sources=new Map(readTerritorialSources().map(e=>[e.entityId,e]));
  const index=normalizeTerritorialLibraryIndex(JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'generated/v2/index.json'),'utf8')));
  assert.equal(index.snapshots.length,2);
  for(const snapshot of index.snapshots){
    assert.equal(snapshot.schemaVersion,1);
    assert.equal(Object.hasOwn(snapshot,'geometry'),false);
    assert.equal(Object.hasOwn(snapshot,'geometryVersions'),false);
    const file=fs.readdirSync(path.join(territorialDataRoot,'source/snapshots')).find(name=>JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'source/snapshots',name),'utf8')).id===snapshot.id);
    assert.deepEqual(snapshot,JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'source/snapshots',file),'utf8')));
    for(const ref of snapshot.entityRefs)assert.ok(selectGeometryVersion(sources.get(ref),snapshot.referenceDate),`${snapshot.id}: ${ref}`);
  }
});
test('snapshot input cannot mutate the normalized reference list',()=>{
  const raw=JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'generated/v2/index.json'),'utf8'));
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
