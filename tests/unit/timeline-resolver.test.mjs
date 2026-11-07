import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "node:fs";
import * as __dep3 from "../../shared/frontend/js/modules/timeline-storage.js";
import * as __dep4 from "../../shared/frontend/js/modules/timeline-resolver.js";
import * as __dep5 from "../helpers/spherical-core.mjs";
import * as __dep6 from "../../tools/gis/timeline-edit.js";
import * as __dep7 from "../../shared/frontend/js/modules/timeline-records.js";
import * as __dep8 from "../../tools/builtin-country-bytes.mjs";
import * as __dep9 from "node:crypto";
import * as __dep10 from "node:zlib";
import * as __dep11 from "../../tools/territorial-entity-sources.mjs";
import * as __dep12 from "../../tools/gis/territorial-library.js";
import * as __dep13 from "../../tools/gis/normalize-2026-source-reference.mjs";
import * as __dep14 from "../../shared/frontend/js/modules/builtin-world-loader.js";
import * as __dep15 from "../../shared/frontend/js/modules/temporal.js";

// Original feature contract: timeline-resolver.test.mjs
contractSuite("timeline-resolver", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { readFileSync } = __dep2;
const { restoreTimelineStorage } = __dep3;
const { initialTimelineMonth, resolveWorld, resolvedTimelineViews } = __dep4;
const { sphericalCore } = __dep5;

const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
const catalog = project.territorialEntities.map(feature => ({ objectRef:{domain:"territorial",id:feature.id}, entityKind: feature.properties.entityKind }));
const storage = restoreTimelineStorage({ schemaVersion: 1, records: project.timelineRecords,
  geometries: project.geometries }, catalog);
const resolve = month => resolveWorld(project.territorialEntities, storage.records, storage.geometries, month);

test('month-end resolution selects exact geometry versions and parent graph', () => {
  const june = resolve('1914-06');
  const july = resolve('1914-07');
  const later = resolve('1916-01');
  assert.equal(july.month, '1914-07');
  assert.deepEqual(june.entities.map(row => row.objectRef.id), ['A', 'B', 'C', 'R']);
  assert.deepEqual(june.byId.get('A').geometryRef, { id: 'shape', version: 1 });
  assert.deepEqual(july.byId.get('A').geometryRef, { id: 'shape', version: 2 });
  assert.equal(july.byId.get('B').parentId, 'A');
  assert.equal(later.byId.get('B').parentId, 'C');
  assert.equal(later.byId.get('B').rootId, 'C');
  assert.deepEqual(later.byId.get('B').ancestors, ['C']);
  assert.equal(later.byId.set, undefined);
  assert.ok(Object.isFrozen(later.byId.get('B')));
  assert.throws(() => { later.byId.get('B').identity.properties.name = 'changed'; }, TypeError);
});

test('month-end resolution respects disjoint lifetimes and exact days', () => {
  assert.deepEqual(resolve('1909-12').entities.map(row => row.objectRef.id), ['A', 'C', 'R']);
  assert.deepEqual(resolve('1910-01').entities.map(row => row.objectRef.id), ['A', 'B', 'C', 'R']);
  assert.deepEqual(resolve('1920-04').entities.map(row => row.objectRef.id), ['A', 'C', 'R']);
  assert.deepEqual(resolve('1914-07-31').entities.map(row=>row.id),resolve('1914-07').entities.map(row=>row.id));
});

test('month-end resolution includes exact starts and excludes exact mid-month ends', () => {
  assert.ok(resolve('1910-01').byId.get('B'));

  const ended = structuredClone(project.timelineRecords);
  ended.lifetimes.find(row => row.id === 'B:modern').validTo = '1910-01-15';
  ended.geometryBindings.find(row => row.id === 'B:modern-shape').validTo = '1910-01-15';
  ended.parentRelations.find(row => row.id === 'B:old-parent').validTo = '1910-01-15';
  // A shortened lifetime cannot retain a later parent record outside that lifetime.
  ended.parentRelations = ended.parentRelations.filter(row => row.id !== 'B:new-parent');
  const endedStorage = restoreTimelineStorage({ schemaVersion: 1, records: ended,
    geometries: project.geometries }, catalog);
  const january = resolveWorld(project.territorialEntities, endedStorage.records, endedStorage.geometries, '1910-01');
  assert.equal(january.byId.get('B'), undefined);
});

test('initial month uses the latest explicit record start and static fallback', () => {
  assert.equal(initialTimelineMonth(storage.records, '2026-10'), '1916-01');
  assert.equal(initialTimelineMonth({ schemaVersion: 3, propertyBindings: [], lifetimes: [{ id: 'life:A', objectRef:{domain:"territorial",id:'A'}, validFrom: null, validTo: null }], geometryBindings: [], parentRelations: [] }, '2026-10'), '2026-10');
});

test('independent timeline golden months match effective identity, version and ancestry', () => {
  const golden = JSON.parse(readFileSync(new URL('../fixtures/portability/timeline-resolution.json', import.meta.url), 'utf8'));
  for (const row of golden.cases) {
    assert.deepEqual(resolve(row.month).entities.map(entity => [entity.id, entity.geometryRef.id,
      entity.geometryRef.version, entity.parentId, entity.rootId, entity.ancestors]), row.expected, row.month);
  }
});

test('materialized editor views contain only living features at the selected month', () => {
  const before = resolvedTimelineViews(project.territorialEntities, storage.records, storage.geometries, '1909-12');
  const after = resolvedTimelineViews(project.territorialEntities, storage.records, storage.geometries, '1916-01');
  assert.deepEqual(before.map(feature => feature.id), ['A', 'C', 'R']);
  assert.equal(after.find(feature => feature.id === 'B').properties.parentId, 'C');
  assert.deepEqual(after.find(feature => feature.id === 'A').geometry, storage.geometries.get({ id: 'shape', version: 2 }));
});

test('scattered timeline rows retain catalog order, exact values, ancestry and validation failures', () => {
  const ids = ['__proto__', 'constructor', '국가:😀', ...Array.from({ length: 37 }, (_, index) => `entity:${index}`)];
  const entities = ids.map(id => ({ objectRef:{domain:'territorial',id}, entityKind: 'general' })).reverse();
  const records = { schemaVersion: 3, lifetimes: [], geometryBindings: [], parentRelations: [], propertyBindings: [] };
  for (const [index, entityId] of ids.entries()) {
    records.lifetimes.push({ id: `life:${index}`, objectRef:{domain:'territorial',id:entityId}, validFrom: '1910', validTo: '1915' });
    for (let year = 1910; year <= 1915; year++) {
      const common = { objectRef:{domain:'territorial',id:entityId}, validFrom: String(year), validTo: String(year) };
      records.geometryBindings.push({ ...common, id: `geometry:${index}:${year}`, geometryRef: { id: 'shape', version: year - 1909 } });
      records.parentRelations.push({ ...common, id: `parent:${index}:${year}`, parentId: index ? ids[Math.floor((index - 1) / 3)] : '', coverageMode: 'explicit' });
      records.propertyBindings.push({ ...common, id: `name:${index}:${year}`, property: 'name', value: { name: `${entityId}:${year}`, nameExplicit: year % 2 === 0 } });
    }
  }
  // Row tables have different orders and do not match catalog order.
  records.geometryBindings.reverse();
  records.propertyBindings.reverse();
  const before = JSON.stringify(records), visits = [];
  const context = { entities, geometryExists: ref => { visits.push(ref.version); return true; } };
  for (const month of ['1909-12', '1910-01', '1912-07', '1915-12', '1916-01']) {
    visits.length = 0;
    const world = sphericalCore.timelineResolveWorld(records, context, month);
    assert.equal(world.month, month);
    assert.deepEqual(visits, records.geometryBindings.map(row => row.geometryRef.version), 'all geometry validation retains row order');
    const year = Number(month.slice(0, 4));
    assert.deepEqual(world.entities.map(row => row.objectRef.id), year < 1910 || year > 1915 ? [] : entities.map(row => row.objectRef.id));
    for (const row of world.entities) {
      const ancestors = [];
      let index = ids.indexOf(row.objectRef.id);
      while (index) { index = Math.floor((index - 1) / 3); ancestors.push(ids[index]); }
      assert.deepEqual(row.ancestors, ancestors);
      assert.equal(row.rootId, ids[0]);
      assert.deepEqual(row.geometryRef, { id: 'shape', version: year - 1909 });
      assert.deepEqual(row.properties, { name: { name: `${row.objectRef.id}:${year}`, nameExplicit: year % 2 === 0 } });
    }
    assert.equal(JSON.stringify(records), before);
  }
  const failure = new Error('repository sentinel');
  assert.throws(() => sphericalCore.timelineResolveWorld(records, { entities, geometryExists() { throw failure; } }, '1912-01'), error => error === failure);
  const duplicate = structuredClone(records);
  duplicate.lifetimes.push({ ...duplicate.lifetimes[0], id: 'overlap' });
  assert.throws(() => sphericalCore.timelineResolveWorld(duplicate, context, '1912-01'), { code: 'TIMELINE_OVERLAP' });
  assert.equal(JSON.stringify(records), before);
});
});

