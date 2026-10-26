import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {ARAL_NAMES,verifyAralNames} from '../../tools/gis/verify-ussr-1922-aral-names.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
function source(){
 const lakes={type:'FeatureCollection',features:Object.entries(ARAL_NAMES).map(([id,{nameKo}])=>
   ({type:'Feature',properties:{pandolab_id:id,name:nameKo,name_ko:nameKo},
     geometry:{type:'Polygon',coordinates:[[[50,40],[51,40],[50,41],[50,40]]]}}))};
 const overrides={aliases:{}};
 for(const value of Object.values(ARAL_NAMES))
   for(const older of [value.previousNameKo,value.previousNameKo.slice(0,-1)])
     overrides.aliases[older]=value.nameKo;
 const features=Object.entries(ARAL_NAMES).map(([awId,value],fid)=>
   ({awId,name:value.nameKo,fid}));
 const compressed=rows=>gzipSync(Buffer.from(JSON.stringify({version:5,features:rows})));
 const contents=[Buffer.from('index'),compressed(features),compressed(features.map(x=>({fid:x.fid}))),
   Buffer.from('a geometry'),Buffer.from('b geometry'),Buffer.from('c geometry')];
 let offset=0;
 const descriptors=contents.map(b=>{
   const spec={offset,bytes:b.length,sha256:digest(b),url:'hydro.bin'};offset+=b.length;return spec;
 });
 const bundle=Buffer.concat(contents);
 const manifest={schema:'pandolab-water-shards-v5',version:'0.13.2',
   container:{bytes:bundle.length,sha256:digest(bundle)},
   index:descriptors[0],metadata:{core:descriptors[1],detail:descriptors[2]},
   shards:descriptors.slice(3)};
 const proof={aral:{names:structuredClone(ARAL_NAMES),
   geometryIndexCompressedBytesUnchanged:true,detailProvenanceUnchanged:true,
   sourceOnlyTwoKoreanNamesChanged:true,runtimeOnlyTwoNamesChanged:true,
   geometryAndIndexSha256:[descriptors[0],...descriptors.slice(3)].map(x=>x.sha256)}};
 return {lakes,overrides,manifest,bundle,proof};
}
test('retired Python Aral test parity: only two pinned names and unchanged packed geometry',()=>{
 const f=source(),before=Buffer.from(f.bundle);
 const r=verifyAralNames(f);
 assert.equal(r.namesVerified,2);
 assert.equal(r.waterIndexGeometryByteIdenticalToPublication,true);
 assert.deepEqual(f.bundle,before);
});
test('names, aliases, and frozen geometry hashes are independently enforced',()=>{
 const a=source();a.overrides.aliases['사우스아랄씨호']='old';
 assert.throws(()=>verifyAralNames(a),/aliases/);
 const b=source();b.lakes.features[0].properties.name='South Aral';
 assert.throws(()=>verifyAralNames(b),/renamed/);
 const c=source();c.proof.aral.geometryAndIndexSha256[0]='0'.repeat(64);
 assert.throws(()=>verifyAralNames(c),/geometry or index/);
});
test('source/published binary cannot be silently rewritten by an older Python producer',()=>{
 const f=source();f.bundle=Buffer.from(f.bundle);f.bundle[0]^=1;
 assert.throws(()=>verifyAralNames(f),/whole-bundle/);
});
