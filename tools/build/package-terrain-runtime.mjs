// Package already generated, pinned numerical DEM bytes; never regenerate elevation or shade.
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,writeFileSync,statfsSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {libraryConfig,libraryCheckout,libraryMaterializedRoot} from '../data/library-context.mjs';
import {withLibraryOutputs} from '../data/library-runtime.mjs';
import {terrainAssetDigest,hashTerrainFile} from '../gis/terrain-dem-assets.mjs';
import {validateTerrainManifest} from '../../src/data/terrain-manifest.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function describeTerrainRuntime(source,{revision,sourceSha256,readTile}){
 validateTerrainManifest(source);
 if(!/^[a-f0-9]{40}$/.test(revision)||!/^[a-f0-9]{64}$/.test(sourceSha256))throw Error('Pinned DEM source identity required');
 const tiles={},digest=terrainAssetDigest();
 for(const level of source.levels)for(let row=0;row<level.rows;row++)for(let column=0;column<level.columns;column++){
  const path=level.id+'/'+column+'-'+row+'.webp',entry=await readTile(path);
  if(!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Invalid numerical DEM tile receipt: '+path);
  tiles[path]={bytes:entry.bytes,sha256:entry.sha256};digest.add(path,entry.sha256);
 }
 if(digest.finish(source.tint.sha256)!==source.assetsSha256)throw Error('Pinned numerical DEM asset digest differs');
 return {...source,urlTemplate:'terrain/v'+source.version+'/{level}/{column}-{row}.webp',tiles,
  packaging:{sourceRevision:revision,sourcePath:'terrain/v'+source.version+'/manifest.json',sourceSha256}};
}

export async function packageTerrainRuntime({root=resolve(fileURLToPath(new URL('../../',import.meta.url))),version='0.13.3'}={}){
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Explicit numerical DEM version required');
 const revision=libraryConfig(root).revision,checkout=libraryCheckout(root),prefix='terrain/v'+version;
 const git=args=>execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0',...args],{cwd:checkout,maxBuffer:16*1024*1024});
 const original=git(['show',revision+':'+prefix+'/manifest.json']),source=JSON.parse(original);validateTerrainManifest(source);
 const sourceTree=git(['rev-parse',revision+':'+prefix]).toString().trim();
 const records=git(['ls-tree','-r','-l',revision,'--',prefix]).toString().trim().split('\n').map(line=>{
  const match=/^100644 blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/.exec(line);
  if(!match)throw Error('Nonregular DEM source tree entry');return {oid:match[1],bytes:Number(match[2]),path:match[3]};
 });
 const selected=records.filter(item=>/\/\d+\/\d+-\d+\.webp$/.test(item.path));
 const bytes=selected.reduce((sum,item)=>sum+item.bytes,0),destination=resolve(root,'assets/data',prefix);
 const disk=statfsSync(libraryMaterializedRoot(root)),peakBytes=bytes*2;
 if(disk.bavail*disk.bsize<peakBytes+5*1024**3)throw Error('DEM packaging requires peak bytes plus 5 GiB headroom');
 if(existsSync(destination))throw Error('DEM runtime output already exists; inspect/reuse the existing scope');
 const result=await withLibraryOutputs({root,paths:[destination]},async()=>{
  // Extract only the six existing numeric tile directories. No archive file or
  // tint copy is produced; tar receives trusted paths verified from this Git tree.
  const paths=source.levels.map(level=>prefix+'/'+level.id);
  await new Promise((yes,no)=>{
   const archive=spawn('git',['archive','--format=tar',revision,...paths],{cwd:checkout,stdio:['ignore','pipe','pipe']});
   const unpack=spawn('tar',['-xf','-','-C',resolve(root,'assets/data')],{stdio:['pipe','ignore','pipe']});
   let failure='',remaining=2;const done=code=>{if(code!==0)failure+=' exit '+code;if(!--remaining)failure?no(Error('DEM byte import failed: '+failure)):yes();};
   archive.stdout.pipe(unpack.stdin);archive.stderr.on('data',x=>{failure+=x;});unpack.stderr.on('data',x=>{failure+=x;});
   archive.once('error',no);unpack.once('error',no);archive.once('close',done);unpack.once('close',done);
  });
  const manifest=await describeTerrainRuntime(source,{revision,sourceSha256:sha(original),readTile:async path=>{
   const file=resolve(destination,path);if(!file.startsWith(destination+String.fromCharCode(92))&&!file.startsWith(destination+'/'))throw Error('Unsafe DEM tile path');
   if(lstatSync(file).isSymbolicLink())throw Error('Linked DEM tile');return hashTerrainFile(file);
  }});
  const output=Buffer.from(JSON.stringify(manifest)+'\n');writeFileSync(resolve(destination,'manifest.json'),output,{flag:'wx'});
  return {sourceRevision:revision,sourceTree,sourceManifestSha256:sha(original),runtimeManifestSha256:sha(output),
   tiles:Object.keys(manifest.tiles).length,tileBytes:bytes,peakBytes,freeBytesBefore:disk.bavail*disk.bsize,
   output:'assets/data/'+prefix,excludedTintBytes:records.find(row=>row.path.endsWith('/tint.webp'))?.bytes||0};
 });
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 packageTerrainRuntime().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
}
