import assert from 'node:assert/strict';
import test from 'node:test';
import * as catalog from '../../tools/gis/territorial-library.js';
import {normalizeTerritorialLibraryEntity} from '../../tools/gis/territorial-library.js';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {libraryCheckout} from "../../tools/data/library-context.mjs";
import {join} from 'node:path';
import {entityFileName, readTerritorialSources, readTerritorialLineages, territorialSourceRoot} from "../../tools/data/territorial-entity-sources.mjs";

const entity=(entityId,from=null,to=null)=>({schemaVersion:2,entityId,entityKind:'general',names:{ko:entityId,en:entityId,de:'curated'},alternateNames:['alias'],lifetime:{validFrom:from,validTo:to},geometryVersions:[{versionId:'border',validFrom:from,validTo:to,certainty:'high',sourceId:'synthetic-test',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]});
const lineage=()=>({schemaVersion:2,lineageId:'germany',names:{ko:'독일',en:'Germany'},entityRefs:['state:test-frg','state:test-gdr'],relations:[]});

test('new entity contract retains names and entity-scoped version identity without geometry rewrites',()=>{
  const raw=entity('state:test');
  const result=catalog.normalizeTerritorialLibraryEntity(raw);
  assert.deepEqual(result.names,{ko:'state:test',en:'state:test',de:'curated'});
  assert.equal(result.geometryVersions[0].versionId,'border');
  assert.deepEqual(result.geometryVersions[0].geometry,raw.geometryVersions[0].geometry);
  assert.ok(Object.isFrozen(result.geometryVersions[0].geometry.coordinates));
});
test('split countries coexist in a lineage and relation never overrides lifetime selection',()=>{
  const raw=lineage();raw.relations=[{type:'successor',from:'state:test-frg',to:'state:test-gdr'}];
  const lineageResult=catalog.normalizeTerritorialLineage(raw);
  assert.deepEqual(lineageResult.entityRefs,['state:test-frg','state:test-gdr']);
  const result={entities:[entity('state:test-frg','1949-05-23','1990-10-02'),entity('state:test-gdr','1949-10-07','1990-10-02')]};
  assert.deepEqual(result.entities.filter(e=>catalog.territorialEntityExistsAt(e,'1970')).map(e=>e.entityId),['state:test-frg','state:test-gdr']);
  assert.equal(catalog.selectGeometryVersion(result.entities[1],'1949-05'),null);
  assert.equal(catalog.selectGeometryVersion(result.entities[1],'1990-10-02').versionId,'border');
  assert.equal(catalog.selectGeometryVersion(result.entities[1],'1990-10-03'),null);
});
test('duplicate entities, unsafe lineage names and malformed succession fail visibly',()=>{
  for(const mutate of [r=>r.entityRefs.push(r.entityRefs[0]),r=>r.lineageId='../escape',r=>r.relations=[{type:'successor',from:'state:test-frg',to:'state:test-frg'}],r=>r.relations=[{type:'parent',from:'state:test-frg',to:'state:test-gdr'}],r=>r.relations=Array(2).fill({type:'successor',from:'state:test-frg',to:'state:test-gdr'})]){const raw=lineage();mutate(raw);assert.throws(()=>catalog.normalizeTerritorialLineage(raw));}
});
test('retired names and version ID keys are rejected rather than read as fallback',()=>{
  for(const mutate of [r=>r.canonicalName='old',r=>r.displayNames={ko:'old'},r=>r.geometryVersions[0].id='old',r=>r.names={}]){const raw=entity('state:test');mutate(raw);assert.throws(()=>catalog.normalizeTerritorialLibraryEntity(raw));}
});

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const countryPath = id => join(territorialSourceRoot, 'countries', entityFileName(id));
const lineagePath = id => join(territorialSourceRoot, 'lineages', id + '.json');
const files = kind => fs.readdirSync(join(territorialSourceRoot, kind)).filter(name => name.endsWith('.json'));
const receiptFor = (index, kind, name) => index.files['assets/data/territorial-entities/source/' + kind + '/' + name];
function assertCurrentReceipt(index, kind, name) {
  const file = join(territorialSourceRoot, kind, name);
  const bytes = fs.readFileSync(file), receipt = receiptFor(index, kind, name);
  assert.ok(receipt, 'source omitted from the current pinned archive: ' + file);
  assert.equal(bytes.length, receipt.bytes, file + ': archive source byte length changed');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.sha256,
    file + ': source bytes differ from pinned archive index');
  return JSON.parse(bytes);
}

