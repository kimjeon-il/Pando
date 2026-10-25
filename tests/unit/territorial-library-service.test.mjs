import assert from 'node:assert/strict';
import test from 'node:test';
import {createTerritorialLibraryService} from "../../apps/editor/frontend/js/modules/territorial-library-service.js";
import {selectGeometryVersion} from "../../apps/editor/frontend/js/modules/territorial-library.js";

const geometry = {type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]};
const entity = (entityId, parentEntityId = '', validTo = null) => ({
  schemaVersion:2,entityId,lineageId:'sample',entityKind:'general',names:{ko:entityId},alternateNames:[],parentEntityId,
  lifetime:{validFrom:null,validTo},
  geometryVersions:[{versionId:`${entityId}:v1`,validFrom:null,validTo,geometry,certainty:'high',sourceId:'fixture'}],
  metadata:{},sourceInfo:{},instantiation:{mode:'independent',countryUpdates:{}},
});
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function fixture({entities = [entity('state:parent'),entity('state:child','state:parent'),entity('state:expired','state:parent','1991-12-25')], snapshots = []} = {}) {
  let loads = 0, indexLoads = 0, todayCalls = 0;
  const cache = new Map();
  const originals = freeze(structuredClone(entities));
  const index = freeze({
    schemaVersion:2,
    lineages:[{lineageId:'sample',names:{ko:'계보',en:'Sample lineage'},entityRefs:entities.map(e=>e.entityId),relations:[]}],
    entities:entities.map(e=>({...e,geometryVersions:e.geometryVersions.map(({geometry,...v})=>v)})),
    snapshots,
  });
  const loader = {
    loadIndex:async()=>{indexLoads++;return index;},
    loadEntity:async id=>{loads++;const e=originals.find(e=>e.entityId===id);cache.set(id,e);return e;},
    peek:id=>cache.get(id)||null,
  };
  return {
    service:createTerritorialLibraryService({loader,today:()=>{todayCalls++;return '2026-10-06';}}),
    loads:()=>loads,indexLoads:()=>indexLoads,todayCalls:()=>todayCalls,index,originals,
  };
}
const rows = groups => groups.flatMap(group=>group.entities);
const ids = groups => rows(groups).map(e=>e.entityId);

// Removing first-day expansion or replacing the shared parser breaks these boundaries.
test('UI normalization keeps blank, first-day, BCE and extended-year semantics separate from the shared selector', () => {
  const {service} = fixture();
  assert.equal(typeof service.normalizeReferenceDate, 'function');
  for (const blank of [null,undefined,'',' \t ']) assert.equal(service.normalizeReferenceDate(blank), null);
  for (const [input,expected] of [
    [' 1950 ', '1950-01-01'], ['1989-04','1989-04-01'], ['2000-02-29','2000-02-29'],
    ['-0044','-0044-01-01'], ['-0001-12','-0001-12-01'], ['+010000','+010000-01-01'], ['+123456-07','+123456-07-01'],
  ]) assert.equal(service.normalizeReferenceDate(input), expected);
  for (const input of ['0000','-0000','+0000','1900-02-29','1989-13','1989-04-00','1989-04-31','10000','not-a-date']) {
    assert.throws(()=>service.normalizeReferenceDate(input), {code:'PL-TEMPORAL-001'});
  }
});

test('blank browsing keeps every identity, name alias and catalog order without choosing geometry or today', async () => {
  const sibling = entity('state:sibling');
  sibling.names = {ko:'동시 국가',en:'Concurrent entity'};
  sibling.alternateNames = ['Former alias'];
  const f = fixture({entities:[entity('state:parent'),sibling,entity('state:expired','','1991-12-25')]});
  const [a,b] = await Promise.all([f.service.load(),f.service.load()]);
  assert.equal(a,b);assert.equal(f.indexLoads(),1);
  for (const date of [null,'','  ']) {
    const result = f.service.search({referenceDate:date});
    assert.deepEqual(ids(result), ['state:parent','state:sibling','state:expired']);
    assert.deepEqual(rows(result).map(e=>e.selectedVersionId), [null,null,null]);
  }
  assert.deepEqual(ids(f.service.search()), ['state:parent','state:sibling','state:expired']);
  assert.deepEqual(ids(f.service.search({query:' FORMER ALIAS '})), ['state:sibling']);
  assert.deepEqual(ids(f.service.search({query:'concurrent'})), ['state:sibling']);
  assert.deepEqual(ids(f.service.search({query:'계보'})), ['state:parent','state:sibling','state:expired']);
  assert.deepEqual(ids(f.service.search({query:'missing'})), []);
  assert.equal(f.loads(),0);assert.equal(f.todayCalls(),0);
});

