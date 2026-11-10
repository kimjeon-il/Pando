import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mapProjectCatalogSpec,createMapProjectRuntime} from '../../../src/data/map-project-runtime.js';

const manifest=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url),'utf8'));
const encoded=value=>Buffer.from(JSON.stringify(value),'utf8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const land={schema:'pando-physical-land-v3',sourceSha256:'b'.repeat(64),
 asset:{url:'assets/data/land/asset.bin',sha256:'c'.repeat(64),compressedBytes:100,decodedBytes:150,encoding:'gzip'},
 waterObjects:{identities:[],geometries:[],timelineRecords:{schemaVersion:3,
  lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]}}};

function fixture({catalog=land,alteredCatalogPath=null,corrupt=false}={}){
 const project=structuredClone(manifest);
 if(alteredCatalogPath)project.resources.physicalLand.catalog=alteredCatalogPath;
 const bytes=encoded(catalog),path=project.resources.physicalLand.catalog;
 const meta={mapProject:project,dataRevision:'data-'+('c'.repeat(32)),
  projectCatalogs:{physicalLand:{catalog:path,sha256:sha(bytes),bytes:bytes.length}}};
 const calls=[];
 const fetchFn=async url=>{
  calls.push(new URL(url).pathname);
  const delivered=Buffer.from(bytes);
  if(corrupt)delivered[delivered.length-2]^=1; // Same length, different SHA-256.
  return new Response(delivered,{status:200});
 };
 return {meta,fetchFn,calls,bytes};
}

test('runtime resolves the physical land and dated water catalog from the active project role',async()=>{
 const f=fixture({alteredCatalogPath:'assets/data/physical-land/alternate/manifest.json'});
 const runtime=createMapProjectRuntime({meta:f.meta,assetBaseUrl:new URL('https://example.test/assets/js/'),
  fetchFn:f.fetchFn,cacheStorage:null});
 const spec=runtime.catalogSpec('physicalLand');
 assert.equal(spec.url,'assets/data/physical-land/alternate/manifest.json');
 assert.equal(spec.sha256,sha(f.bytes));
 const one=await runtime.hydratePhysicalMetadata();
 assert.deepEqual(one.physicalLand,land.asset);
 assert.deepEqual(one.physicalWaterObjects,land.waterObjects);
 const second=await runtime.hydratePhysicalMetadata();
 assert.equal(one.physicalLand,second.physicalLand,'one verified catalog object is reused');
 assert.deepEqual(f.calls,['/assets/data/physical-land/alternate/manifest.json']);
});

test('catalog integrity fails closed before renderer receives unverified sources',async()=>{
 const f=fixture({corrupt:true});
 const runtime=createMapProjectRuntime({meta:f.meta,assetBaseUrl:new URL('https://example.test/assets/js/'),
  fetchFn:f.fetchFn,cacheStorage:null});
 await assert.rejects(runtime.hydratePhysicalMetadata(),/무결성|integrity|SHA|hash/i);
 const wrong={...f.meta,projectCatalogs:{...f.meta.projectCatalogs,
  physicalLand:{...f.meta.projectCatalogs.physicalLand,catalog:'assets/data/foreign/manifest.json'}}};
 assert.throws(()=>mapProjectCatalogSpec(wrong,'physicalLand'),/receipt/);
 assert.throws(()=>mapProjectCatalogSpec(f.meta,'invented'),/Unknown map resource/);
});

test('published catalogs use no old Viewer-wide resource spec fields',()=>{
 const f=fixture();
 assert.ok(!Object.hasOwn(f.meta,'physicalLand'));
 assert.ok(!Object.hasOwn(f.meta,'worldBundle'));
 assert.equal(mapProjectCatalogSpec(f.meta,'physicalLand').decodedBytes,f.bytes.length);
});

test('published project manifest is authenticated before any catalog is selected',async()=>{
 const f=fixture(),manifestBytes=encoded(f.meta.mapProject);
 f.meta.mapProjectManifest={url:'assets/data/projects/default-world/manifest.json',
  encoding:'identity',compressedBytes:manifestBytes.length,decodedBytes:manifestBytes.length,
  sha256:sha(manifestBytes)};
 const calls=[];
 const runtime=createMapProjectRuntime({meta:f.meta,
  assetBaseUrl:new URL('https://example.test/assets/js/'),cacheStorage:null,
  fetchFn:async url=>{
   const path=new URL(url).pathname;calls.push(path);
   return new Response(path.endsWith('/projects/default-world/manifest.json')
     ?manifestBytes:f.bytes,{status:200});
  }});
 await runtime.hydratePhysicalMetadata();
 assert.deepEqual(calls,['/assets/data/projects/default-world/manifest.json',
  '/assets/data/physical-land/v1/manifest.json']);
 assert.equal(runtime.project.projectId,'default-world');
 const corrupted=createMapProjectRuntime({meta:f.meta,
  assetBaseUrl:new URL('https://example.test/assets/js/'),cacheStorage:null,
  fetchFn:async url=>new Response(new URL(url).pathname.includes('/projects/')
    ?Buffer.from(manifestBytes.toString().replace('default-world','altered-world')):f.bytes,
    {status:200})});
 await assert.rejects(corrupted.hydratePhysicalMetadata(),/무결성|hash|SHA|integrity/i);
});