test('the active library reads every country, lineage and complete geometry without loss', () => {
  const pin = read(new URL('../../config/library-data.json', import.meta.url));
  assert.match(pin.revision, /^[a-f0-9]{40}$/);
  assert.ok(pin.repository, 'library source identity required');
  const archive = JSON.parse(execFileSync('git', ['show', pin.revision + ':archive/index.json'], {
    cwd: libraryCheckout(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }));
  assert.ok(archive.files, 'the pinned library must supply independent source receipts');
  const entities = readTerritorialSources(), lineages = readTerritorialLineages();
  assert.ok(entities.length && lineages.length, 'reject an empty library');
  assert.equal(entities.length, files('countries').length);
  assert.equal(lineages.length, files('lineages').length);
  const countries = new Map(entities.map(row => [row.entityId, row]));
  assert.equal(countries.size, entities.length, 'duplicate country identity');
  const members = new Set();
  for (const lineage of lineages) {
    const raw = assertCurrentReceipt(archive, 'lineages', lineage.lineageId + '.json');
    assert.deepEqual(lineage.entityRefs, raw.entityRefs, lineage.lineageId);
    assert.deepEqual(lineage.relations, raw.relations, lineage.lineageId);
    for (const id of lineage.entityRefs) {
      assert.ok(countries.has(id), 'missing lineage member: ' + id);
      assert.ok(!members.has(id), 'duplicate lineage member: ' + id);
      assert.equal(countries.get(id).lineageId, lineage.lineageId);
      members.add(id);
    }
    for (const relation of lineage.relations)
      assert.ok(countries.has(relation.from) && countries.has(relation.to), 'missing relation endpoint');
  }
  assert.equal(members.size, entities.length, 'orphan source entities');
  for (const entity of entities) {
    const raw = assertCurrentReceipt(archive, 'countries', entityFileName(entity.entityId));
    for (const key of ['entityId', 'entityKind', 'lineageId', 'names', 'alternateNames', 'parentEntityId'])
      assert.deepEqual(entity[key], raw[key], entity.entityId + ': ' + key);
    assert.deepEqual(entity.sourceInfo, raw.sourceInfo || {}, entity.entityId + ': source provenance');
    assert.deepEqual(entity.geometryVersions.map(row => row.geometry),
      raw.geometryVersions.map(row => row.geometry), entity.entityId + ': coordinates');
    const versions = entity.geometryVersions.map(row => row.versionId);
    assert.ok(versions.length > 0);
    assert.equal(new Set(versions).size, versions.length, entity.entityId + ': duplicate version');
    const visited = new Set([entity.entityId]);
    for (let parent = entity.parentEntityId; parent; parent = countries.get(parent)?.parentEntityId) {
      assert.ok(countries.has(parent) && !visited.has(parent), entity.entityId + ': broken parent chain');
      visited.add(parent);
    }
  }
});

test('invalid identities, duplicate geometry versions and corrupt coordinates are refused', () => {
  const entity = readTerritorialSources()[0];
  const original = read(countryPath(entity.entityId));
  const invalidId = structuredClone(original);
  invalidId.entityId = 'not-a-valid-id';
  assert.throws(() => normalizeTerritorialLibraryEntity(invalidId), /identity|kind/i);
  const duplicate = structuredClone(original);
  duplicate.geometryVersions.push(structuredClone(duplicate.geometryVersions[0]));
  assert.throws(() => normalizeTerritorialLibraryEntity(duplicate), /duplicate.*version/i);
  const corrupted = structuredClone(original);
  const firstPoint = value => Array.isArray(value)
    ? (value.length === 2 && value.every(Number.isFinite) ? value : value.map(firstPoint).find(Boolean)) : null;
  const point = firstPoint(corrupted.geometryVersions[0].geometry.coordinates);
  assert.ok(point, 'source polygon has actual coordinates');
  point[0] = 181;
  assert.throws(() => normalizeTerritorialLibraryEntity(corrupted), /coordinate|geometry|invalid/i);
  assert.deepEqual(read(countryPath(entity.entityId)), original, 'negative tests must not mutate source files');
});