test('dated search distinguishes availability, gaps, explicit absence and unknown lifetimes', async () => {
  const unknown = entity('state:unknown');
  unknown.geometryVersions[0].validFrom='2000';
  const started = entity('state:started');started.lifetime.validFrom='1950';
  const ended = entity('state:ended','','1950');
  const gap = entity('state:gap','','1990-10-02');
  gap.lifetime.validFrom='1949-10-07';
  gap.geometryVersions[0].validFrom='1989-04-25';gap.geometryVersions[0].validTo='1989-04-25';
  const f = fixture({entities:[unknown,started,ended,gap]});await f.service.load();
  const statuses=date=>rows(f.service.search({referenceDate:date})).map(row=>row.sourceAvailability);
  assert.deepEqual(ids(f.service.search({referenceDate:'1950-01-01'})), ['state:unknown','state:started','state:ended','state:gap']);
  assert.deepEqual(statuses('1950-01-01'),['unknown','available','available','geometry-gap']);
  assert.deepEqual(statuses('1950-12-31'),['unknown','available','available','geometry-gap']);
  assert.deepEqual(statuses('1949-01-01'),['unknown','absent','available','absent']);
  assert.deepEqual(statuses('1990-10-02'),['unknown','available','absent','geometry-gap']);
  assert.deepEqual(statuses('1990-10-03'),['unknown','available','absent','absent']);
  const gapRow = rows(f.service.search({query:'gap',referenceDate:'1970'}))[0];
  assert.equal(gapRow.selectedVersionId,null);
  assert.equal(gapRow.sourceAvailability,'geometry-gap');
  assert.equal(rows(f.service.search({query:'gap',referenceDate:'1989-04-25'}))[0].selectedVersionId,'state:gap:v1');
  assert.throws(()=>f.service.search({referenceDate:'0000'}), {code:'PL-TEMPORAL-001'});
  assert.throws(()=>f.service.search({referenceDate:'invalid'}), {code:'PL-TEMPORAL-001'});
  assert.equal(f.loads(),0);assert.equal(f.todayCalls(),0);
  assert.deepEqual(f.service.get('state:ended').lifetime, {validFrom:null,validTo:'1950'});
});

test('direct coarse search and descriptor APIs retain period-end selection while UI dates select day one', async () => {
  const history = entity('state:history');history.lifetime.validFrom='1900';
  history.geometryVersions = [
    {...history.geometryVersions[0],versionId:'history:early',validFrom:'1900',validTo:'1953-07-26',},
    {...history.geometryVersions[0],versionId:'history:late',validFrom:'1953-07-27',validTo:null,},
  ];
  const f = fixture({entities:[history]});await f.service.load();
  for (const raw of ['1953','1953-07']) {
    assert.equal(selectGeometryVersion(history,raw).versionId,'history:late');
    assert.equal(rows(f.service.search({referenceDate:raw}))[0].selectedVersionId,'history:late');
    const direct = (await f.service.instantiateDescriptors(['state:history'],raw))[0];
    assert.equal(direct.geometryVersionId,'history:late');assert.equal(direct.metadata.sourceReferenceDate,raw);
    const date = f.service.normalizeReferenceDate(raw);
    assert.equal(rows(f.service.search({referenceDate:date}))[0].selectedVersionId,'history:early');
    const ui = (await f.service.instantiateDescriptors(['state:history'],date))[0];
    assert.equal(ui.geometryVersionId,'history:early');assert.equal(ui.metadata.sourceReferenceDate,date);
    assert.deepEqual(ui.metadata.sourceGeometryValidity,{validFrom:'1900',validTo:'1953-07-26'});
    assert.equal(Object.hasOwn(ui.metadata,'geometryDatePrecision'),false);
  }
});

