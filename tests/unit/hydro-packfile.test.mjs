import { describe as featureDescribe } from 'node:test';
import * as __suiteDependency0 from "node:assert/strict";
import * as __suiteDependency1 from "node:test";
import * as __suiteDependency2 from "node:vm";
import * as __suiteDependency3 from "node:fs";
import * as __suiteDependency4 from "node:crypto";
import * as __suiteDependency5 from "node:zlib";
import * as __suiteDependency6 from "node:assert/strict";
import * as __suiteDependency7 from "node:test";
import * as __suiteDependency8 from "node:crypto";
import * as __suiteDependency9 from "node:fs";
import * as __suiteDependency10 from "node:os";
import * as __suiteDependency11 from "node:path";
import * as __suiteDependency12 from "../../tools/build/build-hydro-packfile.mjs";
import * as __suiteDependency13 from "node:assert/strict";
import * as __suiteDependency14 from "node:crypto";
import * as __suiteDependency15 from "node:fs";
import * as __suiteDependency16 from "node:fs/promises";
import * as __suiteDependency17 from "node:os";
import * as __suiteDependency18 from "node:path";
import * as __suiteDependency19 from "node:test";
import * as __suiteDependency20 from "node:zlib";
import * as __suiteDependency21 from "../../tools/gis/hydro-pack-layout.mjs";
import * as __suiteDependency22 from "../../tools/gis/hydro-pack-decoder.mjs";
import * as __suiteDependency23 from "../../tools/gis/hydro-selected-data.mjs";
featureDescribe("hydro-packfile", () => {
  const assert = __suiteDependency0.default;
  const test = __suiteDependency1.default;
  const vm = __suiteDependency2.default;
  const {  readFileSync  } = __suiteDependency3;
  const {  createHash, webcrypto  } = __suiteDependency4;
  const {  gunzipSync  } = __suiteDependency5;
const base = new URL('../../src/runtime/workers/', import.meta.url);
const storeSource = readFileSync(new URL('hydro-shard-store.js', base), 'utf8');
const workerSource = readFileSync(new URL('hydro-tile-worker.js', base), 'utf8');
const manifestPath = 'assets/data/hydro/v0.13.4/manifest.json';
const manifestUrl = new URL('../../' + manifestPath, import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
const bundle = new Uint8Array(readFileSync(new URL(manifest.container.url, manifestUrl)));
const baseUrl = new URL(manifestPath.replace(/[^/]+$/, ''), 'https://example.invalid/Pando/').href;
const rangeFor = spec => `bytes=${spec.offset}-${spec.offset + spec.bytes - 1}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function loadWorker({ supportsRange = true } = {}) {
  const calls = [], messages = [];
  const scope = {
    self: { fflate: { gunzipSync: bytes => new Uint8Array(gunzipSync(bytes)) } },
    crypto: webcrypto, TextDecoder, Uint8Array, Response, URL, Map,
    performance: { now: () => 0 },
    importScripts() {}, postMessage: m => messages.push(m),
    setTimeout, clearTimeout, onmessage: null,
    async fetch(url, init = {}) {
      const range = init?.headers?.Range || null;
      calls.push({ url: String(url), range });
      if (!supportsRange || !range)
        return new Response(bundle.slice(), { status: 200 });
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!m)throw Error('Invalid Range request ' + range);
      const start = Number(m[1]), end = Number(m[2]);
      assert.ok(start >= 0 && end < bundle.length && end >= start);
      return new Response(bundle.slice(start, end + 1), {
        status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bundle.length}` },
      });
    },
  };
  vm.runInNewContext(storeSource, scope);
  vm.runInNewContext(workerSource, scope);
  const init = async () => {
    await scope.onmessage({ data: {
      type: 'init', manifest, baseUrl,
      assetRevision: manifest.version, dataRevision: manifest.version, includeGeometry: false,
    } });
    assert.equal(messages.at(-1)?.type, 'ready', messages.at(-1)?.message);
  };
  return { scope, init, calls, messages };
}

