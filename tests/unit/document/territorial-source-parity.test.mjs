import { describe as contractSuite } from 'node:test';
import * as __source_dep0 from "node:test";
import * as __source_dep1 from "node:assert/strict";
import * as __source_dep2 from "node:fs";
import * as __source_dep3 from "node:crypto";
import * as __source_dep4 from "../../../tools/data/territorial-entity-sources.mjs";
import * as __source_dep5 from "../../../tools/gis/territorial-library.js";
import * as __source_dep6 from "node:os";
import * as __source_dep7 from "node:path";
import * as __source_dep8 from "../../../src/document/territorial-units.js";
import * as __source_dep9 from "../../helpers/core-project.mjs";
import * as __source_dep10 from "../../helpers/production-geopackage.mjs";
contractSuite("territorial-source-parity", () => {
const test = __source_dep0.default;
const assert = __source_dep1.default;
const fs = __source_dep2.default;
const { createHash } = __source_dep3;
const { readTerritorialSources } = __source_dep4;
const { selectGeometryVersion, territorialEntityExistsAt, normalizeTerritorialLibraryEntity } = __source_dep5;







const dataRoot = new URL("../../../assets/data/", import.meta.url);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const currentDate = () => {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
};

test('current published countries preserve original attribution and explain approved changed geometry', () => {
  const original = JSON.parse(fs.readFileSync(new URL('countries-ne-5.1.1.geojson', dataRoot), 'utf8'));
  assert.equal(original.type, 'FeatureCollection');
  assert.ok(original.features.length > 0);
  const source = readTerritorialSources();
  const byFeature = new Map(source.filter(entity => entity.sourceInfo?.featureId)
    .map(entity => [entity.sourceInfo.featureId, entity]));
  assert.equal(new Set(original.features.map(f => f.id)).size, original.features.length);
  assert.equal(byFeature.size, source.filter(entity => entity.sourceInfo?.featureId).length,
    'two countries cannot claim the same original feature identity');
  assert.ok(byFeature.size >= original.features.length, 'no original country may disappear');
  const today = currentDate();
  for (const feature of original.features) {
    const entity = byFeature.get(feature.id);
    assert.ok(entity, 'missing imported country: ' + feature.id);
    assert.deepEqual(entity.sourceInfo.featureProperties, feature.properties,
      feature.id + ': original country properties changed');
    const selected = selectGeometryVersion(entity, today);
    assert.ok(selected, feature.id + ': no contemporary geometry');
    assert.equal(selected.versionId, entity.metadata.representativeGeometryVersionId,
      feature.id + ': display version differs from active source');
    const actualSha = digest(selected.geometry), originalSha = digest(feature.geometry);
    if (actualSha === originalSha) {
      assert.deepEqual(selected.geometry, feature.geometry, feature.id + ': original source must remain intact');
    } else {
      assert.equal(entity.sourceInfo.geometrySha256, actualSha,
        feature.id + ': changed geometry requires a matching current-source receipt');
      assert.ok(selected.historicalProvenance || selected.modernBoundarySupplement,
        feature.id + ': changed modern border needs attributable provenance');
    }
    assert.doesNotMatch(entity.metadata.defaultFlagDataUrl || '', /^file:/);
  }
});

test('all source versions retain valid identity, date selection and exact declared reused geometry', () => {
  const source = readTerritorialSources(), byId = new Map(source.map(entity => [entity.entityId, entity]));
  assert.ok(source.some(entity => entity.geometryVersions.length > 1), 'the historical corpus must not be empty');
  for (const entity of source) {
    const ids = new Set();
    for (const version of entity.geometryVersions) {
      assert.ok(version.versionId && !ids.has(version.versionId), entity.entityId + ': duplicate version');
      ids.add(version.versionId);
      // Exact days are useful admission boundaries. Years and months are
      // deliberately not treated as January 1: the Core uses period-end queries.
      if (/^\d{4}-\d{2}-\d{2}$/.test(version.validFrom || '') &&
          territorialEntityExistsAt(entity, version.validFrom)) {
        assert.equal(selectGeometryVersion(entity, version.validFrom)?.versionId, version.versionId,
          entity.entityId + ': incorrect active border at ' + version.validFrom);
      }
      const provenance = version.historicalProvenance;
      if (provenance?.sourceEntityId && provenance.sourceGeometryVersionId) {
        const owner = byId.get(provenance.sourceEntityId)?.geometryVersions.find(v =>
          v.versionId === provenance.sourceGeometryVersionId);
        assert.ok(owner, entity.entityId + ': missing documented source version');
        assert.deepEqual(version.geometry, owner.geometry,
          entity.entityId + ': coordinate reuse differs from recorded provenance');
      }
      for (const field of ['reviewedMasterSha256', 'displaySha256'])
        if (version[field]) assert.match(version[field], /^[a-f0-9]{64}$/,
          entity.entityId + ': invalid content receipt for ' + version.versionId);
    }
    const active = selectGeometryVersion(entity, currentDate());
    if (active) assert.ok(ids.has(active.versionId), entity.entityId + ': selected unregistered geometry');
  }
});

test('source admission rejects newly overlapping geometry even when its version ID changes', () => {
  const source = readTerritorialSources();
  const entity = structuredClone(source.find(row => row.geometryVersions.length > 0));
  const colliding = structuredClone(entity.geometryVersions[0]);
  colliding.versionId += ':unapproved-copy';
  entity.geometryVersions.push(colliding);
  assert.throws(() => normalizeTerritorialLibraryEntity(entity), /overlapping geometry versions/i);
});
});
contractSuite("territorial-source-files", () => {
const assert = __source_dep1.default;
const fs = __source_dep2.default;
const os = __source_dep6.default;
const path = __source_dep7.default;
const test = __source_dep0.default;
const sources = __source_dep4;







const sample=entityId=>({schemaVersion:2,entityId,entityKind:'general',names:{ko:entityId},lifetime:{validFrom:null,validTo:null},geometryVersions:[{versionId:'border',validFrom:null,validTo:null,geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]}}]});
function writeFixture(root) {
  fs.mkdirSync(path.join(root,'countries'));fs.mkdirSync(path.join(root,'lineages'));
  const lineage={schemaVersion:2,lineageId:'germany',names:{ko:'독일'},entityRefs:['state:DEU','state:GDR'],relations:[{type:'successor',from:'state:GDR',to:'state:DEU'}]};
  fs.writeFileSync(path.join(root,'lineages/germany.json'),JSON.stringify(lineage));
  for(const id of lineage.entityRefs)fs.writeFileSync(path.join(root,'countries',sources.entityFileName(id)),JSON.stringify({...sample(id),lineageId:'germany'}));
  return lineage;
}