test('descriptors lazily load requested alive descendants without runtime current/historical synthesis',async()=>{
  const f=fixture();await f.service.load();const items=await f.service.instantiateDescriptors(['state:parent'],'1991','all');
  assert.deepEqual(items.map(i=>i.entityId),['state:parent','state:child']);assert.equal(items[1].parentEntityId,'state:parent');assert.deepEqual(items[1].geometry,geometry);assert.equal(f.loads(),2);
});
test('failed catalog loading can retry',async()=>{
  let n=0;const service=createTerritorialLibraryService({loader:{loadIndex:async()=>{if(!n++)throw new Error('offline');return {schemaVersion:2,lineages:[],entities:[],snapshots:[]};},loadEntity:async()=>null,peek:()=>null}});
  await assert.rejects(service.load(),/offline/);await service.load();assert.equal(n,2);
});
test('missing reference date and geometry gaps never instantiate a nearest or overridden version',async()=>{
  const f=fixture();await f.service.load();
  await assert.rejects(f.service.instantiateDescriptors(['state:parent'],''),/representative|required/i);
  await assert.rejects(f.service.instantiateDescriptors(['state:expired'],'2026'),/경계/);
  const result=await f.service.instantiateDescriptors(['state:expired'],'1990');
  assert.equal(result[0].validFrom,null);assert.equal(result[0].validTo,null);
  assert.deepEqual(result[0].metadata.sourceLifetime,{validFrom:null,validTo:'1991-12-25'});
  assert.equal(result[0].metadata.sourceReferenceDate,'1990');
});

function datedEntity(entityId = 'state:history') {
  const value = entity(entityId);
  value.lifetime = {validFrom:'1900',validTo:null};
  value.geometryVersions = [
    {...value.geometryVersions[0],versionId:`${entityId}:early`,validFrom:'1900',validTo:'1953-07-26',},
    {...value.geometryVersions[0],versionId:`${entityId}:late`,validFrom:'1953-07-27',validTo:'2000-12-31',},
    {...value.geometryVersions[0],versionId:`${entityId}:recent`,validFrom:'2001',validTo:null,},
  ];
  return value;
}
const snapshot = (id, referenceDate, entityRefs) => ({schemaVersion:1,id,referenceDate,entityRefs});

test('nonblank resolution passes the exact cursor to the shared selector and never falls back across a gap', async () => {
  const value = datedEntity();value.metadata.referenceDate='2001';
  value.geometryVersions[1].validTo='1990';
  const f=fixture({entities:[value]});await f.service.load();
  assert.equal(typeof f.service.resolveSelection,'function');
  for (const cursor of ['1953','1953-07',' 1953-07 ','1953-07-01','1953-07-27']) {
    assert.deepEqual(f.service.resolveSelection(value.entityId,cursor), {
      entityId:value.entityId,geometryVersionId:selectGeometryVersion(value,cursor).versionId,
      referenceDate:cursor,mode:'date',basis:'input',sourceDate:cursor,
    });
  }
  for (const cursor of ['1899','1991-01-01']) assert.equal(f.service.resolveSelection(value.entityId,cursor),null);
  assert.equal(f.service.resolveSelection('state:missing','2001-01-01'),null);
  assert.throws(()=>f.service.resolveSelection(value.entityId,'0000'), {code:'PL-TEMPORAL-001'});
  assert.equal(f.loads(),0);assert.equal(f.todayCalls(),0);
});

