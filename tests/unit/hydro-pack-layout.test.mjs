import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {buildHydroMetadata,buildHydroPack,finalizeHydroPackGroups,planHydroPackGroups} from '../../tools/gis/hydro-pack-layout.mjs';
import {decodeHydroGeneratedPack} from '../../tools/gis/hydro-pack-decoder.mjs';

const features=JSON.parse(readFileSync('tests/fixtures/hydro-encoding-oracle.json','utf8'));
const oracle=JSON.parse(readFileSync('tests/fixtures/hydro-pack-oracle.json','utf8'));
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
test('Hydro shard and index layout matches the original Python binary ordering',async()=>{
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
  const decoded=decodeHydroGeneratedPack({...complete,stages});
  assert.deepEqual(decoded.map(row=>row.metadata.fid),[1,2,3,4,10,11]);
  assert.deepEqual(decoded[0].geometry.coordinates,[[180,0],[-179.999999,.000001],[180,-.000001]]);
  assert.deepEqual(decoded[0].widths,[[0,1.234,65.535]]);
  assert.equal(decoded[0].metadata.sourceId,'100,110,105');
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