test('independent country files retain scoped versions and reference-only lineage membership',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pando-lineage-'));t.after(()=>fs.rmSync(root,{recursive:true}));
  writeFixture(root);
  const result=sources.readTerritorialSources(root);
  assert.deepEqual(result.map(e=>[e.entityId,e.lineageId,e.geometryVersions[0].versionId]),[['state:DEU','germany','border'],['state:GDR','germany','border']]);
  assert.throws(()=>sources.entityFileName('state:../escape'),/Unsafe/);
});
test('source update changes only explicit identity and preserves curated sibling, names and relations',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pando-lineage-'));t.after(()=>fs.rmSync(root,{recursive:true}));
  const lineage=writeFixture(root);
  const sibling=fs.readFileSync(path.join(root,'countries/state-DEU.json'),'utf8');
  sources.updateTerritorialSource('state:GDR',entity=>({...entity,metadata:{note:'curated'}}),root);
  const result=JSON.parse(fs.readFileSync(path.join(root,'countries/state-GDR.json'),'utf8'));
  assert.equal(fs.readFileSync(path.join(root,'countries/state-DEU.json'),'utf8'),sibling);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'lineages/germany.json'),'utf8')),lineage);
  assert.equal(result.metadata.note,'curated');
  const before=fs.readFileSync(path.join(root,'countries/state-GDR.json'),'utf8');
  assert.throws(()=>sources.updateTerritorialSource('state:GDR',e=>({...e,entityId:'state:wrong'}),root));
  assert.equal(fs.readFileSync(path.join(root,'countries/state-GDR.json'),'utf8'),before);
});

