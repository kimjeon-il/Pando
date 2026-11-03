#!/usr/bin/env node
// Deterministic full real-ETOPO elevation/shade raster reconstruction.
// Never writes to the published DEM; the 4096x2048 tint needs separate inputs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {generateTerrainDemLevel} from './terrain-dem-build.mjs';
import {reconcileDemGutterFiles,restoreDemPolarGutterShade} from './terrain-dem-gutters.mjs';
import {hashTerrainFile} from './terrain-dem-assets.mjs';
import {readNativeRawWebp} from '../map-image/native-resample.mjs';
import {verifyPublishedDem} from './verify-p1-dem-publication.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
function sameGeometry(a,b){return a.width===b.width&&a.height===b.height&&a.data.length===b.data.length;}
function comparePixels(a,b){
  assert(sameGeometry(a,b),'DEM recreated tile dimensions differ');
  let changed=0,rgChanged=0,alphaChanged=0,shadeChanged=0,maxShadeError=0,shadeOverTolerance=0;
  for(let i=0;i<a.data.length;i+=4){
    const ra=a.data,rb=b.data,dr=ra[i]!==rb[i],dg=ra[i+1]!==rb[i+1],db=Math.abs(ra[i+2]-rb[i+2]),da=ra[i+3]!==rb[i+3];
    if(dr||dg||db||da)changed++;
    if(dr||dg)rgChanged++;
    if(db){shadeChanged++;maxShadeError=Math.max(maxShadeError,db);if(db>2)shadeOverTolerance++;}
    if(da)alphaChanged++;
  }
  return {changed,rgChanged,alphaChanged,shadeChanged,maxShadeError,shadeOverTolerance};
}
export async function recreateAllDemPixels({etopo,reference,output,proof}={}){
  if(![etopo,reference,output,proof].every(x=>typeof x==='string'&&x))
    throw Error('Required --etopo --reference --output --proof');
  const source=resolve(etopo),target=resolve(output),baseline=resolve(reference);
  if(existsSync(target)||existsSync(resolve(proof)))throw Error('Never overwrite reconstructed DEM or proof');
  if(target===baseline||target===source||baseline===source)throw Error('Explicit separate immutable originals and staging');
  const original=await verifyPublishedDem({directory:baseline});
  assert.equal(original.tiles,1280);
  const originalManifest=JSON.parse(await readFile(join(baseline,'manifest.json'),'utf8'));
  const etopoFile=await hashTerrainFile(source);
  assert.equal(etopoFile.sha256,originalManifest.sources[0].sha256,'Real ETOPO original SHA mismatch');
  assert.equal(etopoFile.bytes,originalManifest.sources[0].bytes,'Real ETOPO bytes mismatch');
  await mkdir(target,{recursive:false});
  const generated=[];
  for(const level of originalManifest.levels){
    const start=Date.now();
    const item=await generateTerrainDemLevel({source,output:target,level,strict:true});
    generated.push({...item,secondsSinceStart:Math.round((Date.now()-start)/1000)});
    console.error('P1 DEM source reconstruction: LOD',level.id,'generated',item.tileCount,'tiles');
  }
  // Restore the historical native polar-shade correction before the full gutters pass.
  const repaired=await restoreDemPolarGutterShade({output:target,source,levels:originalManifest.levels,minLevel:0,maxLevel:5});
  const gutters=[];
  for(const level of originalManifest.levels)gutters.push({level:level.id,changed:await reconcileDemGutterFiles(target,level)});
  console.error('P1 DEM source reconstruction: polar + all gutter reconciliation complete');
  let checked=0,exactEncoded=0,exactPixels=0,deltaPixels=0,rgChanged=0,shadeChanged=0,alphaChanged=0,
    shadeOverTolerance=0,maxShadeError=0,firstDifferences=[];
  for(const level of originalManifest.levels){
    let perLevel=0;
    for(let row=0;row<level.rows;row++)for(let col=0;col<level.columns;col++){
      const rel=join(String(level.id),col+'-'+row+'.webp'),newBytes=await readFile(join(target,rel)),oldBytes=await readFile(join(baseline,rel));
      checked++;perLevel++;
      if(newBytes.equals(oldBytes)){exactEncoded++;exactPixels++;continue;}
      const a=await readNativeRawWebp(newBytes),b=await readNativeRawWebp(oldBytes);
      if(a.data.equals(b.data)){exactPixels++;continue;}
      const result=comparePixels(a,b);
      deltaPixels+=result.changed;rgChanged+=result.rgChanged;shadeChanged+=result.shadeChanged;
      alphaChanged+=result.alphaChanged;shadeOverTolerance+=result.shadeOverTolerance;
      maxShadeError=Math.max(maxShadeError,result.maxShadeError);
      if(firstDifferences.length<16)firstDifferences.push({tile:rel,...result});
    }
    console.error('P1 DEM source reconstruction: LOD',level.id,'compared',perLevel,'tiles');
  }
  assert.equal(checked,1280,'Not all published DEM tiles compared');
  const proofData={schema:'pando-p1-dem-real-source-regeneration-v1',baselineVersion:originalManifest.version,
    originalEtopoSha256:etopoFile.sha256,originalEtopoBytes:etopoFile.bytes,
    publishedAssetDigest:original.assetDigest,generated,polarRepairTiles:repaired,gutterCorrections:gutters,
    tilesCompared:checked,identicalCompressedWebpTiles:exactEncoded,identicalDecodedPixelTiles:exactPixels,
    changedDecodedPixels:deltaPixels,elevationRGChangedPixels:rgChanged,shadeChangedPixels:shadeChanged,
    alphaChangedPixels:alphaChanged,shadePixelsBeyondAllowedError:shadeOverTolerance,maxShadeError,
    firstDifferences,allElevationsEqual:rgChanged===0,allAlphaEqual:alphaChanged===0,
    allPixelsIdentical:exactPixels===checked,allPixelsWithinDocumentedShadeTolerance:rgChanged===0&&alphaChanged===0&&shadeOverTolerance===0,
    tintRecreated:false,tintBlocker:'The exact canonical-country land-mask original is not present at the pinned release; tint remains separate.',
    publishedOutputsUnchanged:true};
  await writeFile(resolve(proof),JSON.stringify(proofData,null,2)+'\n',{flag:'wx'});
  console.log('P1_DEM_REGEN='+JSON.stringify({...proofData,generated:generated.map(x=>({level:x.level,tileCount:x.tileCount,seconds:x.seconds})),firstDifferences:firstDifferences.slice(0,4)}));
  if(!proofData.allPixelsWithinDocumentedShadeTolerance)throw Error('Full DEM source regeneration differs beyond published RGBA tolerance');
  return proofData;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{etopo:{type:'string'},reference:{type:'string'},output:{type:'string'},proof:{type:'string'}}});
    assert(!positionals.length,'Unexpected positional arguments');
    await recreateAllDemPixels(values);
  }catch(e){console.error('P1 DEM reconstruction failed: '+e.stack);process.exitCode=1;}
}
