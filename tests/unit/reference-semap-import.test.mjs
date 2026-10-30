import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import yazl from 'yazl';
import {encodeNativeGrayPng,readNativeTrainingMask} from '../../tools/map-image/native-resample.mjs';
import {prepareSemapCorpus} from '../../tools/reference-analysis/prepare-semap.mjs';

test('Semap importer preserves real originals, rejects changed outputs and never creates review truth',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-semap-import-'));t.after(()=>rm(root,{recursive:true}));
  const key='loc_000001-0_0_0',blank='loc_000001-1_0_0',image=await readFile('tests/fixtures/map-image/jpeg-read/rgb.jpg');
  const labels=await encodeNativeGrayPng({width:12,height:9,data:Buffer.alloc(108,4)}),empty=await encodeNativeGrayPng({width:12,height:9,data:Buffer.alloc(108)});
  const zip=new yazl.ZipFile(),chunks=[];zip.outputStream.on('data',part=>chunks.push(part));
  const done=new Promise((ok,fail)=>{zip.outputStream.on('end',ok);zip.outputStream.on('error',fail);});
  zip.addBuffer(Buffer.from(key+'\n'+blank+'\n'),'partitions/train.txt');zip.end();await done;
  const evidence={'partitions.zip':Buffer.concat(chunks),'license_images.md':Buffer.from('fixture rights'),'README.md':Buffer.from('fixture description')};
  const images=new Map([[`images/real/${key}.jpg`,image],[`images/real/${blank}.jpg`,image]]);
  const masks=new Map([[`labels/real/${key}.png`,labels],[`labels/real/${blank}.png`,empty]]);
  const archive=values=>({members:[...values.keys()].map(name=>({name})),async readMember(name,cached){
    const bytes=values.get(name);if(!bytes)throw Error('Missing fixture member');
    if(cached&&!Buffer.from(cached).equals(bytes))throw Error('Cached original differs from publisher ZIP CRC');return bytes;}});
  const source={async readEvidence(name){return evidence[name];},async openArchive(name){return archive(name==='images.zip'?images:masks);}};
  await assert.rejects(prepareSemapCorpus({output:resolve('tools/reference-analysis/forbidden-test-output'),perInstitution:1,maximumMaps:1,source}),/external/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(prepareSemapCorpus({output:root,perInstitution:1,maximumMaps:1,source,signal:controller.signal}));
  const first=await prepareSemapCorpus({output:root,perInstitution:1,maximumMaps:1,source});
  const manifest=JSON.parse(await readFile(first.manifest,'utf8'));assert.equal(manifest.trainingOnly,true);assert.equal(manifest.sheets.length,1);
  const sheet=manifest.sheets[0];assert.equal(sheet.id,'semap-'+key);assert.deepEqual(await readFile(join(root,sheet.image)),image);
  const annotation=JSON.parse(await readFile(join(root,sheet.annotations),'utf8'));assert.equal(annotation.reviewed,false);
  assert.equal(annotation.origin,'semap-human-mask-export');assert.deepEqual(annotation.observedChannels,['hydro','transport']);
  const target=await readFile(join(root,annotation.raster.path));const mask=await readNativeTrainingMask(target,annotation.raster.sha256);
  assert(mask.data.every(value=>value===8));
  await prepareSemapCorpus({output:root,perInstitution:1,maximumMaps:1,source});
  await writeFile(join(root,annotation.raster.path),'changed');
  await assert.rejects(prepareSemapCorpus({output:root,perInstitution:1,maximumMaps:1,source}),/preserve/i);
  assert.equal(await readFile(join(root,annotation.raster.path),'utf8'),'changed');
});
