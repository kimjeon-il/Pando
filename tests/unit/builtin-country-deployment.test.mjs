import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {collectViewerAssets} from '../../scripts/lib/product-assets.mjs';
import {buildFullWorldAssetPlan} from '../../apps/editor/world-data-plan.mjs';

const ROOT='assets/data/builtin-world/generated/v1/';
const SHA='a'.repeat(64);
const country=id=>({entityId:id,file:`countries/${id}-sha256-${SHA}.json.gz`,encoding:'gzip',sha256:SHA,compressedBytes:3,decodedBytes:8,coverage:[{validFrom:null,validTo:null}]});
const catalog=()=>({schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'country-files-v1',template:{},entities:[country('AAA'),country('BBB')]});
function appInput(historical=catalog()){
 const pin=url=>({url,sha256:SHA,compressedBytes:3,decodedBytes:3});
 return {historical,meta:{dataRevision:'data-'+'b'.repeat(32),builtinWorld:pin(ROOT+'index.json'),territorialIndex:pin('index.json'),preparedPolygonMeshes:pin('manifest.json')},
  world:{schema:'pandolab-world-bundle',schemaVersion:1,source:{countryCount:258,sha256:SHA},
   assets:Object.fromEntries(['previewCountries','previewMesh','canonicalCountryPacket','canonicalMesh','labelAnchors'].map(role=>[role,pin(`world/objects/${role}-sha256-${SHA}.bin.gz`)])),
   compatibility:{sharedBoundaries:{preview:'countries-preview-shared-v0.36.1.json.gz',canonical:'countries-canonical-shared-v0.36.1.json.gz'}},
   defaultClassification:{countries:{AAA:'source'},units:{},removedIds:Array.from({length:257},(_,i)=>'removed-'+i)}},
  library:{schemaVersion:2,entities:[{file:'state-AAA.json.gz',sha256:SHA,compressedBytes:3}]},
  prepared:{schemaVersion:2,meshes:{}},
  hydro:{version:'0.13.2',schema:'pandolab-water-shards-v5',container:{url:'hydro.bin',sha256:SHA,bytes:3},stats:{compressedBytes:3}},
  places:{version:1,revision:'fixture',shards:{'places-v1':{url:'places-v1.bin',sha256:SHA,bytes:3}}}};
}
function viewerInput(index=catalog()){
 const files=new Map([['index.html',''],['.nojekyll',''],['assets/js/viewer.js','export const viewer=true;'],[ROOT+'index.json',JSON.stringify(index)],
  [ROOT+'transport/old.bin','old aggregate'],[ROOT+'countries/orphan.json.gz','orphan']]);
 for(const row of index.entities)files.set(ROOT+row.file,'country');
 return {files,collect:()=>collectViewerAssets({root:tmpdir(),availablePaths:[...files.keys()],readSource:path=>files.get(path),workerAssets:{}})};
}
test('Web and App publish exactly the referenced independent country files and no transport',async()=>{
 const index=catalog(),viewer=viewerInput(index),web=await viewer.collect(),app=buildFullWorldAssetPlan(appInput(index));
 const expected=[ROOT+'index.json',...index.entities.map(row=>ROOT+row.file)].sort();
 assert.deepEqual([...web].filter(path=>path.startsWith(ROOT)).sort(),expected);
 assert.deepEqual(app.entries.filter(row=>row.path.startsWith(ROOT)).map(row=>row.path).sort(),expected);
 for(const row of index.entities)assert.deepEqual(app.entries.find(item=>item.path===ROOT+row.file),{path:ROOT+row.file,sha256:row.sha256,bytes:row.compressedBytes});
});
test('missing referenced country blocks Web publication rather than falling back to a packed file',async()=>{
 const f=viewerInput();f.files.delete(ROOT+catalog().entities[0].file);
 await assert.rejects(f.collect(),/Missing viewer dependency/);
});
test('both deployment paths reject retired transport, offsets and unsafe country descriptors',async()=>{
 for(const change of [
  x=>{delete x.storageLayout;},x=>{x.transport={url:'transport/old.bin'};},x=>{x.entities[0].offset=0;},
  x=>{x.entities[0].file='../outside.gz';},x=>{x.entities[0].sha256='b'.repeat(64);},
  x=>{x.entities[0].decodedBytes=0;},x=>{x.entities[0].encoding='identity';},x=>{x.entities.push({...x.entities[0]});},
 ]){
  const index=catalog();change(index);
  assert.throws(()=>buildFullWorldAssetPlan(appInput(index)),/builtin|country/i);
  await assert.rejects(viewerInput(index).collect(),/builtin|country/i);
 }
});
