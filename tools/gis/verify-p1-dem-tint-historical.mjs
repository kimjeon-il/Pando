#!/usr/bin/env node
// Diagnostic comparison only: the archived land mask differs from the published v0.13.3 input.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {buildNativeDemTintZip} from './terrain-dem-tint.mjs';
import {readNativeRawWebp} from '../map-image/native-resample.mjs';
import {hashTerrainFile} from './terrain-dem-assets.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const oldMask='52590ce133a779fc678496844c844137aeaa0dca41ceca1621cd7c50169f5efb';
export async function compareHistoricalTint({tintZip,ice,archiveMask,baseline,staging,output}={}){
  assert([tintZip,ice,archiveMask,baseline,staging,output].every(x=>typeof x==='string'&&x),'Explicit source inputs required');
  const base=resolve(baseline),manifest=JSON.parse(await readFile(join(base,'manifest.json'),'utf8'));
  assert(manifest.version==='0.13.3'&&manifest.tint.width===4096&&manifest.tint.height===2048,'Expected published DEM tint');
  const originals=await Promise.all([tintZip,ice].map(p=>hashTerrainFile(p)));
  assert.equal(originals[0].sha256,manifest.sources[1].sha256,'HYP source differs from pinned publication');
  assert.equal(originals[1].sha256,manifest.sources[2].sha256,'Ice source differs from pinned publication');
  const raw=gunzipSync(await readFile(resolve(archiveMask)));
  assert.equal(sha(raw),oldMask,'Historical canonical-country source changed');
  assert.notEqual(oldMask,manifest.sources[3].sha256,'Historical mask should be distinct from published version');
  await mkdir(resolve(staging),{recursive:false});
  const country=join(resolve(staging),'historical-countries.geojson');
  await writeFile(country,raw,{flag:'wx'});
  const generated=await buildNativeDemTintZip({archive:resolve(tintZip),ice:resolve(ice),land:country,temporaryRoot:resolve(staging),
    width:4096,height:2048});
  const current=await readFile(join(base,'tint.webp'));
  const a=await readNativeRawWebp(generated.webp),b=await readNativeRawWebp(current);
  assert(a.width===b.width&&a.height===b.height&&a.data.length===b.data.length);
  let differentPixels=0,red=0,green=0,blue=0,alpha=0,maximumRgbDelta=0;
  for(let i=0;i<a.data.length;i+=4){
    let diff=false;
    for(let ch=0;ch<4;ch++){const v=Math.abs(a.data[i+ch]-b.data[i+ch]);if(v)diff=true;
      if(ch<3)maximumRgbDelta=Math.max(maximumRgbDelta,v);
      if(ch===0&&v)red++;if(ch===1&&v)green++;if(ch===2&&v)blue++;if(ch===3&&v)alpha++;}
    if(diff)differentPixels++;
  }
  const proof={schema:'pando-p1-tint-archived-mask-diagnostic-v1',publishedVersion:manifest.version,
    exactTintAndIceSourcesVerified:true,publishedCountryMaskSha256:manifest.sources[3].sha256,
    reconstructedCountryMaskSha256:oldMask,exactCountryMaskOriginalVerified:false,
    tintPixelsCompared:4096*2048,differentPixels,redDiffPixels:red,greenDiffPixels:green,blueDiffPixels:blue,alphaDiffPixels:alpha,
    maxRgbDifference:maximumRgbDelta,generatedTintSha256:sha(generated.webp),publishedTintSha256:sha(current),
    compressedBytesEqual:generated.webp.equals(current),pixelIdentical:differentPixels===0,
    reproductionClassification:'archived-mask-diagnostic-not-pinned-full-source-reproduction',
    publishedDataModified:false};
  await writeFile(resolve(output),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
  console.log('P1_DEM_TINT_HISTORICAL='+JSON.stringify(proof));
  return proof;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{'tint-zip':{type:'string'},ice:{type:'string'},
      'archive-mask':{type:'string'},baseline:{type:'string'},staging:{type:'string'},output:{type:'string'}}});
    assert(!positionals.length);
    await compareHistoricalTint({tintZip:values['tint-zip'],ice:values.ice,archiveMask:values['archive-mask'],
      baseline:values.baseline,staging:values.staging,output:values.output});
  }catch(e){console.error('Historical tint diagnostic failed: '+e.stack);process.exitCode=1;}
}
