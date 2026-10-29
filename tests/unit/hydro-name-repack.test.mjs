import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {rewriteHydroNames} from '../../tools/gis/prepare-hydro-name-replacement-bundle.mjs';

const hash=data=>createHash('sha256').update(data).digest('hex');
function fixture(){
  const core=[{fid:1,category:'river',awId:'hydro-system:12',systemId:'12',name:'옛강',fragmentIndex:0},
    {fid:2,category:'river',awId:'hydro-system:12',systemId:'12',name:'옛강',fragmentIndex:1},
    {fid:3,category:'lake',awId:'lake:1',name:'옛호수'}];
  const detail=[{fid:1,aliases:['old'],tributaryNames:['old'],osmRelationIds:[123],source:'OSM waterway names'},
    {fid:2,osmRelationIds:[123]},{fid:3}];
  const parts=[Buffer.from('original-index'),...([core,detail].map(features=>gzipSync(JSON.stringify({version:5,features})))),Buffer.from('original-geometry')];
  let offset=0;const specs=parts.map(part=>{const row={url:'hydro.bin',offset,bytes:part.length,sha256:hash(part)};offset+=part.length;return row;});
  const bundle=Buffer.concat(parts),manifest={version:'0.13.2',schema:'pandolab-water-shards-v5',index:specs[0],
    metadata:{core:specs[1],detail:specs[2],featureCount:3},shards:[specs[3]],
    container:{url:'hydro.bin',bytes:bundle.length,sha256:hash(bundle)},stats:{compressedBytes:bundle.length,osmWaterwayMatchCount:1},
    cache:{name:'original'},sources:{osmWaterways:{matchedSystems:1},nameEnrichment:{osmMatches:1},hydroRivers:[{datasetCode:'as',osmMatches:1}]}};
  const substitutions={'12':{previousNameKo:'옛강',nameKo:'새강',aliases:['다른이름'],tributaryNames:['지류'],hydroRiversRegion:'as',independentSources:[{url:'https://example.test/source'}]}};
  return {manifest,bundle,substitutions,sourceName:'review.json',sourceBytes:Buffer.from('source'),lakeSubstitutions:{'lake:1':{previousNameKo:'옛호수',nameKo:'새호수'}}};
}
test('replaces only reviewed metadata while keeping index and geometry bytes',()=>{
  const input=fixture(),before=structuredClone(input.manifest),result=rewriteHydroNames(input);
  const m=result.manifest,b=result.bundle,section=s=>b.subarray(s.offset,s.offset+s.bytes);
  assert.deepEqual(section(m.index),Buffer.from('original-index'));
  assert.deepEqual(section(m.shards[0]),Buffer.from('original-geometry'));
  const core=JSON.parse(gunzipSync(section(m.metadata.core))).features,detail=JSON.parse(gunzipSync(section(m.metadata.detail))).features;
  assert.deepEqual(core.map(row=>row.name),['새강','새강','새호수']);
  assert.deepEqual(detail[0].aliases,['다른이름']);assert.deepEqual(detail[0].tributaryNames,['지류']);
  assert.equal(detail[1].aliases,undefined);assert.equal(detail[0].osmRelationIds,undefined);
  assert.deepEqual(detail[1].independentSourceUrls,['https://example.test/source']);
  assert.equal(result.proof.changedCoreFragments,2);assert.equal(result.proof.runtimeDeployed,false);
  assert.equal(m.container.sha256,hash(b));assert.deepEqual(input.manifest,before);
});
test('rejects corrupted bundles and mismatched identities or sources',()=>{
  const data=fixture();assert.throws(()=>rewriteHydroNames({...data,bundle:Buffer.from('corrupt')}),/bundle.*identity/i);
  assert.throws(()=>rewriteHydroNames({...data,substitutions:{'12':{...data.substitutions['12'],previousNameKo:'잘못된강'}}}),/name mismatch/i);
  assert.throws(()=>rewriteHydroNames({...data,substitutions:{'12':{...data.substitutions['12'],independentSources:[{url:'https://openstreetmap.org/relation/1'}]}}}),/independent source/i);
  assert.throws(()=>rewriteHydroNames({...data,substitutions:{'99':data.substitutions['12']}}),/missing reviewed/i);
});
test('CLI refuses staging inside original input and refuses conflicting filenames',t=>{
  const root=mkdtempSync(join(tmpdir(),'hydro-repack-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const src=join(root,'source');mkdirSync(src);const bundle=join(src,'hydro.bin');writeFileSync(bundle,'original');
  const cli=fileURLToPath(new URL('../../tools/gis/prepare-hydro-name-replacement-bundle.mjs',import.meta.url));
  const invoke=(output,replacements)=>execFileSync(process.execPath,[cli,'--manifest','unused','--bundle',bundle,'--replacements',replacements,'--output-dir',output],{stdio:'pipe'});
  assert.throws(()=>invoke(join(src,'output'),'review.json'));
  assert.throws(()=>invoke(join(root,'output'),'Manifest.JSON'));
  assert.equal(readFileSync(bundle,'utf8'),'original');
});
