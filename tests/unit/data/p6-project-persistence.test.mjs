import test from 'node:test';
import assert from 'node:assert/strict';
import { applyImportedPackageAssets, validateImportedProjectPackage } from "../../../src/data/project-package-assets.js";
import { createBrowserProjectStorage } from "../../../src/data/browser-project-storage.js";

const flagBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
const flag = `data:image/svg+xml;base64,${flagBytes}`;
const project = () => ({
  format: 'pandolab-project-state', schemaVersion: 14, documentId: 'unchanged-project-id',
  sourceInfo: { sourceVersion: 'pinned-v1', nested: { original: 'retained', accuracy: 1.2345678901234567 } },
  territorialEntities: [{ type: 'Feature', id: 'A', geometry: null,
    properties: { entityKind: 'general', sourceEntityId: 'lib-country:A', sourceGeometryVersion: 'v2',
      metadata: { libraryOrigin: { sourceVersion: 'pinned-v1', libraryId: 'lib-A' } } } }],
  geometries: [{id:'geometry-A',version:2,geojson:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}],
  timelineRecords: { schemaVersion: 1, geometryBindings: [{id:'binding-A',objectRef:{domain:'territorial',id:'A'},geometryRef:{id:'geometry-A',version:2}}] },
});
const imported = (value=project(), overrides={}) => ({projectState:value,sourceInfo:structuredClone(value.sourceInfo),countryAssets:[],...overrides});

test('P6 current GPKG envelope keeps canonical document ID, archive, precise source and library references', () => {
  const doc = project(),before = structuredClone(doc);
  const metadata=imported(doc,{sourceInfo:{nested:{accuracy:1.2345678901234567,original:'retained'},sourceVersion:'pinned-v1'}});
  const validated = validateImportedProjectPackage(metadata);
  assert.strictEqual(validated,doc);
  assert.strictEqual(applyImportedPackageAssets(metadata,validated.territorialEntities),doc.territorialEntities);
  assert.deepEqual(doc,before);
  assert.equal(doc.territorialEntities[0].properties.sourceGeometryVersion,'v2');
  assert.equal(doc.territorialEntities[0].properties.metadata.libraryOrigin.sourceVersion,'pinned-v1');
});

test('P6 rejects missing, obsolete or non-file GPKG projects without migration or an invented identity', () => {
  assert.throws(()=>validateImportedProjectPackage({projectState:null}),{code:'PL-GPKG-PROJECT'});
  for(const changes of [{schemaVersion:13},{schemaVersion:15},{format:'pandolab-autosave-full'}])
    assert.throws(()=>validateImportedProjectPackage(imported({...project(),...changes})),{code:'PL-GPKG-VERSION'});
  for(const changes of [{documentId:''},{territorialEntities:null}])
    assert.throws(()=>validateImportedProjectPackage(imported({...project(),...changes})),{code:'PL-GPKG-PROJECT'});
});

test('P6 optional sidecar provenance cannot silently override the JSON owner', () => {
  const doc=project();
  assert.throws(()=>validateImportedProjectPackage(imported(doc,{sourceInfo:{sourceVersion:'other'}})),
    {code:'PL-GPKG-SOURCE-MISMATCH'});
  assert.equal(validateImportedProjectPackage({...imported(doc),sourceInfo:null}),doc);
  const empty={...project(),sourceInfo:null};
  assert.equal(validateImportedProjectPackage(imported(empty,{sourceInfo:{}})),empty,
    'the canonical writer materializes null sourceInfo as an empty informational table');
});

test('P6 flag sidecar restores only a missing canonical flag, never mutating its project or source refs', () => {
  const doc=project(),before=structuredClone(doc);
  const metadata=imported(doc,{countryAssets:[{countryId:'A',mimeType:'image/svg+xml',base64:flagBytes}]});
  const restored=applyImportedPackageAssets(metadata,validateImportedProjectPackage(metadata).territorialEntities);
  assert.equal(restored[0].properties.metadata.flagDataUrl,flag);
  assert.equal(restored[0].properties.sourceGeometryVersion,'v2');
  assert.deepEqual(doc,before);
  assert.notStrictEqual(restored[0],doc.territorialEntities[0]);
  assert.strictEqual(restored[0].properties.metadata.libraryOrigin,doc.territorialEntities[0].properties.metadata.libraryOrigin);
});

test('P6 duplicate matching flags are idempotent; conflicting canonical flags fail closed', () => {
  const doc=project();doc.territorialEntities[0].properties.metadata.flagDataUrl=flag;
  const sidecars={countryAssets:[{countryId:'A',mimeType:'image/svg+xml',base64:flagBytes}]};
  assert.strictEqual(applyImportedPackageAssets(sidecars,doc.territorialEntities)[0],doc.territorialEntities[0]);
  doc.territorialEntities[0].properties.metadata.flagDataUrl='data:image/png;base64,YWJjZA==';
  assert.throws(()=>applyImportedPackageAssets(sidecars,doc.territorialEntities),{code:'PL-GPKG-ASSET-CONFLICT'});
  assert.equal(doc.territorialEntities[0].properties.metadata.flagDataUrl,'data:image/png;base64,YWJjZA==');
});

test('P6 invalid, duplicated, orphan or non-general flag sidecars reject before publication', () => {
  const doc=project(),asset={countryId:'A',mimeType:'image/svg+xml',base64:flagBytes};
  for(const countryAssets of [
    [asset,asset], [{...asset,countryId:'missing'}], [{...asset,base64:'not base64'}],
    [{...asset,mimeType:'image/svg+xml;bad=1'}], [{...asset,countryId:''}],
  ])assert.throws(()=>applyImportedPackageAssets({countryAssets},doc.territorialEntities));
  doc.territorialEntities[0].properties.entityKind='regional';
  assert.throws(()=>applyImportedPackageAssets({countryAssets:[asset]},doc.territorialEntities),
    {code:'PL-GPKG-ASSET-ORPHAN'});
});

function fakeIndexedDb() {
  const records=new Map();let opens=0;
  const database={objectStoreNames:{contains:()=>true},transaction(){
    const transaction={oncomplete:null,onerror:null,onabort:null,objectStore:()=>({
      get(key){const request={result:structuredClone(records.get(key))};queueMicrotask(()=>transaction.oncomplete?.());return request;},
      put(value,key){records.set(key,structuredClone(value));queueMicrotask(()=>transaction.oncomplete?.());},
    })};return transaction;
  }};
  return {records,get opens(){return opens;},indexedDB:{open(){opens++;const request={result:database};queueMicrotask(()=>request.onsuccess?.());return request;}}};
}

test('P6 IndexedDB viewing state is scoped to document ID and rejects a stale cross-project record',async()=>{
  const database=fakeIndexedDb(),store=createBrowserProjectStorage({productMode:'viewer',indexedDB:database.indexedDB,
    databaseName:'fixture',storeName:'views',viewKey:'project-view'});
  const first={documentId:'A',viewingPresentation:{layerVisibility:{rivers:false}}};
  const second={documentId:'B',viewingPresentation:{layerVisibility:{rivers:true}}};
  await store.writeView(first);await store.writeView(second);
  assert.deepEqual(await store.readView('A'),first);
  assert.deepEqual(await store.readView('B'),second);
  assert.equal(await store.readView('C'),null);
  database.records.set('project-view:A',second);
  assert.equal(await store.readView('A'),null);
  assert.equal(database.opens,1,'reopen uses the existing database and retains schema version 2');
  assert.throws(()=>store.writeView({documentId:''}),/documentId/);
  await assert.rejects(store.readView(''),/documentId/);
});