test('bundle contains exact individually hashed declared fragments with no gaps', () => {
  assert.equal(manifest.container.bytes, bundle.length);
  assert.equal(sha256(bundle), manifest.container.sha256);
  const fragments = [manifest.index, manifest.metadata.core, manifest.metadata.detail, ...manifest.shards].sort((a,b)=>a.offset-b.offset);
  let expectedStart = 0;
  for (const fragment of fragments) {
    assert.equal(fragment.url, manifest.container.url);
    assert.equal(fragment.offset, expectedStart);
    const content = bundle.subarray(fragment.offset, fragment.offset + fragment.bytes);
    assert.equal(sha256(content), fragment.sha256);
    expectedStart += fragment.bytes;
  }
  assert.equal(expectedStart, bundle.length);
  assert.ok(manifest.metadata.detail.lazy);
});

test('real worker hydrates global index and base metadata through only two small Range reads', async () => {
  const worker = loadWorker();
  await worker.init();
  assert.ok(worker.calls.some(x => x.range === rangeFor(manifest.index)));
  assert.ok(worker.calls.some(x => x.range === rangeFor(manifest.metadata.core)));
  assert.ok(worker.calls.every(x => x.range !== null));
});

test('real worker reuses exactly one whole download when origin ignores Range', async () => {
  const worker = loadWorker({ supportsRange: false });
  await worker.init();
  assert.equal(worker.calls.length, 1, JSON.stringify(worker.calls));
});

