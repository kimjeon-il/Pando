import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync,gzipSync} from 'node:zlib';
import {buildPreparedPolygonMeshes} from '../../tools/build-prepared-polygon-mesh.mjs';
import {decodePolygonMesh,POLYGON_MESH_FORMAT_VERSION} from '../../shared/frontend/js/modules/polygon-mesh-codec.js';
import {polygonGeometryDigest} from '../../shared/frontend/js/modules/prepared-polygon-mesh.js';
import {composePhysicalWaterGeometry} from '../../shared/frontend/js/modules/physical-resources.js';
import {buildBuiltinWorldPublication} from '../../tools/build-builtin-world.mjs';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../helpers/builtin-world.mjs';

test('physical month generation reads only the selected context, appends two meshes and preserves the existing catalog',async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'pando-physical-scope-'));
  t.after(()=>{assert.ok(root.startsWith(resolve(tmpdir(),'pando-physical-scope-')));rmSync(root,{recursive:true});});
  const write=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);};
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const asset=(name,value)=>{const url='assets/data/'+name+'.json',body=Buffer.from(JSON.stringify(value));write(resolve(root,url),body);return {url,sha256:sha(body),compressedBytes:body.length,decodedBytes:body.length,encoding:'identity'};};
  const box=x=>({type:'Polygon',coordinates:[[[x,0],[x,2],[x+2,2],[x+2,0],[x,0]]]});
  const landGeometry={type:'MultiPolygon',coordinates:[box(0).coordinates]},land=asset('land-history',landGeometry);
  const waters=[box(4),box(8)],rows=['aral','caspian'].map((id,index)=>({objectRef:{domain:'hydroBuiltin',id},geometryRef:{id,version:1},land,asset:asset(id,waters[index])}));
  const catalog={identities:rows.map(({objectRef})=>({objectRef,entityKind:'lake'})),geometries:rows,
    timelineRecords:{schemaVersion:3,parentRelations:[],propertyBindings:[],lifetimes:rows.map(({objectRef})=>({id:'life:'+objectRef.id,objectRef,validFrom:null,validTo:null})),
      geometryBindings:rows.map(({objectRef,geometryRef})=>({id:'geometry:'+objectRef.id,objectRef,geometryRef,validFrom:'1922-01-01',validTo:'1929-12-31'}))}};
  // No country index, unrelated physical source, or C++ checkout is present.
  write(resolve(root,'assets/data/physical-land/v1/manifest.json'),JSON.stringify({waterObjects:catalog}));
  const path=resolve(root,'assets/data/prepared-polygons/generated/v2/manifest.json'),engine=globalThis.PandoLabGpuMeshCore;
  const preserved={url:'assets/data/unhydrated-existing-mesh.bin.gz',sha256:'existing',compressedBytes:123};
  const original={schema:'pandolab-prepared-polygon-meshes',schemaVersion:2,meshFormatVersion:POLYGON_MESH_FORMAT_VERSION,
    algorithmVersion:engine.MESH_ALGORITHM_REVISION,maxEdgeDegrees:engine.MAX_RENDER_EDGE_DEGREES,
    algorithmSourceSha256:'prior-unrelated-core',inputHashes:{original:'identity'},precisionDiscards:[{id:'preserved'}],meshes:{existing:preserved}};
  write(path,JSON.stringify(original));
  const options={root,physicalMonth:'1922-12',write,sourceIdentity:()=>({sourceSha256:'current-core'})};
  assert.throws(()=>buildPreparedPolygonMeshes({...options,physicalMonth:''}),/month|required|날짜|시점/i,'an empty scoped option must never start full generation');
  const first=buildPreparedPolygonMeshes(options),expected=[await polygonGeometryDigest(landGeometry),await polygonGeometryDigest(composePhysicalWaterGeometry(waters))].sort();
  assert.deepEqual(first.selectedDigests.sort(),expected);assert.equal(first.count,2);assert.equal(first.reused,0);
  assert.deepEqual(first.manifest.meshes.existing,preserved);assert.deepEqual(first.manifest.precisionDiscards,original.precisionDiscards);
  assert.equal(first.manifest.inputHashes.original,'identity');assert.equal(Object.keys(first.manifest.meshes).length,3);
  assert.equal(existsSync(resolve(root,preserved.url)),false,'scope must not hydrate existing unrelated assets');
  for(const digest of expected){const spec=first.manifest.meshes[digest],stored=readFileSync(resolve(root,spec.url));assert.equal(sha(stored),spec.sha256);const decoded=gunzipSync(stored);decodePolygonMesh(decoded.buffer.slice(decoded.byteOffset,decoded.byteOffset+decoded.byteLength),{algorithmVersion:engine.MESH_ALGORITHM_REVISION});}
  const second=buildPreparedPolygonMeshes(options);assert.equal(second.reused,2);assert.deepEqual(second.manifest.meshes,first.manifest.meshes);
  write(path,JSON.stringify({...first.manifest,algorithmVersion:'obsolete'}));
  assert.throws(()=>buildPreparedPolygonMeshes(options),/current mesh algorithm/);
});

test('unscoped generation retains precision-discard audit records from synthetic territorial scopes',t=>{
  const root=mkdtempSync(resolve(tmpdir(),'pando-physical-scope-'));
  t.after(()=>{assert.ok(root.startsWith(resolve(tmpdir(),'pando-physical-scope-')));rmSync(root,{recursive:true});});
  const write=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);};
  const data=buildBuiltinWorldPublication({input:withExplicitView(historicalWorldCases())});
  for(const [path,bytes]of data)write(resolve(root,'assets/data/builtin-world/generated/v1',path),bytes);
  write(resolve(root,'assets/data/territorial-entities/generated/current-world.geojson'),JSON.stringify({type:'FeatureCollection',features:[]}));
  write(resolve(root,'assets/data/territorial-entities/generated/v2/index.json'),JSON.stringify({entities:[]}));
  // The input path is gzip even for the tiny synthetic land fixture.
  const land={type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]]};
  write(resolve(root,'assets/data/physical-land/v1/geometry.json.gz'),gzipSync(Buffer.from(JSON.stringify(land))));
  write(resolve(root,'assets/data/physical-land/v1/manifest.json'),JSON.stringify({waterObjects:{geometries:[]}}));
  const clipper=globalThis.polygonClipping;
  const artifact=[[46.798053,39.097382],[46.803617228283514,39.10088708625098],[46.80361722811995,39.10088708614795],[46.798053,39.097382]];
  globalThis.polygonClipping={...clipper,union:(...args)=>[...clipper.union(...args),[artifact]]};
  t.after(()=>{globalThis.polygonClipping=clipper;});
  const result=buildPreparedPolygonMeshes({root,write,sourceIdentity:()=>({sourceSha256:'fixture'})});
  assert.ok(result.manifest.precisionDiscards.length>0,'scope discard evidence must reach the unscoped manifest');
  assert.ok(result.manifest.precisionDiscards.some(row=>row.discards.some(discard=>discard.operation==='union')));
});
