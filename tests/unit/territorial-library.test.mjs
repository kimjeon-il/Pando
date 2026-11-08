import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeTerritorialLibraryEntity, selectGeometryVersion, instantiateLibraryEntity, TERRITORIAL_LIBRARY_SCHEMA_VERSION, LIBRARY_ENTITY_TYPES} from '../../tools/gis/territorial-library.js';
import {projectTimelineIdentity} from "../../src/document/timeline-resolver.js";
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
import {markEditedLibrarySource} from '../../tools/gis/territorial-library-provenance.js';

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

const historicalData={entities:readTerritorialSources().filter(e=>e.sourceInfo.importProvenance)};
test('East Prussia r3 library preserves the reviewed geometry and reports its limitations', () => {
  const entity = historicalData.entities.find(item => item.entityId === 'state:east-prussia');
  const version = entity.geometryVersions[0];
  const coordinates = version.geometry.coordinates.flat(2);
  const coordinateKeys = new Set(coordinates.map(coordinate => coordinate.join(',')));
  // Hash the approved original, not the normalized read model.
  const path = new URL('../../assets/data/territorial-entities/source/countries/state-east-prussia.json', import.meta.url);
  const original = JSON.parse(readFileSync(path, 'utf8'));
  const approved = original.geometryVersions.find(row => row.versionId === 'ostpreussen-1878-1920-r3');
  assert.ok(approved, 'Missing frozen East Prussia version');
  // Both immutable archival revisions (1879138b and 63aebba2) contain
  // byte-identical East Prussia r3 sources. The historic metadata digest was
  // already stale in the oldest checked revision; do not silently rewrite it.
  const archivedBytes = readFileSync(path);
  assert.equal(createHash('sha256').update(archivedBytes).digest('hex'),
    '78c64c328f76de923907b3beec12100b62c032af0ad858abe03183a61b726646');
  const geometrySha256 = createHash('sha256').update(JSON.stringify(approved.geometry)).digest('hex');
  assert.equal(geometrySha256, '285e75670217a29020bf0dd7de323311f3cdc1e42e3efbb7c462be0ce09d2307');
  // The review metadata mismatch is retained as explicit unresolved provenance,
  // never misinterpreted as a recently altered or approved replacement outline.
  assert.equal(original.metadata.geometrySha256,
    '54c45d4de9f5f16e9dffb06eec24aeaef8f89b82aa455fd7c26b1064fe716237');
  assert.equal(entity.metadata.geometrySha256, original.metadata.geometrySha256);
  assert.notEqual(original.metadata.geometrySha256, geometrySha256,
    'Resolve old review metadata separately with independent evidence');
  assert.deepEqual(version.geometry, approved.geometry,
    'Normalization must preserve exact approved coordinates and component structure');
  assert.equal(version.versionId, 'ostpreussen-1878-1920-r3');
  assert.equal(version.geometry.coordinates.length, 1);
  assert.equal(coordinates.length, 6766);
  assert.ok(coordinateKeys.has('22.76722,54.35627'));
  assert.ok(coordinateKeys.has('22.580668,55.057622'));
  assert.equal(version.certainty, 'medium');
  assert.equal(entity.metadata.approximateGeometry, true);
  assert.equal(entity.metadata.production, false);
  assert.equal(entity.metadata.validation.statisticalAreaWithinOnePercent, false);
  assert.equal(entity.metadata.validation.modernEastUnmatchedLengthM, 0);
  assert.equal(entity.metadata.validation.redistributionPermission, 'unconfirmed');
  assert.equal(entity.metadata.artifactSha256, 'f058012d42205bb02705c8017fba2e3c0e920b2a9f8a9eb21b312b9f7bfbdc0b');
});

