import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {collectViewerAssets} from '../../scripts/lib/product-assets.mjs';

const ROOT='assets/data/builtin-world/generated/v1/';
const SHA='a'.repeat(64);
const country=id=>({entityId:id,file:`countries/${id}-sha256-${SHA}.json.gz`,encoding:'gzip',sha256:SHA,compressedBytes:3,decodedBytes:8,coverage:[{validFrom:null,validTo:null}]});
const catalog=()=>({schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'country-files-v1',template:{},entities:[country('AAA'),country('BBB')]});
function viewerInput(index=catalog()){
 const files=new Map([['index.html',''],['.nojekyll',''],['assets/js/viewer.js','export const viewer=true;'],[ROOT+'index.json',JSON.stringify(index)],
  [ROOT+'transport/old.bin','old aggregate'],[ROOT+'countries/orphan.json.gz','orphan']]);
 const preview='assets/data/physical-land/preview/v1/fixture.json.gz';
 files.set(preview,'preview');
 files.set('assets/js/build-meta.js','globalThis.PANDOLAB_BUILD_META=Object.freeze('+JSON.stringify({initialLandPreview:{url:preview}})+');');
 for(const row of index.entities)files.set(ROOT+row.file,'country');
 return {files,collect:()=>collectViewerAssets({root:tmpdir(),availablePaths:[...files.keys()],readSource:path=>files.get(path),workerAssets:{}})};
}
test('Viewer closure selects exactly the referenced independent country files and no transport',async()=>{
 const index=catalog(),viewer=viewerInput(index),web=await viewer.collect();
 const expected=[ROOT+'index.json',...index.entities.map(row=>ROOT+row.file)].sort();
 assert.deepEqual([...web].filter(path=>path.startsWith(ROOT)).sort(),expected);
});
test('missing referenced country blocks Web publication rather than falling back to a packed file',async()=>{
 const f=viewerInput();f.files.delete(ROOT+catalog().entities[0].file);
 await assert.rejects(f.collect(),/Missing viewer dependency/);
});
test('Viewer closure rejects retired transport, offsets and unsafe country descriptors',async()=>{
 for(const change of [
  x=>{delete x.storageLayout;},x=>{x.transport={url:'transport/old.bin'};},x=>{x.entities[0].offset=0;},
  x=>{x.entities[0].file='../outside.gz';},x=>{x.entities[0].sha256='b'.repeat(64);},
  x=>{x.entities[0].decodedBytes=0;},x=>{x.entities[0].encoding='identity';},x=>{x.entities.push({...x.entities[0]});},
 ]){
  const index=catalog();change(index);
  await assert.rejects(viewerInput(index).collect(),/builtin|country/i);
 }
});