test('representatives select only the explicit version, keep dates as provenance, and import independent geometry',async()=>{
 const value=datedEntity();value.metadata.referenceDate='1953-07';value.metadata.representativeGeometryVersionId=value.geometryVersions[0].versionId;
 const f=fixture({entities:[value],snapshots:[snapshot('newer','2026-10-06',[value.entityId])]});await f.service.load();
 for(const blank of [null,'','  '])assert.deepEqual(f.service.resolveSelection(value.entityId,blank),{
  entityId:value.entityId,geometryVersionId:value.geometryVersions[0].versionId,referenceDate:null,mode:'representative',basis:'version',sourceDate:null});
 const descriptor=(await f.service.instantiateDescriptors([value.entityId],null))[0];
 assert.equal(descriptor.metadata.sourceReferenceDate,null);assert.equal(descriptor.metadata.referenceDate,'1953-07');
 assert.deepEqual(descriptor.metadata.sourceGeometryValidity,{validFrom:'1900',validTo:'1953-07-26'});
 assert.notEqual(descriptor.geometry,f.originals[0].geometryVersions[0].geometry);
 assert.equal(f.todayCalls(),0);
});
test('a missing representative is never guessed from snapshots, date metadata or version order',async()=>{
 const value=datedEntity();value.metadata.referenceDate='1953-07';
 const f=fixture({entities:[value],snapshots:[snapshot('pilot','1991',[value.entityId])]});await f.service.load();
 assert.equal(f.service.resolveSelection(value.entityId,null),null);
 assert.equal(f.service.resolveSelection(value.entityId,'1991').geometryVersionId,value.geometryVersions[1].versionId);
 const malformed={...value,metadata:{representativeGeometryVersionId:'missing'}};
 const other=fixture({entities:[malformed]});await other.service.load();
 assert.throws(()=>other.service.resolveSelection(value.entityId,null),/Missing representative/);
});
test('unknown lifetimes and undated representative imports do not acquire the current date',async()=>{
 const value=entity('state:current');value.metadata.representativeGeometryVersionId=value.geometryVersions[0].versionId;
 const f=fixture({entities:[value]});await f.service.load();
 const descriptor=(await f.service.instantiateDescriptors([value.entityId],null))[0];
 assert.deepEqual(descriptor.metadata.sourceLifetime,{validFrom:null,validTo:null});assert.equal(descriptor.metadata.sourceReferenceDate,null);
 assert.equal(f.todayCalls(),0);
});

test('events use only existing lifetime endpoints and explicit dissolution metadata, independently of the date filter', async () => {
  const gdr=entity('state:gdr','','1990-10-02');
  gdr.names={ko:'독일 민주 공화국',en:'German Democratic Republic'};
  gdr.alternateNames=['GDR'];gdr.lifetime.validFrom='1949-10-07';
  gdr.metadata={referenceDate:'1989-04-25',dissolutionDate:'1990-10-03'};
  gdr.geometryVersions[0].validFrom='1989-04-25';gdr.geometryVersions[0].validTo='1989-04-25';
  const unknown=entity('state:unknown');unknown.metadata={referenceDate:'2001',defaultFlagDataUrl:'data:image/svg+xml,fixture'};
  unknown.geometryVersions[0].validFrom='2001';
  const f=fixture({entities:[gdr,unknown],snapshots:[snapshot('current','2026-10-06',[unknown.entityId])]});await f.service.load();
  assert.equal(typeof f.service.events,'function');
  const before=JSON.stringify(f.index);
  assert.equal(f.service.search({query:'GDR',referenceDate:'1990-10-03'})[0].entities[0].sourceAvailability,'absent');
  const events=f.service.events({query:' gdr '});
  assert.deepEqual(events.map(({entityId,date,name})=>({entityId,date,name})),[
    {entityId:gdr.entityId,date:'1949-10-07',name:'독일 민주 공화국 · 기록 시작'},
    {entityId:gdr.entityId,date:'1990-10-02',name:'독일 민주 공화국 · 기록 마지막 시점'},
    {entityId:gdr.entityId,date:'1990-10-03',name:'독일 민주 공화국 · 해체'},
  ]);
  assert.deepEqual(f.service.events({query:'계보'}),events);
  assert.deepEqual(f.service.events({query:'german democratic'}),events);
  assert.deepEqual(f.service.events({query:'unknown'}),[]);
  assert.deepEqual(f.service.events({query:'missing'}),[]);
  assert.equal(f.service.normalizeReferenceDate(events[2].date),'1990-10-03');
  assert.equal(f.loads(),0);assert.equal(f.todayCalls(),0);
  assert.equal(JSON.stringify(f.index),before);
});

