#!/usr/bin/env node
/** Stage the approved 1922 Caspian physical-water assets from the native GEOS
 * rebuild; compare with already-published originals before allowing a private
 * candidate. Does not write to the pinned library or the web/app data mounts.
 */
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const SOURCE='assets/data/physical-land/v1/';
export const REQUIRED=['geometry.json.gz','caspian-1922-land.json.gz',
 'caspian-1922-water.json.gz','manifest.json'];
export const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
const verify=(value,message)=>{if(!value)throw Error(message);};
export function sourceGeometry(value) {
 if(value?.type==='FeatureCollection') {
   verify(value.features?.length===1,'Expected one approved source Feature');
   return sourceGeometry(value.features[0]);
 }
 if(value?.type==='Feature')return sourceGeometry(value.geometry);
 verify(['Polygon','MultiPolygon'].includes(value?.type)
   &&Array.isArray(value.coordinates)&&value.coordinates.length>0,
   'Expected archived physical source Polygon/MultiPolygon');
 return value;
}
export function oneHistoricalWater(geometry) {
 const water=sourceGeometry(geometry);
 if(water.type==='Polygon')return water;
 verify(water.coordinates.length===1,'Historic Caspian must be one water polygon');
 return {type:'Polygon',coordinates:water.coordinates[0]};
}
export function assetDigest(bytes){
 const compressed=Buffer.from(bytes),decoded=gunzipSync(compressed);
 return {encoding:'gzip',compressedBytes:compressed.length,
   decodedBytes:decoded.length,sha256:sha256(compressed)};
}
function pinnedAsset(root,name){
 const file=resolve(root,SOURCE+name);
 verify(existsSync(file),'Missing pinned physical asset: '+name);
 return readFileSync(file);
}
export function verifyPublishedPhysicalManifest(manifest,assets) {
 const versions=manifest?.historicalWaterbodies;
 verify(Array.isArray(versions)&&versions.length===1,
   'Expected one reviewed historical Caspian physical release');
 const row=versions[0];
 verify(row.id==='caspian-near1922-approved' &&row.referenceDate==='1922-12-30'
   &&row.validFrom==='1922-12-30'&&row.validTo==='1925-05-12'
   &&row.scope?.startsWith('Physical water presentation only, not a sovereignty subtraction'),
   'Unapproved historic water validity or sovereignty semantics');
 for(const role of ['land','water']){
   const expected=row[role],name='caspian-1922-'+role+'.json.gz';
   verify(expected?.url===SOURCE+name,
     'Unexpected physical asset URL: '+role);
   const actual=assetDigest(assets[name]);
   verify(expected.encoding===actual.encoding
     &&expected.compressedBytes===actual.compressedBytes
     &&expected.decodedBytes===actual.decodedBytes
     &&expected.sha256===actual.sha256,
     'Published historical '+role+' asset digest differs from manifest');
 }
 return row;
}
export function deterministicGzipJSON(geometry){
 const bytes=Buffer.from(JSON.stringify(geometry),'utf8');
 const compressed=gzipSync(bytes,{level:9,mtime:0});
 // Keep the original Python data-producer OS label (gzip mtime=0, OS=10).
 compressed[9]=10;
 return {compressed,decodedBytes:bytes.length,sha256:sha256(compressed)};
}
export function createPhysicalCandidates(result,manifest){
 const land=result.land,water=oneHistoricalWater(result.water);
 const data=new Map();
 for(const [role,geometry] of [['land',land],['water',water]]){
   const name='caspian-1922-'+role+'.json.gz';
   const bytes=deterministicGzipJSON(geometry);
   data.set(SOURCE+name,bytes.compressed);
 }
 const draft=structuredClone(manifest),revision=draft.historicalWaterbodies[0];
 for(const role of ['land','water']){
   const name=SOURCE+'caspian-1922-'+role+'.json.gz';
   const original=revision[role];
   const compressed=data.get(name);
   revision[role]={...original,...assetDigest(compressed)};
 }
 data.set(SOURCE+'manifest.json',Buffer.from(JSON.stringify(draft,null,2)+'\n'));
 return data;
}
export function validatePhysicalMetrics(m){
 verify(Number.isInteger(m?.unchangedFarPolygonCount)
   &&m.unchangedFarPolygonCount>=0
   &&(m.fullLandValid===true ||
     (m.modernFullLandValid===false &&m.fullLandValid===false &&
      m.preexistingGlobalInvalidityPreserved===true))
   &&m.unchangedFarGeometryPreserved===true
   &&m.patchedLandValid===true &&m.localLandValid===true
   &&typeof m.modernFullLandValid==='boolean' &&m.historicalWaterHoles===68
   &&Number.isFinite(m.modernWaterAreaKm2)
   &&Number.isFinite(m.historicalWaterAreaKm2)
   &&m.outsideRegionDifferenceSquareDegrees<=1e-12
   &&m.publishedSymmetricDifferenceSquareDegrees<=1e-12,
   'Native physical reconstruction differs from approved source geometry');
 return m;
}
export function validatePhysicalResult(result){
 verify(result?.land?.type==='MultiPolygon'&&result.land.coordinates.length>0,
   'Native physical reconstruction differs from approved source geometry');
 return validatePhysicalMetrics(result.metrics);
}
export function stagePhysicalCandidates(data,outputRoot){
 const destination=resolve(outputRoot);
 verify(!existsSync(destination),'Candidate staging directory must be new');
 mkdirSync(destination,{recursive:true});
 for(const [path,bytes] of data){
   const dest=resolve(destination,path);
   const rel=relative(destination,dest);
   verify(rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel),
     'Physical asset candidate escapes staging root');
   mkdirSync(dirname(dest),{recursive:true});
   writeFileSync(dest,bytes,{flag:'wx'});
 }
 return {outputRoot:destination,paths:[...data.keys()]};
}
export function reconstructPublishedCaspianPhysical({
 sourceRoot,display,output=null,binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,
}){
 verify(sourceRoot&&display,'Pinned physical source root and native display candidate required');
 verify(binary&&existsSync(binary),'Native GEOS/PROJ historical patch binary unavailable');
 const inputAssets=Object.fromEntries(REQUIRED.map(name=>[name,pinnedAsset(sourceRoot,name)]));
 const manifest=JSON.parse(inputAssets['manifest.json']);
 const approved=verifyPublishedPhysicalManifest(manifest,inputAssets);
 const sourceSha=Object.fromEntries(REQUIRED.map(name=>[name,sha256(inputAssets[name])]));
 const current=sourceGeometry(JSON.parse(gunzipSync(inputAssets['geometry.json.gz'])));
 const published=sourceGeometry(JSON.parse(gunzipSync(inputAssets['caspian-1922-land.json.gz'])));
 const existingWater=sourceGeometry(JSON.parse(gunzipSync(inputAssets['caspian-1922-water.json.gz'])));
 const generated=JSON.parse(readFileSync(resolve(display),'utf8'));
 const water=oneHistoricalWater(generated.water);
 verify(existingWater.type==='Polygon' &&existingWater.coordinates.length===69,
   'Expected approved 68-hole published water polygon');
 verify(water.coordinates.length===69,'Native approved water source changed hole count');
 const temp=mkdtempSync(join(tmpdir(),'pando-1922-physical-'));
 try{
   const request=join(temp,'request.json'),candidate=join(temp,'result.json');
   writeFileSync(request,JSON.stringify({
     modernLand:current,historicalWater:water,expectedWaterHoles:68,
     publishedHistoricalLand:published,
   }),{flag:'wx'});
   const response=spawnSync(binary,['--patch-caspian-physical',request,candidate],{
     encoding:'utf8',maxBuffer:3*1024*1024,
   });
   verify(!response.error&&response.status===0,
     'Native historical physical rebuild failed: '+
       (response.stderr||response.error?.message||response.status));
   const result=JSON.parse(readFileSync(candidate,'utf8'));
   const metrics=validatePhysicalResult(result);
   for(const name of REQUIRED)
     verify(sha256(pinnedAsset(sourceRoot,name))===sourceSha[name],
       'Pinned modern/historical physical source changed: '+name);
   let stage=null;
   if(output)stage=stagePhysicalCandidates(createPhysicalCandidates({
     land:result.land,water,
   },manifest),output);
   return {schema:'pando-1922-caspian-physical-replay-v1',
     referenceDate:approved.referenceDate,validFrom:approved.validFrom,
     validTo:approved.validTo,
     sourceSha256:sourceSha,metrics,stage,
     publishedGeometryDifferenceSquareDegrees:metrics.publishedSymmetricDifferenceSquareDegrees,
     modernPhysicalLandUnchanged:true,publishedHistoricalAssetsUnchanged:true,
     runtimePromoted:false};
 }finally{rmSync(temp,{recursive:true,force:true});}
}
export function main(argv=process.argv.slice(2)){
 let sourceRoot,display,stage;
 for(let i=0;i<argv.length;i++){
   if(argv[i]==='--source-root'&&argv[i+1]&&!sourceRoot)sourceRoot=argv[++i];
   else if(argv[i]==='--display'&&argv[i+1]&&!display)display=argv[++i];
   else if(argv[i]==='--stage'&&argv[i+1]&&!stage)stage=argv[++i];
   else throw Error('Usage: --source-root PINNED_ARCHIVE --display NATIVE_JSON [--stage PRIVATE_DIR]');
 }
 const proof=reconstructPublishedCaspianPhysical({sourceRoot,display,output:stage});
 console.log('USSR_1922_PHYSICAL_REPLAY='+JSON.stringify(proof));
 return proof;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){console.error('ussr-1922-physical: '+error.message);process.exitCode=1;}
}
