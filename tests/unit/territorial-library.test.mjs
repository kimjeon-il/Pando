import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTerritorialLibraryEntity, selectGeometryVersion, instantiateLibraryEntity, TERRITORIAL_LIBRARY_SCHEMA_VERSION } from "../../apps/editor/frontend/js/modules/territorial-library.js";
import {projectTimelineIdentity} from '../../shared/frontend/js/modules/timeline-resolver.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
const entity = () => ({ schemaVersion: 2, entityId: 'state:sample', entityKind: 'general', names: {ko:'Sample',en:'Sample'}, lifetime: {validFrom: null, validTo: null}, geometryVersions: [{versionId: 'sample:current', validFrom: null, validTo: null, geometry, certainty: 'high', sourceId: 'test'}], metadata: { note: 'preserved' }, sourceInfo: { license: 'test' } });

test('Web temporal identity projects the selected multilingual details and clears absent details',()=>{
  const identity={id:'A',properties:{name:'New',style:{},metadata:{nameDetails:{ko:{common:'New',formal:'New formal'}},kept:1}}};
  const names={ko:{common:'Old',formal:'Old formal',aliases:['Old alias']},native:[{language:'hy',common:'Native'}]};
  const selected=projectTimelineIdentity(identity,{name:{name:'Old',nameExplicit:true,names}});
  assert.deepEqual(selected.properties.metadata.nameDetails,names);assert.equal(selected.properties.name,'Old');
  const cleared=projectTimelineIdentity(identity,{name:{name:'Plain',nameExplicit:true}});
  assert.equal(cleared.properties.metadata.nameDetails,undefined);assert.equal(cleared.properties.metadata.kept,1);
  assert.equal(identity.properties.metadata.nameDetails.ko.common,'New');
});

test('country names follow their own dates independently of geometry', () => {
  const raw = entity();
  raw.nameVersions = [
    {validFrom: '1900', validTo: '1999', names: {ko:{common:'옛 이름',formal:'옛 정식명',aliases:['옛 별칭']}, en:{common:'Old name'}, native:[{language:'xx',common:'Old native'}]}},
    {validFrom: '2000', validTo: null, names: {ko:{common:'새 이름',formal:'새 정식명'}, en:{common:'New name'}, native:[{language:'xx',common:'New native'}]}},
  ];
  const value = normalizeTerritorialLibraryEntity(raw);
  assert.equal(instantiateLibraryEntity(value, '1999-12-31').name, '옛 이름');
  assert.equal(instantiateLibraryEntity(value, '2000-01-01').name, '새 이름');
  assert.deepEqual(value.nameVersions[0].names.ko.aliases, ['옛 별칭']);
  assert.equal(instantiateLibraryEntity(value, '2000-01-01').metadata.nameDetails.ko.formal, '새 정식명');
  assert.equal(instantiateLibraryEntity(value, '2000-01-01').geometryVersionId, 'sample:current');
});

test('name history rejects overlaps and duplicate native languages without mutating names', () => {
  const raw=entity();
  raw.nameVersions=[{validFrom:null,validTo:'2000',names:{ko:{common:'옛 이름'}}},
    {validFrom:'2000',validTo:null,names:{ko:{common:'새 이름'}}}];
  assert.throws(()=>normalizeTerritorialLibraryEntity(raw), /NAME|name/);
  raw.nameVersions=[{validFrom:null,validTo:null,names:{native:[{language:'hy',common:'Արցախ'},{language:'hy',common:'Արցախ'}]}}];
  assert.throws(()=>normalizeTerritorialLibraryEntity(raw), /NAME|name/);
});

test('modern and extinct entities have the same schema and preserve geometry without rewriting', () => {
  assert.equal(TERRITORIAL_LIBRARY_SCHEMA_VERSION, 2);
  for (const lifetime of [{ validFrom: null, validTo: null }, { validFrom: '1918', validTo: '1992-04-26' }]) {
    const raw = entity(); raw.lifetime = lifetime;
    const normalized = normalizeTerritorialLibraryEntity(raw);
    assert.deepEqual(normalized.lifetime, lifetime);
    assert.deepEqual(normalized.geometryVersions[0].geometry, geometry);
    assert.notEqual(normalized.geometryVersions[0].geometry, geometry);
    assert.deepEqual(normalized.metadata, raw.metadata);
    assert.deepEqual(normalized.sourceInfo, raw.sourceInfo);
    assert.equal(Object.hasOwn(normalized, 'isHistorical'), false);
    raw.geometryVersions[0].geometry = null;
    assert.deepEqual(normalized.geometryVersions[0].geometry, geometry);
  }
});