test('virtual shard reader issues absolute ranges and saves isolated cache entries', async () => {
  const records = new Map();
  const memCalls = [];
  const scope = { self: {}, Response, Uint8Array };
  vm.runInNewContext(storeSource, scope);
  const specs = manifest.shards.slice(0, 2).map(s => ({ ...s, fileBytes: bundle.length }));
  assert.ok(specs.length > 0);
  const cache = {
    match: async key => records.get(key)?.clone(),
    put: async (key,value) => records.set(key,value),
    delete: async key => records.delete(key),
  };
  const store = scope.self.createHydroShardStore({
    openCache: async()=>cache,
    resolveUrl: x => 'https://example.invalid/' + x,
    gunzip: bytes => bytes,
    digest: async bytes => sha256(bytes),
    fetchResponse: async (_url, init) => {
      memCalls.push(init.headers?.Range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
      const from = Number(match[1]), through = Number(match[2]);
      return new Response(bundle.slice(from,through+1), {
        status:206,headers:{'Content-Range': `bytes ${from}-${through}/${bundle.length}`},
      });
    },
  });
  for(const spec of specs){
    const data = await store.full(spec);
    assert.equal(data.length,spec.bytes);
    assert.equal(sha256(data),spec.sha256);
  }
  assert.deepEqual(memCalls,specs.map(rangeFor));
  assert.equal(records.size,specs.length, 'different virtual shards cannot overwrite the same URL cache key');
  assert.ok([...records.keys()].every(x=>x.includes('__hydro_segment=')));
});
});
featureDescribe("hydro-packfile-builder", () => {
  const assert = __suiteDependency6.default;
  const test = __suiteDependency7.default;
  const {  createHash  } = __suiteDependency8;
  const {  mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync  } = __suiteDependency9;
  const {  tmpdir  } = __suiteDependency10;
  const {  join  } = __suiteDependency11;
  const {  buildHydroPackfile,ROLES  } = __suiteDependency12;
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'hydro-builder-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const source=join(dir,'v0.13.1'),old=join(dir,'v0.13.0'),output=join(dir,'output');
 mkdirSync(source);mkdirSync(old);
 const original=ROLES.map((name,i)=>{
  const data=Buffer.from('source-'+name),file='part-'+i+'.bin';
  const current=i%2===1;writeFileSync(join(current?source:old,file),data);
  return {url:current?file:'../v0.13.0/'+file,bytes:data.length,sha256:sha(data),
    ...(i>=3?{id:i-3}:{})};
 });
 const manifest={version:'0.13.1',schema:'pandolab-water-shards-v5',format:{pack:4},
 index:original[0],metadata:{core:original[1],detail:{...original[2],lazy:true}},
 shards:original.slice(3),cache:{name:'before'},stats:{compressedBytes:0}};
 writeFileSync(join(source,'manifest.json'),JSON.stringify(manifest));
 return {source,output,original,manifest};
}
test('packing is lossless, ordered, deterministic and source preserving',t=>{
 const f=fixture(t);const r=buildHydroPackfile(f);
 const manifest=JSON.parse(readFileSync(join(f.output,'manifest.json')));
 const binary=readFileSync(join(f.output,'hydro.bin'));
 assert.equal(r.containerSha256,sha(binary));
 assert.equal(manifest.container.bytes,binary.length);
 assert.deepEqual(manifest.container.roles,ROLES);
 let cursor=0;
 for(const [i,v] of [manifest.index,manifest.metadata.core,manifest.metadata.detail,...manifest.shards].entries()){
  assert.equal(v.offset,cursor);assert.equal(v.url,'hydro.bin');
  assert.equal(sha(binary.subarray(cursor,cursor+v.bytes)),f.original[i].sha256);
  cursor+=v.bytes;
 }
 assert.equal(cursor,binary.length);
 assert.equal(buildHydroPackfile({...f,check:true}).status,'checked');
 assert.deepEqual(JSON.parse(readFileSync(join(f.source,'manifest.json'))),f.manifest);
});
test('packfile refuses corrupt inputs, drift, and unsafe paths',t=>{
 const f=fixture(t);
 assert.throws(()=>buildHydroPackfile({...f,check:true}),/differs from committed/);
 assert.throws(()=>buildHydroPackfile({source:f.source,output:f.source}),/must differ/);
 buildHydroPackfile(f);
 writeFileSync(join(f.output,'hydro.bin'),'changed');
 assert.throws(()=>buildHydroPackfile({...f,check:true}),/differs from committed/);
 writeFileSync(join(f.source,'part-1.bin'),'tampered');
 assert.throws(()=>buildHydroPackfile(f),/SHA-256 mismatch/);
});
});
featureDescribe("hydro-pack-layout", () => {
  const assert = __suiteDependency13.default;
  const { createHash } = __suiteDependency14;
  const { readFileSync } = __suiteDependency15;
  const { mkdir,mkdtemp,readFile,rm,writeFile } = __suiteDependency16;
  const { tmpdir } = __suiteDependency17;
  const { dirname,join } = __suiteDependency18;
  const test = __suiteDependency19.default;
  const { gunzipSync,gzipSync } = __suiteDependency20;
  const { buildHydroMetadata,buildHydroPack,finalizeHydroPackGroups,planHydroPackGroups,serializeHydroMetadata } = __suiteDependency21;
  const { decodeHydroGeneratedPack,decodeHydroSelectedPack } = __suiteDependency22;
  const { loadCompleteHydroFeatures,loadSelectedHydroFeatures } = __suiteDependency23;
const features=JSON.parse(readFileSync('tests/fixtures/hydro-encoding-oracle.json','utf8'));
const oracle=JSON.parse(readFileSync('tests/fixtures/hydro-pack-oracle.json','utf8'));
test('Hydro metadata preserves Python float spelling for widths and terminal coordinates',()=>{
  const value={version:5,features:[{fid:1,width:1,terminal:{class:'sea',sourceEndpoint:[4,-0],renderEndpoint:[.00001,1e16]}}]};
  assert.equal(serializeHydroMetadata(value),'{"version":5,"features":[{"fid":1,"width":1.0,"terminal":{"class":"sea","sourceEndpoint":[4.0,-0.0],"renderEndpoint":[1e-05,1e+16]}}]}');
  assert.throws(()=>serializeHydroMetadata({features:[{width:Infinity}]}),/finite/i);
});
function inputs(){return features.map(({feature:row,featureHex})=>({
  feature:{metadata:{fid:row.fid,logicalFid:row.logical_fid,awId:row.pandolab_id,category:row.category,stage:row.stage,flags:row.flags,
    fragmentIndex:row.fragment_index,fragmentCount:row.fragment_count,width:row.width,bounds:row.bounds.map(value=>Math.round(value*1000000)),
    sourceId:row.source_id,source:'fixture',layerId:'fixture',name:'Test'},geometry:row.geometry,widths:row.width_profile},
  encoded:{fid:row.fid,logicalFid:row.logical_fid,feature:Buffer.from(featureHex,'hex')}}));}
test('Hydro grouping preserves Python tile owners, pack order and uncompressed bytes',()=>{
  const rows=inputs(),before=structuredClone(rows.map(row=>row.feature));
  const result=planHydroPackGroups({features:rows.map(row=>row.feature),encoded:rows.map(row=>row.encoded),changedFeatureIds:[]});
  assert.deepEqual(result.packs.map(row=>({stage:row.stage,owner:row.owner,features:row.fids.length,rawHex:row.raw.toString('hex')})),
    oracle.packs.map(row=>({stage:row.stage,owner:row.owner,features:row.features,rawHex:row.rawHex})));
  assert.deepEqual(rows.map(row=>row.feature),before);assert.equal(result.coordinateCount,oracle.statistics.coordinateCount);
  assert.deepEqual(result.categoryCounts,oracle.statistics.categoryCounts);
});
test('Hydro grouping refuses mismatched and duplicate encoded feature identities',()=>{
  const rows=inputs();rows[0].encoded.fid=999;
  assert.throws(()=>planHydroPackGroups({features:rows.map(row=>row.feature),encoded:rows.map(row=>row.encoded),changedFeatureIds:[]}),/identity/i);
  rows[0].encoded.fid=rows[0].feature.metadata.fid;rows[0].encoded.feature[0]=99;
  assert.throws(()=>planHydroPackGroups({features:rows.map(row=>row.feature),encoded:rows.map(row=>row.encoded),changedFeatureIds:[]}),/identity/i);
});
test('Hydro metadata keeps source details separate and matches existing Python records',()=>{
  const rows=inputs(),plan=planHydroPackGroups({features:rows.map(row=>row.feature),encoded:rows.map(row=>row.encoded),changedFeatureIds:[]});
  const metadata=buildHydroMetadata(rows.map(row=>row.feature),plan.prepared);
  assert.deepEqual(metadata.core,oracle.metadataCore);assert.deepEqual(metadata.detail,oracle.metadataDetail);
  assert.equal(Buffer.from(JSON.stringify(metadata.core)).toString('hex'),oracle.metadataCoreRawHex);
  assert.equal(Buffer.from(JSON.stringify(metadata.detail)).toString('hex'),oracle.metadataDetailRawHex);
});
test('Hydro shard and index layout matches the original Python binary ordering',async t=>{
  const rows=inputs(),plan=planHydroPackGroups({features:rows.map(row=>row.feature),encoded:rows.map(row=>row.encoded),changedFeatureIds:[]});
  const lookup=new Map(oracle.packs.map(row=>[row.rawHex,row.gzipHex]));lookup.set(oracle.indexRawHex,oracle.indexGzipHex);
  lookup.set(oracle.metadataCoreRawHex,oracle.metadataCoreGzipHex);lookup.set(oracle.metadataDetailRawHex,oracle.metadataDetailGzipHex);
  const gzip=async values=>values.map(value=>{const result=lookup.get(value.toString('hex'));assert(result,'unexpected pack or index bytes');return Buffer.from(result,'hex');});
  const output=await finalizeHydroPackGroups(plan,{gzip});
  assert.equal(output.indexRaw.toString('hex'),oracle.indexRawHex);
  assert.equal(output.indexGzip.toString('hex'),oracle.indexGzipHex);
  assert.equal(output.shards.length,1);
  assert.equal(output.shards[0].data.toString('hex'),oracle.packs.map(row=>row.gzipHex).join(''));
  assert.equal(output.logicalFeatureCount,oracle.statistics.logicalFeatureCount);
  assert.equal(output.indexTileCount,oracle.statistics.indexTileCount);
  const complete=await buildHydroPack({features:rows.map(row=>row.feature),encoded:rows.map(row=>row.encoded),changedFeatureIds:[]},{gzip});
  assert.deepEqual(complete.stats,oracle.statistics);
  assert.equal(complete.files.get('index.bin.gz').toString('hex'),oracle.indexGzipHex);
  assert.equal(complete.files.get('metadata-core.json.gz').toString('hex'),oracle.metadataCoreGzipHex);
  assert.equal(complete.files.get('metadata-detail.json.gz').toString('hex'),oracle.metadataDetailGzipHex);
  assert.equal(complete.files.get('shards/s0.bin').toString('hex'),oracle.packs.map(row=>row.gzipHex).join(''));
  const stages=Array.from({length:4},(_,id)=>({id,minZoom:6+id}));
  const decoded=decodeHydroGeneratedPack({...complete,stages,expectedStats:complete.stats});
  assert.deepEqual(decoded.map(row=>row.metadata.fid),[1,2,3,4,10,11]);
  assert.throws(()=>decodeHydroGeneratedPack({...complete,stages,expectedStats:{...complete.stats,coordinateCount:26}}),/coordinate.*count/i);
  assert.throws(()=>decodeHydroGeneratedPack({...complete,stages,expectedStats:{...complete.stats,logicalFeatureCount:7}}),/logical.*count/i);
  assert.deepEqual(decoded[0].geometry.coordinates,[[180,0],[-179.999999,.000001],[180,-.000001]]);
  assert.deepEqual(decoded[0].widths,[[0,1.234,65.535]]);
  assert.equal(decoded[0].metadata.sourceId,'100,110,105');
  const selected=decodeHydroSelectedPack({...complete,stages,logicalFids:[101]});
  assert.deepEqual(selected,decoded.filter(row=>row.metadata.logicalFid===101));
  const directory=await mkdtemp(join(tmpdir(),'pando-hydro-selected-data-'));t.after(()=>rm(directory,{recursive:true}));
  for(const [name,bytes] of complete.files){const path=join(directory,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
  await writeFile(join(directory,'manifest.json'),JSON.stringify({...complete.layout,stages,stats:complete.stats}));
  const loaded=await loadSelectedHydroFeatures({directory,logicalFids:[101]});assert.deepEqual(loaded.features,selected);
  await assert.rejects(loadCompleteHydroFeatures({directory}),/explicit/i);
  const all=await loadCompleteHydroFeatures({directory,acknowledgeWholeCatalog:true});assert.deepEqual(all.features,decoded);
  assert.equal(all.packCount,complete.stats.packCount);assert.equal(all.logicalCount,complete.stats.logicalFeatureCount);
  await assert.rejects(loadSelectedHydroFeatures({directory,logicalFids:[99999]}),/logical|selected/i);
  const shardPath=join(directory,complete.layout.shards[0].url),damaged=await readFile(shardPath);damaged[0]^=1;await writeFile(shardPath,damaged);
  await assert.rejects(loadSelectedHydroFeatures({directory,logicalFids:[101]}),/hash/i);
  const layoutWithUnused={...complete.layout,shards:[...complete.layout.shards,{id:99,url:'unused',bytes:1,sha256:'0'.repeat(64)}]};
  assert.deepEqual(decodeHydroSelectedPack({...complete,layout:layoutWithUnused,stages,logicalFids:[101]}),selected);
  const damagedSelected=new Map(complete.files);damagedSelected.set('shards/s0.bin',Buffer.from('damaged'));
  assert.throws(()=>decodeHydroSelectedPack({...complete,files:damagedSelected,stages,logicalFids:[101]}),/hash/i);
  assert.throws(()=>decodeHydroSelectedPack({...complete,stages,logicalFids:[99999]}),/logical|selected/i);
  assert.throws(()=>decodeHydroSelectedPack({...complete,stages,logicalFids:[101,101]}),/logical|selected/i);
  const stageIndex=gunzipSync(complete.files.get('index.bin.gz'));let position=20;
  for(let i=0;i<stageIndex.readUInt32LE(8);i++){const count=stageIndex.readUInt16LE(position+5);position+=7+count*4;}
  const logicalEntries=[];for(let i=0;i<stageIndex.readUInt32LE(12);i++){const logical=stageIndex.readUInt32LE(position),count=stageIndex.readUInt16LE(position+4);
    position+=6;logicalEntries.push({logical,packs:Array.from({length:count},(_,j)=>stageIndex.readUInt32LE(position+j*4))});position+=count*4;}
  const firstPack=stageIndex.readUInt32LE(position),selectedLogical=logicalEntries.find(row=>row.packs.includes(firstPack))?.logical;
  assert.notEqual(selectedLogical,undefined);stageIndex[position+14]=(stageIndex[position+14]+1)%4;
  const stageBytes=gzipSync(stageIndex),stageFiles=new Map(complete.files);stageFiles.set('index.bin.gz',stageBytes);
  const stageLayout={...complete.layout,index:{...complete.layout.index,bytes:stageBytes.length,sha256:createHash('sha256').update(stageBytes).digest('hex')}};
  assert.throws(()=>decodeHydroGeneratedPack({...complete,layout:stageLayout,files:stageFiles,stages}),/pack.*stage/i);
  assert.throws(()=>decodeHydroSelectedPack({...complete,layout:stageLayout,files:stageFiles,stages,logicalFids:[selectedLogical]}),/pack.*stage/i);
  const altered=gunzipSync(complete.files.get('index.bin.gz'));let offset=20;
  for(let i=0;i<altered.readUInt32LE(8);i++){const count=altered.readUInt16LE(offset+5);offset+=7+count*4;}
  let changed=false;for(let i=0;i<altered.readUInt32LE(12);i++){
    const logical=altered.readUInt32LE(offset),count=altered.readUInt16LE(offset+4);offset+=6;
    if(logical===101&&count){altered.writeUInt32LE(2,offset);changed=true;}offset+=count*4;
  }
  assert.equal(changed,true);const changedIndex=gzipSync(altered),changedFiles=new Map(complete.files);changedFiles.set('index.bin.gz',changedIndex);
  const changedLayout={...complete.layout,index:{...complete.layout.index,bytes:changedIndex.length,sha256:createHash('sha256').update(changedIndex).digest('hex')}};
  assert.throws(()=>decodeHydroSelectedPack({...complete,layout:changedLayout,files:changedFiles,stages,logicalFids:[101]}),/missing/i);
  const corrupted=new Map(complete.files);corrupted.set('shards/s0.bin',Buffer.from('damaged'));
  assert.throws(()=>decodeHydroGeneratedPack({...complete,files:corrupted,stages}),/hash/i);
  await assert.rejects(finalizeHydroPackGroups(plan,{gzip:async values=>values.map(()=>Buffer.from('bad'))}),/gzip|header/i);
});
test('source-bound zlib produces Python pack and index bytes',{skip:!process.env.PANDO_HYDRO_ENCODING_DIRECTORY},async()=>{
  const rows=inputs(),plan=planHydroPackGroups({features:rows.map(row=>row.feature),encoded:rows.map(row=>row.encoded),changedFeatureIds:[]});
  const output=await finalizeHydroPackGroups(plan,{directory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY});
  assert.equal(output.indexRaw.toString('hex'),oracle.indexRawHex);
  const index=Buffer.from(output.indexGzip),expectedIndex=Buffer.from(oracle.indexGzipHex,'hex');index[9]=expectedIndex[9];assert.deepEqual(index,expectedIndex);
  for(const row of output.packs){const shard=output.shards[row.shard].data,actual=Buffer.from(shard.subarray(row.offset,row.offset+row.length));
    const expected=Buffer.from(oracle.packs[row.id].gzipHex,'hex');actual[9]=expected[9];assert.deepEqual(actual,expected);}
  const complete=await buildHydroPack({features:rows.map(row=>row.feature),encoded:rows.map(row=>row.encoded),changedFeatureIds:[]},
    {directory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY});
  assert.deepEqual(complete.stats,oracle.statistics);
  for(const [path,expectedHex] of [['metadata-core.json.gz',oracle.metadataCoreGzipHex],['metadata-detail.json.gz',oracle.metadataDetailGzipHex]]){
    const actual=Buffer.from(complete.files.get(path)),expected=Buffer.from(expectedHex,'hex');actual[9]=expected[9];assert.deepEqual(actual,expected);
  }
});
});
