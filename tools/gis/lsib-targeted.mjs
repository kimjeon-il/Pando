// Assemble explicitly reviewed LSIB candidates without modifying source data.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {classifyLSIBExclusion} from './lsib-exclusion.mjs';
import {loadLSIBReviewedSource} from './lsib-reviewed-source.mjs';
import {mergeLSIBUnion,prepareLSIBCoast,prepareLSIBEnclave,prepareLSIBTripoint} from './lsib-screen-native.mjs';

const sourceId='dos-lsib-11.4', tolerance=.0004, scale=2560*64/360;
const plans={
  'AUT/LIE':{pair:['AUT','LIE'],junctionCountry:'CHE'},
  'AND/FRA':{pair:['AND','FRA'],junctionCountry:'ESP'},
  'ITA/SMR':{pair:['ITA','SMR'],enclave:'SMR'},
  'ITA/VAT':{pair:['ITA','VAT'],enclave:'VAT',simplify:false},
  'LSO/ZAF':{pair:['LSO','ZAF'],enclave:'LSO'},
  'FRA/MCO':{pair:['FRA','MCO'],coastal:'MCO',simplify:false},
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=(a,b)=>[a,b].sort().join('/');
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const required=(object,keys)=>Object.fromEntries(keys.map(name=>{
  if(!Object.hasOwn(object,name))throw Error('Missing reviewed source metadata: '+name);
  return [name,object[name]];
}));
const supplement=(published,t)=>({sourceId,published,effectiveDateEstablished:false,status:'provisional-modern-source-supplement',
  coastline:'unchanged',sourceFile:'tools/historical-library/sources/lsib-11.4/boundaries.geojson.gz',
  simplificationToleranceDegrees:t,simplificationMaximumPx:t*scale,screenBaseline:{widthCssPx:2560,flatZoom:64},historicalAccuracyVerified:false});

export async function buildLSIBTargetedCandidate({root,targets,referenceManifest,coastManifest,binary},{signal}={}){
  signal?.throwIfAborted();
  if(typeof root!=='string'||!Array.isArray(targets)||!targets.length)throw Error('An explicitly reviewed boundary target is required');
  root=resolve(root);targets=[...new Set(targets)];
  if(targets.some(target=>!Object.hasOwn(plans,target)))throw Error('An explicitly reviewed boundary target is required');
  const selected=targets.map(target=>plans[target]),codes=new Set(),pairs=new Set();
  for(const plan of selected){
    for(const code of plan.pair)codes.add(code);pairs.add(key(...plan.pair));
    if(plan.junctionCountry){codes.add(plan.junctionCountry);for(const code of plan.pair)pairs.add(key(code,plan.junctionCountry));}
  }
  const evidence=resolve(root,'tools/historical-library/sources/lsib-11.4'),source=resolve(root,'assets/data/territorial-entities/source');
  const provenance=await readJSON(resolve(evidence,'provenance.json')),raw=await readFile(resolve(evidence,'boundaries.geojson.gz'));
  if(sha(raw)!==provenance.masterSha256)throw Error('LSIB master differs from pinned evidence');
  const records=JSON.parse(gunzipSync(raw,{maxOutputLength:256*1024*1024}).toString('utf8')).features;
  if(!Array.isArray(records))throw Error('Invalid LSIB master features');
  const view=await readJSON(resolve(source,'views/world.json')),selections=new Map(view.selections.map(row=>[row.entityId,row.geometryVersionId]));
  const entities={},versions={},geometries={},hashes={};
  for(const code of [...codes].sort()){
    signal?.throwIfAborted();const bytes=await readFile(resolve(source,'countries',`state-${code}.json`)),entity=JSON.parse(bytes.toString('utf8'));
    const version=entity.geometryVersions.find(value=>value.versionId===selections.get(entity.entityId));
    if(entity.sourceInfo?.featureId!==code||!version||version.validTo!=null)throw Error(`Historical or mismatched source must not be overwritten: ${code}`);
    entities[code]=entity;versions[code]=version;geometries[code]=version.geometry;hashes[code]=sha(bytes);
  }
  const references=new Map(),ids=new Map(),options={binary,signal};
  for(const pair of [...pairs].sort()){
    const rows=records.filter(record=>key(record.properties.CC1_GENC3,record.properties.CC2_GENC3)===pair);
    if(!rows.length||rows.some(row=>classifyLSIBExclusion(row.properties,false)))throw Error('Missing or protected reference: '+pair);
    references.set(pair,await mergeLSIBUnion(rows.map(row=>row.geometry),options));ids.set(pair,rows.map(row=>row.properties.ID));
  }
  const overrides=new Map();
  if(referenceManifest){
    const {lines,...metadata}=await loadLSIBReviewedSource({root,manifestPath:referenceManifest,binary},{signal});
    const pair=metadata.countries.join('/');
    if(!targets.includes(pair))throw Error('Reviewed reference target was not explicitly selected');
    if(metadata.sourceId!=='igm-dbsn-2025-06-27'||!lines.igm||!metadata.transformation)throw Error('Invalid reviewed IGM validation receipt');
    references.set(pair,{type:'LineString',coordinates:lines.igm});ids.set(pair,[metadata.featureGlobalId]);overrides.set(pair,metadata);
  }
  let coastMetadata=null,coasts=null;
  if(coastManifest){
    if(!targets.includes('FRA/MCO'))throw Error('Reviewed coast target was not explicitly selected');
    const {lines,...metadata}=await loadLSIBReviewedSource({root,manifestPath:coastManifest,binary},{signal});
    if(metadata.sourceId!=='ign-bdtopo-v3-monaco-coast')throw Error('Invalid reviewed coast validation receipt');
    coasts=lines;coastMetadata=metadata;
  }else if(selected.some(plan=>plan.coastal))throw Error('FRA/MCO requires a pinned reviewed coast manifest');
  const updated=structuredClone(geometries),sections=[],coastReviews={};
  for(let i=0;i<targets.length;i++){
    const target=targets[i],plan=selected[i],pair=plan.pair,reference=references.get(target);
    const countryCodes=plan.junctionCountry?[...pair,plan.junctionCountry]:pair;
    const subset=Object.fromEntries(countryCodes.map(code=>[code,updated[code]]));let receipt,status;
    if(plan.coastal){
      if(reference.type!=='LineString')throw Error('Coastal land reference must be one simple open line');
      receipt=await prepareLSIBCoast({geometries:subset,reference:reference.coordinates,coasts},options);
      coastReviews[target]=receipt.review;status='supplemented-with-reviewed-coast';
    }else if(plan.junctionCountry){
      const needed=[target,...pair.map(code=>key(code,plan.junctionCountry))];
      receipt=await prepareLSIBTripoint({geometries:subset,references:needed.map(name=>({countries:name.split('/'),geometry:references.get(name)})),
        pair,third:plan.junctionCountry},options);status='supplemented-with-reviewed-tripoints';
    }else{
      if(reference.type!=='LineString')throw Error('Enclave reference must be one simple closed ring');
      receipt=await prepareLSIBEnclave({geometries:subset,reference:reference.coordinates,pair,enclave:plan.enclave,
        simplify:overrides.has(target)?false:plan.simplify!==false},options);status='supplemented-with-reviewed-enclave';
    }
    Object.assign(updated,receipt.geometries);
    sections.push(...receipt.sections.map(section=>({...section,target,status})));
  }
  const boundaries=sections.map(section=>{
    const {countries,...segment}=section;
    const entry={countries,sourceLineIds:section.kind==='coastline'?[coastMetadata.features[section.referenceRole]]:ids.get(countries.join('/')),
      status:section.status,segments:[segment]};
    if(section.kind==='coastline')Object.assign(entry,{kind:'coastline',referenceRole:section.referenceRole,
      sourceId:coastMetadata.sourceId,referenceManifest:coastMetadata.referenceManifest});
    else {
      const metadata=overrides.get(countries.join('/'));entry.sourceId=metadata?.sourceId||sourceId;
      if(metadata)entry.referenceManifest=metadata.referenceManifest;
    }
    return entry;
  });
  const changes=[];
  for(const code of Object.keys(updated).sort()){
    const relevant=selected.map((plan,i)=>[targets[i],plan]).filter(([,plan])=>plan.pair.includes(code)||plan.junctionCountry===code);
    const t=relevant.some(([target,plan])=>plan.simplify!==false&&!overrides.has(target))?tolerance:0;
    const existing=versions[code].modernBoundarySupplement||{};
    const info={...supplement(provenance.published,t),...structuredClone(existing)};
    const fullPairs=new Set(relevant.map(([,plan])=>plan.pair.join('/')));
    info.boundaries=(info.boundaries||[]).filter(entry=>!fullPairs.has(entry.countries.join('/')));
    info.boundaries.push(...boundaries.filter(entry=>entry.countries.includes(code)));
    for(const [,plan] of relevant)if(plan.junctionCountry)info.reviewedTripointRepair={target:plan.pair,junctionCountry:plan.junctionCountry,
      historicalAccuracyVerified:false,effectiveDateEstablished:false};
    info.reviewedBoundaryRepairs=[...(info.reviewedBoundaryRepairs||[]),...relevant.map(([target])=>({target,historicalAccuracyVerified:false,effectiveDateEstablished:false}))];
    const sourceIds=new Set(versions[code].sourceId.split('+'));
    for(const entry of boundaries)if(entry.countries.includes(code))sourceIds.add(entry.sourceId);
    const attributions=[];
    for(const [pair,metadata] of overrides)if(pair.split('/').includes(code))attributions.push(required(metadata,
      ['sourceId','title','published','url','license','licenseUrl','attribution','sourceFile']));
    if(attributions.length){
      info.sourceId=[...sourceIds].filter(value=>value!=='natural-earth-5.1.1').join('+');
      if(attributions.some(value=>typeof value.published!=='string'))throw Error('Reviewed source publication date required');
      info.published=[info.published,...attributions.map(value=>value.published)].sort().at(-1);
      info.additionalSources=[...(info.additionalSources||[]),...attributions];
      if(!versions[code].modernBoundarySupplement)info.sourceFile=attributions[0].sourceFile;
    }
    if(coastMetadata&&['FRA','MCO'].includes(code)){
      const attribution=required(coastMetadata,['sourceId','title','published','url','license','licenseUrl','attribution','sourceFile','retrieved','lastModified','confirmed']);
      attributions.push(attribution);Object.assign(info,{coastline:'reviewed-ign-replacement',
        coastlineReview:{referenceManifest:coastMetadata.referenceManifest,sourceId:coastMetadata.sourceId,effectiveDateEstablished:false,historicalAccuracyVerified:false},
        sourceId:[...sourceIds].filter(value=>value!=='natural-earth-5.1.1').join('+')});
      info.additionalSources=[...(info.additionalSources||[]),attribution];
    }
    changes.push({entityId:entities[code].entityId,geometryVersionId:versions[code].versionId,inputFileSha256:hashes[code],
      sourceId:[...sourceIds].join('+'),sourceAttributions:attributions,geometry:updated[code],supplement:info});
  }
  const result={schemaVersion:1,sourceId,sourcePublished:provenance.published,
    sourceRevision:(await readJSON(resolve(root,'config/library-data.json'))).revision,changes,boundaries};
  if(Object.keys(coastReviews).length)result.coastReviews=coastReviews;
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--stream')throw Error('Expected --stream');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>1024*1024)throw Error('LSIB candidate request exceeds byte budget');chunks.push(chunk);}
    process.stdout.write(JSON.stringify(await buildLSIBTargetedCandidate(JSON.parse(Buffer.concat(chunks,size).toString('utf8'))))+'\n');
  }catch(error){process.stderr.write('lsib-targeted: '+String(error.message)+'\n');process.exitCode=1;}
}