// Original feature contract: timeline-objects-parity.test.mjs
contractSuite("timeline-objects-parity", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { readFileSync } = __dep2;
const { replaceTimelineRecordAtMonth, truncateTimelineEntityAtMonth } = __dep6;
const { normalizeTimelineRecords } = __dep7;

const corpus = JSON.parse(readFileSync(new URL('../fixtures/portability/timeline-edit.json', import.meta.url), 'utf8'));
const context = { entities: corpus.entities, geometryExists: () => true };

test('historical timeline edits match the shared web/native golden corpus', () => {
  assert.equal(corpus.schema, 'timeline-edit-parity-v1');
  assert.equal(corpus.cases.length, 5);
  normalizeTimelineRecords(corpus.records, context);
  for (const entry of corpus.cases) {
    const original = structuredClone(corpus.records);
    let result;
    if (entry.op === 'geometry') result = replaceTimelineRecordAtMonth(original, 'geometryBindings',
      {domain:"territorial",id:'A'}, entry.month, { geometryRef: { id: 'shape', version: entry.version } });
    else if (entry.op === 'parent') result = replaceTimelineRecordAtMonth(original, 'parentRelations',
      {domain:"territorial",id:'A'}, entry.month, { parentId: entry.parentId, coverageMode: entry.coverageMode });
    else if (entry.op === 'truncate') result = truncateTimelineEntityAtMonth(original, {domain:"territorial",id:'A'}, entry.month);
    else assert.fail('Unknown edit operation');
    assert.deepEqual(result, entry.expected, entry.name);
    assert.deepEqual(original, corpus.records, entry.name + ' must not mutate source');
    if (entry.identity) assert.strictEqual(result, original, entry.name + ' should be a no-op');
    normalizeTimelineRecords(result, context);
  }
});
});