const history = () => ({...entity(), lifetime: {validFrom: '1948-08-15', validTo: null}, geometryVersions: [
  {...entity().geometryVersions[0], versionId: 'sample:1948', validFrom: '1948-08-15', validTo: '1953-07-26'},
  {...entity().geometryVersions[0], versionId: 'sample:1953', validFrom: '1953-07-27', validTo: '2000-12-31'},
  {...entity().geometryVersions[0], versionId: 'sample:current', validFrom: '2001-01-01', validTo: null},
]});
test('dated versions select inclusively and outside lifetime has no nearest fallback', () => {
  const value = normalizeTerritorialLibraryEntity(history());
  for (const [date, id] of [['1948', 'sample:1948'], ['1953-07-26', 'sample:1948'], ['1953-07-27', 'sample:1953'], ['1953-07', 'sample:1953'], ['2026-10-06', 'sample:current']]) assert.equal(selectGeometryVersion(value,date)?.versionId, id);
  assert.equal(selectGeometryVersion(value, '1947'), null);
  assert.throws(() => selectGeometryVersion(value), /reference date/);
});
test('overlaps, ambiguous undated versions, duplicate IDs, year zero and invalid leap days are rejected', () => {
  for (const mutate of [raw => {raw.geometryVersions[1].validFrom = '1953-07-26';}, raw => {raw.geometryVersions[0].validFrom = null; raw.geometryVersions[0].validTo = null;}, raw => {raw.geometryVersions[0].validFrom = '0000';}, raw => {raw.geometryVersions[0].validFrom = '1900-02-29';}]) {
    const raw = history(); mutate(raw); assert.throws(() => normalizeTerritorialLibraryEntity(raw));
  }
});
test('BCE/CE precision, extended years, leap month end and geometry gaps use the temporal contract', () => {
  const raw = entity(); raw.geometryVersions = [
    {...raw.geometryVersions[0], versionId:'bce',validFrom:'-0400',validTo:'-0001'},
    {...raw.geometryVersions[0], versionId:'ce',validFrom:'0001',validTo:'2000-02-28'},
    {...raw.geometryVersions[0], versionId:'extended',validFrom:'+010000',validTo:null},
  ];
  const value = normalizeTerritorialLibraryEntity(raw);
  assert.equal(selectGeometryVersion(value,'-0001')?.versionId,'bce');
  assert.equal(selectGeometryVersion(value,'0001')?.versionId,'ce');
  assert.equal(selectGeometryVersion(value,'2000-02'),null);
  assert.equal(selectGeometryVersion(value,'+010000')?.versionId,'extended');
});

test('invalid IDs, versions, geometry and reversed lifetime fail visibly', () => {
  for (const mutate of [raw => {raw.entityId = '';}, raw => {raw.schemaVersion = 3;}, raw => {raw.geometryVersions.push({...raw.geometryVersions[0]});}, raw => {raw.geometryVersions[0].geometry = {type: 'LineString', coordinates: [[0,0],[1,1]]};}, raw => {raw.lifetime = {validFrom: '2000', validTo: '1900'};}]) {
    const raw = entity(); mutate(raw);
    assert.throws(() => normalizeTerritorialLibraryEntity(raw));
  }
});

test('a single country identity selects historic replacement and modern independent geometry without changing source ID', () => {
  const raw = history();
  raw.instantiation = {mode:'independent',countryUpdates:{}};
  raw.geometryVersions[0].instantiation={mode:'territory-replacement',countryUpdates:{}};
  raw.geometryVersions[0].historicalProvenance={originalEntityId:'state:historical-sample',sourceInfo:{title:'historic source'}};
  const normalized=normalizeTerritorialLibraryEntity(raw);
  const earlier=instantiateLibraryEntity(normalized,'1948-08-15');
  const latest=instantiateLibraryEntity(normalized,'2026-10-06');
  assert.equal(earlier.entityId,latest.entityId);
  assert.equal(earlier.geometryVersionId,'sample:1948');
  assert.equal(earlier.instantiation.mode,'territory-replacement');
  assert.equal(earlier.metadata.historicalProvenance.originalEntityId,'state:historical-sample');
  assert.equal(latest.instantiation.mode,'independent');
  assert.equal(latest.metadata.historicalProvenance,undefined);
});