test('orphan or multiply-owned country objects and dangling parent edits are rejected atomically',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pando-country-'));t.after(()=>fs.rmSync(root,{recursive:true}));
 writeFixture(root);const file=path.join(root,'countries/state-GDR.json');const before=fs.readFileSync(file,'utf8');
 assert.throws(()=>sources.updateTerritorialSource('state:GDR',e=>({...e,parentEntityId:'state:missing'}),root));
 assert.equal(fs.readFileSync(file,'utf8'),before);
 fs.writeFileSync(path.join(root,'countries/state-orphan.json'),JSON.stringify({...sample('state:orphan'),lineageId:'germany'}));
 assert.throws(()=>sources.readTerritorialSources(root));
});
});
contractSuite("territorial-source-provenance", () => {
const assert = __source_dep1.default;
const test = __source_dep0.default;
const { readFileSync } = __source_dep2;
const { normalizeTerritorialIdentity } = __source_dep8;
const { createNodeCoreProject } = __source_dep9;
const { productionGeoPackage, spatialColumns } = __source_dep10;






const input=()=>{
 const seed=JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json",import.meta.url),'utf8'));
 const feature=seed.territorialEntities.find(row=>row.id==='A');
 Object.assign(feature.properties,{sourceEntityId:'state:KOR',sourceGeometryVersion:'current'});
 Object.assign(feature.properties.metadata,{sourceLifetime:{validFrom:'1948-08-15',validTo:null},sourceReferenceDate:'2026-10-06'});
 return seed;
};

test('source entity identity and selected version survive the actual Core JSON and GeoPackage boundary independently from object ID',async t=>{
 const owner=await createNodeCoreProject(input());t.after(()=>owner.dispose());
 const receipt=await owner.client.exportSnapshot({format:'pandolab-project-state',version:'fixture',savedAt:'2026-10-04T00:00:00.000Z'});
 const stored=JSON.parse(receipt.storageJson),p=stored.territorialEntities.find(row=>row.id==='A').properties;
 assert.equal(p.schemaVersion,6);assert.equal(p.sourceEntityId,'state:KOR');assert.equal(p.sourceGeometryVersion,'current');
 assert.equal(Object.hasOwn(p,'sourceLibraryId'),false);assert.notEqual('A',p.sourceEntityId);
 const written=await productionGeoPackage('write',new ArrayBuffer(0),stored,receipt.spatialState);
 const columns=spatialColumns(written.buffer,'entities');assert.ok(columns.includes('source_entity_id'));assert.equal(columns.includes('source_library_id'),false);
 const reopened=await productionGeoPackage('read',written.buffer);
 assert.deepEqual(await owner.client.validateImport(JSON.stringify(reopened.metadata.projectState)),stored);
});

test('retired project version and source field reject without changing the active Core document',async t=>{
 const seed=input(),owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());const state=owner.client.state(),before=owner.documentModel.snapshot();
 await assert.rejects(owner.client.validateImport(JSON.stringify({...seed,schemaVersion:9})));
 const identity=structuredClone(seed.territorialEntities[0]);identity.properties.sourceLibraryId='old';
 assert.throws(()=>normalizeTerritorialIdentity(identity),{code:'PL-SCHEMA-FIELD'});
 const changed=structuredClone(seed);changed.territorialEntities[0]=identity;await assert.rejects(owner.client.validateImport(JSON.stringify(changed)));
 assert.equal(owner.documentModel.snapshot(),before);assert.deepEqual(owner.client.state(),state);
});
});
