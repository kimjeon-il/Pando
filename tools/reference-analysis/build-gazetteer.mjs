import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {buildGazetteerFiles} from '../../plugins/pando-map-tools/lib/analysis/gazetteer.mjs';
import {parseRow,fileHash} from '../lib/geonames-policy.mjs';
import {zipTextLines} from '../lib/geonames-zip.mjs';
import {reportArgument} from '../report-paths.mjs';
import {createHash} from 'node:crypto';
import {referenceImagePlaceNames} from '../../plugins/pando-map-tools/lib/analysis/place-match.mjs';
import {regularResourcePath} from '../../plugins/pando-map-tools/lib/runtime.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function buildGazetteer({source,metadata,output,historicalCatalog,replaceRevision}) {
  const spec=JSON.parse(await readFile(metadata,'utf8'));
  if(spec.member!=='cities500.txt'||spec.sha256!==await fileHash(source)||!spec.license)throw Error('Verified cities500 original required');
  let previous=null;
  try{if((await lstat(output)).isSymbolicLink())throw Error('Gazetteer destination must not be a link');previous=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
    if(!replaceRevision||previous.revision!==replaceRevision)throw Error('Gazetteer destination already exists or replacement identity differs');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const rows=[];
  for await(const line of zipTextLines(source,spec.member)){
    const [row]=parseRow(line);if(row.featureClass!=='P')continue;
    rows.push({id:'geonames:'+row.geonameId,name:row.name,aliases:[row.asciiName,...line.split('\t')[3].split(',')].filter(Boolean),
      coordinates:[row.longitude,row.latitude],population:row.population,countryCode:row.countryCode,featureCode:row.featureCode,source:'geonames',kind:'city'});
  }
  if(historicalCatalog){
    const bytes=await readFile(historicalCatalog),catalog=JSON.parse(bytes);
    if(catalog.schema!=='pando-builtin-place-release-v1'||catalog.status!=='curated-verified-city-runtime-input')throw Error('Verified current historical-name catalog required');
    const byId=new Map(rows.map(row=>[row.id,row]));
    for(const place of catalog.records){
      const id='geonames:'+place.sourceId,old=byId.get(id);
      const row=old||{id,name:place.name,aliases:[],coordinates:place.coordinates,countryCode:place.countryCode,population:0,kind:place.kind};
      row.aliases=[...new Set([...row.aliases,...referenceImagePlaceNames(place).map(value=>value.text)])];
      row.nameTimeline=place.nameTimeline;row.historicalEvidence={catalogSha256:hash(bytes),reviewFile:place.reviewFile};
      if(!old)rows.push(row);
    }
    spec.historicalCatalog={sha256:hash(bytes),source:catalog.generatedFrom,approval:catalog.approval};
  }
  const {files,manifest}=buildGazetteerFiles(rows,spec);
  if(previous){
    if(Object.keys(previous.files).some(path=>!files.has(path)))throw Error('Replacement would retire shards; use explicit verified cleanup first');
    for(const [path,old]of Object.entries(previous.files))if(hash(await readFile(await regularResourcePath(output,path)))!==old.sha256)throw Error('Existing generated shard changed; refusing replacement');
  }
  await mkdir(output,{recursive:true});
  for(const [path,bytes]of files){if(previous?.files[path]?.sha256===manifest.files[path].sha256)continue;await mkdir(join(output,path.split('/')[0]),{recursive:true});await writeFile(join(output,path),bytes,{flag:previous?.files[path]?'w':'wx'});}
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:previous?'w':'wx'});
  return {records:manifest.recordCount,aliases:manifest.aliasCount,files:files.size,bytes:[...files.values()].reduce((sum,v)=>sum+v.length,0),revision:manifest.revision};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{source:{type:'string'},metadata:{type:'string'},output:{type:'string'},'historical-catalog':{type:'string'},'replace-revision':{type:'string'}}});
  for(const key of ['source','metadata','output']){if(!values[key])throw Error('--'+key+' required');values[key]=reportArgument(values[key],{access:key==='output'?'write':'read'});}
  console.log(await buildGazetteer({...values,historicalCatalog:values['historical-catalog'],replaceRevision:values['replace-revision']}));
}
