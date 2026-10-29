/** Prepare a source-verified metadata-only Hydro revision; never deploy it. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {basename,dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {gzipSync} from 'node:zlib';
import {readHydroMetadataSection} from '../inventory-osm-hydronyms.mjs';
import {validateIndependentHydronyms} from './hydro-independent-name-policy.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ensure=(condition,message)=>{if(!condition)throw Error(message);};
const resources=m=>[m.index,m.metadata.core,m.metadata.detail,...m.shards];
const uniqueUrls=review=>[...new Set(review.independentSources.map(source=>source.url))];
function prospectiveRealpath(path){
  try{return realpathSync(path);}catch(error){
    if(error.code!=='ENOENT')throw error;
    const parent=dirname(path);if(parent===path)throw error;
    return resolve(prospectiveRealpath(parent),basename(path));
  }
}
export function rewriteHydroNames({manifest,bundle,substitutions,sourceName,sourceBytes,lakeSubstitutions={}}) {
  ensure(manifest.version==='0.13.2'&&manifest.schema==='pandolab-water-shards-v5','This metadata-only revision is pinned to Hydro v0.13.2');
  ensure(Buffer.isBuffer(bundle)&&bundle.length===manifest.container.bytes&&sha(bundle)===manifest.container.sha256,'Hydro whole-bundle identity mismatch');
  const parts=resources(manifest).map(spec=>{
    ensure(spec.url===manifest.container.url,'Hydro resource unexpectedly outside original bundle');
    ensure(Number.isSafeInteger(spec.offset)&&Number.isSafeInteger(spec.bytes)&&spec.offset>=0&&spec.bytes>=0&&spec.offset+spec.bytes<=bundle.length,'Hydro source segment mismatch');
    const data=bundle.subarray(spec.offset,spec.offset+spec.bytes);ensure(sha(data)===spec.sha256,'Hydro source segment mismatch');return data;
  });
  const core=readHydroMetadataSection(bundle,manifest.metadata.core),detail=readHydroMetadataSection(bundle,manifest.metadata.detail);
  ensure(core.length===detail.length&&core.length===manifest.metadata.featureCount,'Metadata feature count mismatch');
  const oldDetail=new Map(detail.map(row=>[Number(row.fid),row]));
  ensure(oldDetail.size===detail.length,'Repeated detail feature IDs');
  const nextCore=structuredClone(core),nextDetail=structuredClone(detail),detailById=new Map(nextDetail.map(row=>[Number(row.fid),row]));
  const changes={},oldNames={},removed={},lakes={};
  for(const row of nextCore){
    const lake=lakeSubstitutions[row.awId];
    if(lake){ensure(row.category==='lake'&&row.name===lake.previousNameKo,'Original lake identity/name mismatch');row.name=lake.nameKo;lakes[row.awId]=(lakes[row.awId]||0)+1;}
    const id=String(row.systemId||''),review=substitutions[id];if(!review)continue;
    ensure(row.category==='river'&&row.awId===`hydro-system:${id}`,'Invalid published Hydro system ID for replacement');
    ensure([review.previousNameKo,review.nameKo].includes(row.name),`Original/approved name mismatch for ${id}`);
    if(Object.hasOwn(oldNames,id))ensure(oldNames[id]===row.name,`Fragment name divergence for ${id}`);else oldNames[id]=row.name;
    row.name=review.nameKo;row.mainstemNameKo=review.nameKo;
    const previous=oldDetail.get(Number(row.fid)),target=detailById.get(Number(row.fid));
    ensure(previous&&target,`Missing detail feature ${row.fid}`);
    removed[id]=(removed[id]||0)+['aliases','tributaryNames','osmRelationIds'].reduce((n,key)=>n+(previous[key]?.length||0),0);
    for(const key of ['aliases','tributaryNames','osmRelationIds'])delete target[key];
    const urls=uniqueUrls(review);
    ensure(urls.length&&urls.every(url=>typeof url==='string'&&!/openstreetmap|overpass/i.test(url)),`Non-independent source URL for ${id}`);
    target.independentSourceUrls=urls;
    if(Number(row.fragmentIndex)===0){if(review.aliases.length)target.aliases=[...review.aliases];if(review.tributaryNames.length)target.tributaryNames=[...review.tributaryNames];}
    if(String(target.source||'').includes('OSM waterway names'))target.source='HydroRIVERS 1.0 · independently verified river names';
    changes[id]=(changes[id]||0)+1;
  }
  ensure(Object.keys(changes).length===Object.keys(substitutions).length,'Missing reviewed source system from existing bundle');
  ensure(Object.keys(lakes).length===Object.keys(lakeSubstitutions).length,'Missing reviewed lake from existing bundle');
  const coreById=new Map(nextCore.map(row=>[Number(row.fid),row]));
  for(const row of nextDetail){
    const source=coreById.get(Number(row.fid));ensure(source,'Missing core feature ID');
    const review=substitutions[String(source.systemId||'')];if(!review)continue;
    ensure(JSON.stringify(row.independentSourceUrls)===JSON.stringify(uniqueUrls(review))&&!row.osmRelationIds?.length,'Unverified provenance survived replacement');
  }
  const encoded=rows=>gzipSync(Buffer.from(JSON.stringify({version:5,features:rows})),{level:9,mtime:0});
  const newParts=[...parts];newParts[1]=encoded(nextCore);newParts[2]=encoded(nextDetail);
  const updated=structuredClone(manifest);let offset=0;
  for(const [i,spec] of resources(updated).entries()){spec.offset=offset;spec.bytes=newParts[i].length;spec.sha256=sha(newParts[i]);offset+=spec.bytes;}
  const output=Buffer.concat(newParts);updated.container.bytes=offset;updated.container.sha256=sha(output);updated.stats.compressedBytes=offset;
  updated.cache.name='pandolab-water-v0.13.2-independent-'+sha(newParts[1]).slice(0,16);
  const total=Object.keys(substitutions).length,sourceHash=sha(sourceBytes);
  if(total)updated.sources.independentHydronymReplacements={file:sourceName,sha256:sourceHash,replacedSystems:total,geometryChanged:false};
  if(Object.keys(lakeSubstitutions).length)updated.sources.lakeNameCorrections={file:sourceName,sha256:sourceHash,names:lakeSubstitutions,geometryChanged:false};
  updated.stats.osmWaterwayMatchCount-=total;updated.sources.osmWaterways.matchedSystems-=total;updated.sources.nameEnrichment.osmMatches-=total;
  for(const region of updated.sources.hydroRivers){region.osmMatches-=Object.values(substitutions).filter(row=>row.hydroRiversRegion===region.datasetCode).length;ensure(region.osmMatches>=0,'OSM provenance regional count underflow');}
  ensure(Math.min(updated.stats.osmWaterwayMatchCount,updated.sources.osmWaterways.matchedSystems,updated.sources.nameEnrichment.osmMatches)>=0,'OSM aggregate count underflow');
  ensure(updated.sources.hydroRivers.reduce((sum,row)=>sum+row.osmMatches,0)===updated.stats.osmWaterwayMatchCount,'Regional OSM count mismatch');
  const renamed=Object.values(substitutions).filter(row=>row.nameKo!==row.previousNameKo).length;
  return {manifest:updated,bundle:output,proof:{changedSystemIds:Object.keys(changes).sort((a,b)=>Number(a)-Number(b)),
    changedCoreFragments:Object.values(changes).reduce((a,b)=>a+b,0),changedLakeFragments:lakes,originalNameBySystem:oldNames,
    removedOriginalAliasesTributariesRelations:removed,originalIndexSha256:sha(parts[0]),newIndexSha256:sha(newParts[0]),
    originalGeometryShardsSha256:parts.slice(3).map(sha),newGeometryShardsSha256:newParts.slice(3).map(sha),
    beforeBundleSha256:sha(bundle),afterBundleSha256:sha(output),remainingOsmMatchedSystems:updated.stats.osmWaterwayMatchCount,
    sourceIndependentSystemCount:total,renamedSystemCount:renamed,nameUnchangedSourceReplacementCount:total-renamed,runtimeDeployed:false}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:Object.fromEntries(['manifest','bundle','replacements','output-dir'].map(name=>[name,{type:'string'}]))});
    ensure(['manifest','bundle','replacements','output-dir'].every(name=>values[name]),'Usage: --manifest <path> --bundle <path> --replacements <path> --output-dir <new directory>');
    const out=resolve(values['output-dir']),sourceDir=realpathSync(dirname(resolve(values.bundle))),rel=relative(sourceDir,prospectiveRealpath(out));
    ensure(rel&& (rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)),'Staging must not touch original pinned Hydro assets');
    ensure(!['manifest.json','hydro.bin','proof.json'].includes(basename(values.replacements).toLowerCase()),'Replacement input name conflicts with staged output');
    const sourceBytes=readFileSync(values.replacements),substitutions=validateIndependentHydronyms(JSON.parse(sourceBytes));
    const result=rewriteHydroNames({manifest:JSON.parse(readFileSync(values.manifest)),bundle:readFileSync(values.bundle),substitutions,sourceName:basename(values.replacements),sourceBytes});
    mkdirSync(dirname(out),{recursive:true});mkdirSync(out); // exclusive: preserve existing staging outputs
    for(const [name,bytes] of [['manifest.json',JSON.stringify(result.manifest,null,2)+'\n'],['hydro.bin',result.bundle],
      [basename(values.replacements),sourceBytes],['proof.json',JSON.stringify(result.proof,null,2)+'\n']])writeFileSync(resolve(out,name),bytes,{flag:'wx'});
    console.log('HYDRO_NONOSM_PROOF='+JSON.stringify(result.proof));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