test('event identities retain different source fields sharing the same date and remain stable across catalog order', async () => {
  const north=entity('state:north','','1920-06-15');north.names={ko:'북슐레스비히'};north.lifetime.validFrom='1920-06-15';
  north.metadata.dissolutionDate='1920-06-15';
  const other=entity('state:other','','1920-06-15');other.names={en:'Other'};
  const a=fixture({entities:[north,other]}),b=fixture({entities:[other,north]});await a.service.load();await b.service.load();
  const events=a.service.events();
  assert.equal(events.length,4);assert.equal(new Set(events.map(event=>event.id)).size,4);
  assert.deepEqual(events,b.service.events());assert.deepEqual(a.service.events(),events);
  assert.deepEqual(events.filter(event=>event.entityId===north.entityId).map(event=>event.name),[
    '북슐레스비히 · 기록 시작','북슐레스비히 · 기록 마지막 시점','북슐레스비히 · 해체',
  ]);
  assert.equal(events.find(event=>event.entityId===other.entityId).name,'Other · 기록 마지막 시점');
  for (const event of events) {
    assert.ok(event.id.includes(event.entityId));assert.ok(event.id.includes(event.date));
    assert.match(event.id,/lifetime\.validFrom|lifetime\.validTo|metadata\.dissolutionDate/);
  }
});

test('events preserve original precision and sort BCE, CE and signed extended dates chronologically', async () => {
  const entities=[['state:extended','+010000'],['state:month','1991-03'],['state:bce','-0044'],['state:ce','0001'],['state:last-bce','-0001'],['state:year','1991']]
    .map(([id,date])=>{const value=entity(id);value.lifetime.validFrom=date;return value;});
  const f=fixture({entities});await f.service.load();
  const events=f.service.events();
  assert.deepEqual(events.map(event=>event.date),['-0044','-0001','0001','1991','1991-03','+010000']);
  assert.deepEqual(events.map(event=>f.service.normalizeReferenceDate(event.date)),[
    '-0044-01-01','-0001-01-01','0001-01-01','1991-01-01','1991-03-01','+010000-01-01',
  ]);
  assert.equal(f.loads(),0);
});

test('malformed optional dissolution dates do not suppress valid lifetime events or other entities', async t => {
  const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(args));
  const invalid=entity('state:invalid','','1950');invalid.metadata.dissolutionDate='1950-02-30';
  const numeric=entity('state:numeric');numeric.metadata.dissolutionDate=1991;
  const valid=entity('state:valid');valid.metadata.dissolutionDate='1991';
  const f=fixture({entities:[invalid,numeric,valid]});await f.service.load();
  assert.deepEqual(f.service.events().map(event=>[event.entityId,event.date]),[['state:invalid','1950'],['state:valid','1991']]);
  assert.equal(warnings.length,2);
  for (const warning of warnings) {assert.match(warning[0],/state:(invalid|numeric).*metadata\.dissolutionDate/);assert.ok(warning[1] instanceof Error);}
});

test('undated representative descendants stay independent of explicit dated traversal', async () => {
  const root=entity('state:root');root.metadata.referenceDate='1991';root.metadata.representativeGeometryVersionId=root.geometryVersions[0].versionId;
  const child=entity('state:child',root.entityId);
  const grandchild=entity('state:grandchild',child.entityId);
  const later=entity('state:later',root.entityId);later.lifetime.validFrom='1991-07-01';
  for(const e of [child,grandchild,later])e.metadata.representativeGeometryVersionId=e.geometryVersions[0].versionId;
  const f=fixture({entities:[root,child,grandchild,later]});await f.service.load();
  const selection=f.service.resolveSelection(root.entityId,null);
  assert.equal(selection.referenceDate,null);
  assert.deepEqual(f.service.entityRefsWithChildren([root.entityId],'none',selection.referenceDate),[root.entityId]);
  assert.deepEqual(f.service.entityRefsWithChildren([root.entityId],'level1',selection.referenceDate),[root.entityId,child.entityId,later.entityId]);
  assert.deepEqual(f.service.entityRefsWithChildren([root.entityId],'all',selection.referenceDate),[root.entityId,child.entityId,later.entityId,grandchild.entityId]);
  const descriptors=await f.service.instantiateDescriptors([root.entityId],selection.referenceDate,'all');
  assert.deepEqual(descriptors.map(item=>item.entityId),[root.entityId,child.entityId,later.entityId,grandchild.entityId]);
  assert.deepEqual(descriptors.map(item=>item.metadata.sourceReferenceDate),[null,null,null,null]);
  assert.equal(descriptors[0].geometryVersionId,selection.geometryVersionId);
  assert.ok(f.service.entityRefsWithChildren([root.entityId],'all','1991').includes(later.entityId));
  assert.equal(f.todayCalls(),0);
});