test('Prussian province library entries carry their historical province flags', () => {
  for (const [entityId, marker] of [
    ['state:east-prussia', 'id="Oben"'],
    ['state:west-prussia', 'id="Mitte"'],
  ]) {
    const entity = historicalData.entities.find(item => item.entityId === entityId);
    const dataUrl = entity.metadata.defaultFlagDataUrl;
    assert.match(dataUrl, /^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(dataUrl.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
    assert.match(svg, /viewBox="0 0 600 400"/);
    assert.match(svg, new RegExp(marker));
  }
});

test('every static library object has a default flag', () => {
  const missing = historicalData.entities
    .filter(entity => !String(entity.metadata?.defaultFlagDataUrl || '').trim())
    .map(entity => entity.entityId);
  assert.deepEqual(missing, []);
});

test('Artsakh uses the right-originating white stepped flag motif', () => {
  const entity = historicalData.entities.find(item => item.entityId === 'state:nagorno-karabakh');
  const dataUrl = entity.metadata.defaultFlagDataUrl;
  const svg = Buffer.from(dataUrl.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
  assert.match(svg, /M36 0h-6/);
});


test('historical library maintains one dated identity and independently scoped source geometry versions',()=>{
  const sources=readTerritorialSources();
  assert.ok(sources.length>=258,'Expected canonical and historical entities');
  const ids=new Set();
  for(const e of sources){
    assert.ok(!ids.has(e.entityId),e.entityId+' duplicated');
    ids.add(e.entityId);
    assert.equal(e.schemaVersion,2);
    assert.ok(Array.isArray(e.geometryVersions)&&e.geometryVersions.length>0,e.entityId);
    assert.ok(Object.values(LIBRARY_ENTITY_TYPES).includes(e.entityKind),e.entityId+': unsupported entity kind');
    const water=e.entityKind===LIBRARY_ENTITY_TYPES.RIVER||e.entityKind===LIBRARY_ENTITY_TYPES.LAKE;
    if(water){
      assert.equal(e.parentEntityId,'',e.entityId+': water objects have no territorial parent');
      assert.equal(e.instantiation.mode,'independent',e.entityId);
      assert.deepEqual(e.instantiation.countryUpdates,{},e.entityId+': water objects cannot replace countries');
    }
    for(const version of e.geometryVersions){
      for(const property of ['validFrom','validTo','certainty','sourceId'])
        assert.ok(Object.hasOwn(version,property),e.entityId+'/'+version.versionId+': '+property);
      const geometryTypes=e.entityKind===LIBRARY_ENTITY_TYPES.RIVER?['LineString','MultiLineString']:['Polygon','MultiPolygon'];
      assert.ok(geometryTypes.includes(version.geometry?.type),
        e.entityId+'/'+version.versionId+' geometry differs from its entity kind');
    }
  }
  assert.ok(ids.has('state:deutsche-demokratische-republik'));
  assert.ok(ids.has('state:north-schleswig'));
});

test('1989 DDR and 1900 North Schleswig retain provisional dates, identity and catalog source warnings',()=>{
  const data=new Map(readTerritorialSources().map(e=>[e.entityId,e]));
  const ddr=data.get('state:deutsche-demokratische-republik');
  assert.equal(ddr.names.ko,'독일 민주공화국');
  assert.equal(ddr.lifetime.validFrom,'1949-10-07');
  assert.equal(ddr.lifetime.validTo,'1990-10-02');
  assert.equal(ddr.metadata.referenceDate,'1989-04-25');
  assert.equal(ddr.instantiation.mode,'territory-replacement');
  assert.ok(ddr.geometryVersions.some(v=>v.certainty==='medium' && v.geometry.type==='MultiPolygon'));
  const north=data.get('state:north-schleswig');
  assert.equal(north.names.ko,'북슐레스비히');
  assert.equal(north.entityKind,'general');
  assert.equal(north.instantiation.mode,'territory-replacement');
  assert.equal(north.metadata.approximateGeometry,true);
  const historical=north.geometryVersions.find(v=>v.versionId==='north-schleswig-1900-r3');
  assert.ok(historical);
  assert.equal(historical.validFrom,'1900-01-01');
  assert.equal(historical.validTo,'1900-01-01');
  assert.equal(historical.geometry.type,'MultiPolygon');
});

test('territory replacements preserve historical versions in current countries without duplicate historic identities',()=>{
  const byId=new Map(readTerritorialSources().map(e=>[e.entityId,e]));
  for(const [id,versionId,start,end] of [
    ['state:IDN','state:indonesia:1945-2002-r1','1975-12-07','1999-10-24'],
    ['state:UKR','state:ukraine:1991-2014-r1','1991-08-24','2014-03-17'],
    ['state:SDN','state:sudan:1956-2011-r1','1956-01-01','2011-07-08'],
  ]){
    const e=byId.get(id);
    assert.ok(e,'Missing historical counterpart '+id);
    const version=e.geometryVersions.find(v=>v.versionId===versionId);
    assert.ok(version,'Historical version missing: '+versionId);
    assert.deepEqual([version.validFrom,version.validTo],[start,end]);
    assert.equal(version.instantiation.mode,'territory-replacement');
  }
  for(const retired of ['state:indonesia','state:ukraine','state:sudan'])
    assert.equal(byId.has(retired),false,retired+' must not duplicate an existing political identity');
});

test('Soviet constituent republics remain flagged political entities, not administrative layers',()=>{
  const children=readTerritorialSources().filter(e=>e.parentEntityId==='state:soviet-union');
  // 1922 founders include a separately recorded Transcaucasian predecessor:
  // do not freeze the old Python assumption of exactly 15 children.
  assert.ok(children.length>=15,'Canonical Soviet republic membership is incomplete');
  const ids=new Set();
  for(const child of children){
    assert.ok(!ids.has(child.entityId),'Repeated Soviet child identity');
    ids.add(child.entityId);
    assert.equal(child.entityKind,'general');
    assert.equal(Object.hasOwn(child,'adminLevel'),false);
    if(child.entityId === 'state:soviet-union-transcaucasian-sfsr') {
      // Do not invent an unapproved historical flag for the separately dated 1922 founder.
      assert.equal(child.metadata.defaultFlagDataUrl ?? '', '');
      assert.equal(child.lifetime.validFrom, '1922-12-30');
      assert.equal(child.lifetime.validTo, '1936-12-04');
      assert.equal(child.metadata.approximateGeometry, true);
    } else {
      assert.match(child.metadata.defaultFlagDataUrl||'',/^data:image\/svg\+xml;base64,/,
        child.entityId+': established SSR flag unexpectedly missing');
    }
  }
});

const polygon=right=>({type:'Polygon',coordinates:[[[0,0],[right,0],[right,1],[0,1],[0,0]]]});
const editedEntity=()=>({entityId:'state:Test',metadata:{geometrySha256:'metadata-old'},
  sourceInfo:{geometrySha256:'source-old',archive:'survey'},geometryVersions:[{
    versionId:'v1',validFrom:'1900-01-01',validTo:'1900-12-31',geometry:polygon(1),
    historicalProvenance:{evidenceStatus:'verified',verifiedHistoricalGeometry:true,
      independentPeriodScreenDeltaChecked:true,archive:'period-map'},
  }]});

test('unchanged library source keeps its verification and hashes',()=>{
  const previous=editedEntity();
  assert.deepEqual(markEditedLibrarySource(structuredClone(previous),previous),previous);
});

test('changed geometry downgrades verification and retains original source evidence',()=>{
  const previous=editedEntity(),draft=structuredClone(previous);
  draft.geometryVersions[0].geometry=polygon(1.1);
  const edited=markEditedLibrarySource(draft,previous,'user-map-editor');
  assert.equal(edited.geometryVersions[0].historicalProvenance.evidenceStatus,'provisional');
  assert.equal(edited.geometryVersions[0].historicalProvenance.verifiedHistoricalGeometry,false);
  assert.equal(edited.geometryVersions[0].historicalProvenance.independentPeriodScreenDeltaChecked,false);
  assert.equal(edited.geometryVersions[0].historicalProvenance.editMethod,'user-map-editor');
  assert.equal(edited.geometryVersions[0].historicalProvenance.archive,'period-map');
  assert.equal(edited.sourceInfo.archive,'survey');
  assert.equal(edited.sourceInfo.geometrySha256,undefined);
  assert.equal(edited.sourceInfo.originalSourceGeometrySha256,'source-old');
  assert.equal(edited.metadata.geometrySha256,undefined);
  assert.equal(edited.metadata.originalSourceGeometrySha256,'metadata-old');
  assert.equal(previous.geometryVersions[0].historicalProvenance.evidenceStatus,'verified');
});

test('period edits and new versions are provisional while unchanged versions stay verified',()=>{
  const previous=editedEntity();
  previous.geometryVersions.push({...structuredClone(previous.geometryVersions[0]),versionId:'v3',
    validFrom:'1901-01-01',validTo:'1901-12-31'});
  const draft=structuredClone(previous);
  draft.geometryVersions[0].validTo='1900-06-30';
  draft.geometryVersions.push({...structuredClone(previous.geometryVersions[0]),versionId:'v2',
    validFrom:'1900-07-01',validTo:'1900-12-31'});
  const edited=markEditedLibrarySource(draft,previous);
  assert.ok(edited.geometryVersions.filter(row=>row.versionId!=='v3')
    .every(row=>row.historicalProvenance.evidenceStatus==='provisional'
      && row.historicalProvenance.editMethod==='user-library-editor'));
  assert.equal(edited.geometryVersions.find(row=>row.versionId==='v3').historicalProvenance.evidenceStatus,'verified');
});

test('editing invalidates an inherited detail approval without discarding its evidence',()=>{const previous=editedEntity();previous.geometryVersions[0].historicalProvenance.displayDetailReview={status:'passed',geometrySha256:'original',master:{reference:'preserved-master'}};const draft=structuredClone(previous);draft.geometryVersions[0].geometry=polygon(2);const result=markEditedLibrarySource(draft,previous);assert.equal(result.geometryVersions[0].historicalProvenance.displayDetailReview.status,'stale');assert.equal(result.geometryVersions[0].historicalProvenance.displayDetailReview.geometrySha256,'original');assert.deepEqual(result.geometryVersions[0].historicalProvenance.displayDetailReview.master,{reference:'preserved-master'});assert.equal(previous.geometryVersions[0].historicalProvenance.displayDetailReview.status,'passed');});