// Original feature contract: source-date-cut-normalization.test.mjs
contractSuite("source-date-cut-normalization", () => {
const test = __dep1.default;
const { readBuiltinCountryStoredBytes } = __dep8;
const assert = __dep0.default;
const fs = __dep2.default;
const { createHash } = __dep9;
const { gunzipSync } = __dep10;
const { readTerritorialSources, territorialSourceRoot } = __dep11;
const { selectGeometryVersion } = __dep12;
const { SOURCE_CUTS, SOURCE_REFERENCE_DATE, planSourceDateConsolidation } = __dep13;
const { selectBuiltinCountries, assembleBuiltinWorld } = __dep14;
const { temporalContains, temporalMonthEnd } = __dep15;

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const world=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
test('source reference 2026-10-06 never becomes a political geometry transition',()=>{
 const entries=readTerritorialSources(),byId=new Map(entries.map(e=>[e.entityId,e]));
 const view=JSON.parse(fs.readFileSync(territorialSourceRoot+'/views/world.json','utf8'));
 const outcome=planSourceDateConsolidation(entries,view);
 assert.equal(outcome.already,true,'Five verified sources must be normalized before publishing');
 assert.equal(outcome.proof.length,5);
 for(const rule of SOURCE_CUTS){
  const e=byId.get(rule.id),kept=e.geometryVersions.find(v=>v.versionId===rule.history);
  assert.ok(e);
  assert.equal(e.lifetime.validTo,null,rule.id);
  assert.equal(kept.validFrom,rule.first,rule.id+' event date');
  assert.equal(kept.validTo,null,rule.id+' must remain valid without a fabricated end date');
  assert.equal(kept.certainty,'low',rule.id+' historical proxy confidence');
  assert.equal(kept.historicalProvenance.sourceReferenceDate,SOURCE_REFERENCE_DATE);
  assert.equal(e.metadata.sourceOutlineReferenceDate,SOURCE_REFERENCE_DATE);
  assert.equal(e.metadata.representativeGeometryVersionId,rule.history);
  assert.equal(e.geometryVersions.some(v=>v.versionId===rule.modern),false);
  assert.equal(e.geometryVersions.some(v=>v.validFrom===SOURCE_REFERENCE_DATE||v.validTo==='2026-10-05'),false);
  assert.equal(e.sourceInfo.temporalBoundaryCorrection.kind,'source-reference-date-not-geopolitical-event');
  assert.equal(e.sourceInfo.temporalBoundaryCorrection.geometrySha256,sha(kept.geometry));
  assert.equal(selectGeometryVersion(e,'2026-10-05')?.versionId,rule.history);
  assert.equal(selectGeometryVersion(e,'2026-10-06')?.versionId,rule.history);
  assert.equal(selectGeometryVersion(e,'2026-10-31')?.versionId,rule.history);
  assert.equal(view.selections.find(row=>row.entityId===rule.id)?.geometryVersionId,rule.history);
 }
});
test('published world retains uninterrupted source geometry through October 2026',()=>{
 const index=JSON.parse(fs.readFileSync(new URL('index.json',world),'utf8'));
 const entries=new Map(index.entities.map(row=>[row.entityId,row]));
 const selected=new Set(selectBuiltinCountries(index,'2026-10').map(row=>row.entityId));
 const selectedPrevious=new Set(selectBuiltinCountries(index,'2026-09').map(row=>row.entityId));
 for(const rule of SOURCE_CUTS){
  const projectId=rule.id.slice('state:'.length);
  assert.ok(selected.has(projectId),projectId+' missing in October');
  assert.ok(selectedPrevious.has(projectId),projectId+' missing in September');
  const record=entries.get(projectId);
  assert.ok(record);
  const compressed=readBuiltinCountryStoredBytes(record,file=>fs.readFileSync(new URL(file,world)));
  assert.equal(createHash('sha256').update(compressed).digest('hex'),record.sha256);
  const compiled=JSON.parse(gunzipSync(compressed));
  const selectedSource=month=>compiled.sourceBindings.find(row=>temporalContains(row,temporalMonthEnd(month)))?.sourceVersionId;
  assert.equal(selectedSource('2026-09'),rule.history,projectId+' prior source');
  assert.equal(selectedSource('2026-10'),rule.history,projectId+' current source');
  const active=month=>assembleBuiltinWorld({...index,entities:[record]},[compiled],month);
  const before=active('2026-09'),after=active('2026-10');
  assert.equal(before.territorialEntities[0].properties.sourceGeometryVersion,rule.history);
  assert.equal(after.territorialEntities[0].properties.sourceGeometryVersion,rule.history);
 }
});
});
