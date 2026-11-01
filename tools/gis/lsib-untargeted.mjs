// Assemble the existing untargeted LSIB supplement from explicit in-memory inputs.
import {classifyLSIBExclusion} from './lsib-exclusion.mjs';
import {lsibLineBounds,readLSIBArchiveEvidence,readLSIBDisputedShape,readLSIBLines} from './lsib-source-native.mjs';
import {lsibSourceSupplement} from './lsib-targeted.mjs';
import {lstat,mkdir,readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {writeLibraryOutput} from '../library-data.mjs';
import {applyLSIBCountryPatches,classifyLSIBSpatial,extractLSIBSharedChains,mergeLSIBUnion,
  prepareLSIBNearestReplacements} from './lsib-screen-native.mjs';

const sourceId='dos-lsib-11.4';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=(a,b)=>[a,b].sort().join('/');
const protectedPairs=new Set([
  ['RUS','UKR'],['CHN','IND'],['CHN','BTN'],['IND','PAK'],['CHN','PAK'],
  ['ARM','AZE'],['ISR','SYR'],['ISR','LBN'],['ISR','PSE'],['ISR','PSX'],
  ['MAR','SAH'],['SDN','SSD'],['SDN','SDS'],['DEU','LUX'],['SRB','XKX'],
  ['CHN','HKG'],['CHN','MAC'],['PRK','KOR'],
].map(pair=>key(...pair)));
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');

export function prepareLSIBEvidence({archiveEvidence,records,disputes,disputeShp,disputeDbf}){
  if(!archiveEvidence||!Buffer.isBuffer(archiveEvidence.checksum)||!Buffer.isBuffer(archiveEvidence.readme)||
    !Array.isArray(records)||!Array.isArray(disputes)||!Buffer.isBuffer(disputeShp)||!Buffer.isBuffer(disputeDbf)||
    !['archiveSha256','innerArchiveSha256','shpSha256','dbfSha256'].every(key=>/^[a-f0-9]{64}$/.test(archiveEvidence[key]||'')))
    throw Error('Explicit LSIB evidence inputs required');
  const features=records.map(record=>({type:'Feature',properties:record.properties,geometry:record.geometry}));
  const masterText=JSON.stringify({type:'FeatureCollection',features})+'\n';
  if(Buffer.byteLength(masterText)>512*1024*1024)throw Error('LSIB master exceeds byte budget');
  const master=gzipSync(Buffer.from(masterText),{level:6});
  const provenance={sourceId,published:'2025-02-24',url:'https://data.geodata.state.gov/LSIB.zip',
    license:'US Government public release; see upstream metadata',archiveSha256:archiveEvidence.archiveSha256,
    innerArchiveSha256:archiveEvidence.innerArchiveSha256,shpSha256:archiveEvidence.shpSha256,dbfSha256:archiveEvidence.dbfSha256,
    masterSha256:sha(master),naturalEarthDisputes:{release:'v5.1.1',
      url:'https://github.com/nvkelso/natural-earth-vector/tree/v5.1.1/10m_cultural',shpSha256:sha(disputeShp),dbfSha256:sha(disputeDbf)},
    policy:'Existing attribution retained; special/disputed/joint/historical lines withheld; no guessed connectors.'};
  return new Map([
    ['upstream-checksums.txt',archiveEvidence.checksum],
    ['line-index.json',jsonBytes(records.map(record=>({properties:record.properties,bbox:lsibLineBounds(record.geometry)})))],
    ['upstream-readme.txt',archiveEvidence.readme],['boundaries.geojson.gz',master],
    ['ne-disputed-v5.1.1.geojson',jsonBytes({type:'FeatureCollection',features:disputes.map(row=>({type:'Feature',properties:row.properties,geometry:row.geometry}))})],
    ['provenance.json',jsonBytes(provenance)],
  ]);
}
async function classifySources(disputes,records,options){
  const flags=new Map(),limit=24*1024*1024,base=Buffer.byteLength(JSON.stringify({disputes,sources:[],chains:[],references:[]}));
  if(base>=limit)throw Error('LSIB disputed source exceeds native batch budget');
  let batch=[],size=base;
  async function flush(){
    if(!batch.length)return;
    const result=await classifyLSIBSpatial({disputes,sources:batch.map(record=>record.geometry),chains:[],references:[]},options);
    for(let i=0;i<batch.length;i++)flags.set(batch[i],result.disputed[i]);
    batch=[];size=base;
  }
  for(const record of records){
    const bytes=Buffer.byteLength(JSON.stringify(record.geometry))+1;
    if(bytes+base>=limit)throw Error('LSIB source line exceeds native batch budget');
    if(size+bytes>=limit)await flush();batch.push(record);size+=bytes;
  }
  await flush();return flags;
}

export async function buildLSIBUntargetedCandidate(request,options={}){
  options.signal?.throwIfAborted();
  const {records,disputes,entities,versions,inputHashes,sourceRevision}=request||{};
  if(!Array.isArray(records)||!Array.isArray(disputes)||!request.geometries||!entities||!versions||!inputHashes||typeof sourceRevision!=='string')
    throw Error('Explicit LSIB supplement inputs required');
  const geometries=structuredClone(request.geometries),shared=await extractLSIBSharedChains(geometries,options),byPair=new Map();
  for(const record of records){
    if(!record?.properties||!record.geometry)throw Error('Invalid LSIB source feature');
    const pair=key(record.properties.CC1_GENC3,record.properties.CC2_GENC3);
    if(!byPair.has(pair))byPair.set(pair,[]);byPair.get(pair).push(record);
  }
  const selected=shared.flatMap(row=>protectedPairs.has(row.countries.join('/'))?[]:(byPair.get(row.countries.join('/'))||[]));
  const flags=await classifySources(disputes,selected,options),report=[],applied=new Map(),changed=new Set(),reviewed=new Set();
  for(const row of [...shared].sort((a,b)=>a.countries.join('/').localeCompare(b.countries.join('/'),'en'))){
    options.signal?.throwIfAborted();
    const countries=row.countries,pair=countries.join('/'),matches=byPair.get(pair)||[];
    const entry={countries,bbox:lsibLineBounds(row.geometry),status:'withheld',segments:[],sourceLineIds:matches.map(item=>item.properties.ID)};
    if(!matches.length){entry.reason='no-matching-LSIB-country-pair';report.push(entry);continue;}
    for(const match of matches)reviewed.add(match.properties.ID);
    const disputed=protectedPairs.has(pair)||matches.some(match=>flags.get(match));
    const reason=matches.map(match=>classifyLSIBExclusion(match.properties,disputed)).find(Boolean);
    if(reason){entry.reason=reason;report.push(entry);continue;}
    const reference=await mergeLSIBUnion(matches.map(match=>match.geometry),options);
    const referenceParts=reference.type==='MultiLineString'?reference.coordinates:[reference.coordinates];
    const chains=row.geometry.type==='MultiLineString'?row.geometry.coordinates:[row.geometry.coordinates];
    let candidates=Object.fromEntries(countries.map(code=>[code,geometries[code]]));
    for(const chain of chains){
      const nearby=await prepareLSIBNearestReplacements(chain,referenceParts,options);
      const segment={old_length_degrees:nearby.oldLength};
      try{
        if(nearby.isRing)throw Error('Closed enclave chain requires separate ownership review');
        if(!nearby.nearbyCount)throw Error('No spatially corresponding source section');
        const proposals=nearby.results.filter(value=>value.value).map(value=>value.value);
        if(!proposals.length)throw Error('No safe intersection anchors; old chain retained');
        const proposal=proposals.reduce((best,value)=>value.replaced_length_degrees>best.replaced_length_degrees?value:best);
        if(proposal.source_length_degrees>Math.max(.02,proposal.replaced_length_degrees*5))
          throw Error('Reference detour correspondence requires review');
        candidates=await applyLSIBCountryPatches({geometries:candidates,patches:Object.fromEntries(countries.map(code=>
          [code,[{old:chain,replacement:proposal.coordinates}]]))},options);
        const {coordinates,...metrics}=proposal;Object.assign(segment,metrics,{status:'supplemented-between-intersections'});
      }catch(error){
        if(error.code&&!['LSIB_RING_REJECTED','LSIB_REPAIR_REJECTED'].includes(error.code))throw error;
        if(!error.code&&!['Closed enclave chain requires separate ownership review','No spatially corresponding source section',
          'No safe intersection anchors; old chain retained','Reference detour correspondence requires review'].includes(error.message))throw error;
        Object.assign(segment,{status:'withheld',reason:error.message});
      }
      entry.segments.push(segment);
    }
    const successful=entry.segments.filter(segment=>segment.status!=='withheld');
    if(successful.length){
      Object.assign(geometries,candidates);for(const code of countries){changed.add(code);
        if(!applied.has(code))applied.set(code,[]);
        applied.get(code).push({countries,sourceLineIds:entry.sourceLineIds,segments:successful});}
      entry.status='partially-supplemented';
    }else entry.reason='all-segments-withheld';
    report.push(entry);
  }
  for(const record of records)if(!reviewed.has(record.properties.ID)){
    const props=record.properties;report.push({countries:[props.CC1_GENC3,props.CC2_GENC3].sort(),status:'withheld',
      reason:classifyLSIBExclusion(props,false)||'no-existing-shared-country-chain',label:props.LABEL,notes:props.NOTES,sourceLineIds:[props.ID]});
  }
  const changes=[...changed].sort().map(code=>({entityId:entities[code].entityId,geometryVersionId:versions[code].versionId,
    inputFileSha256:inputHashes[code],sourceId:[...new Set([...versions[code].sourceId.split('+'),sourceId])].join('+'),
    sourceAttributions:[],geometry:geometries[code],supplement:{...lsibSourceSupplement('2025-02-24',.0004),boundaries:applied.get(code)}}));
  return {schemaVersion:1,sourceId,sourcePublished:'2025-02-24',sourceRevision,changes,boundaries:report};
}

export async function runLSIBUntargeted(request,options={}){
  const {root,archive,disputedDirectory,evidenceDirectory,output,binary,gdal}=request||{};
  if([root,archive,disputedDirectory,evidenceDirectory,output].some(value=>typeof value!=='string'||!value))
    throw Error('Explicit LSIB source and new output paths required');
  options.signal?.throwIfAborted();
  const rootPath=resolve(root),evidence=resolve(evidenceDirectory),outputPath=resolve(output);
  const names=['upstream-checksums.txt','line-index.json','upstream-readme.txt','boundaries.geojson.gz','ne-disputed-v5.1.1.geojson','provenance.json'];
  const paths=[outputPath,...names.map(name=>join(evidence,name))];
  if(new Set(paths).size!==paths.length)throw Error('LSIB output paths overlap');
  for(const path of paths){
    try{await lstat(path);const error=Error('EEXIST: LSIB output already exists: '+path);error.code='EEXIST';throw error;}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const readArchive=options.readArchiveEvidence||readLSIBArchiveEvidence,readLines=options.readLines||readLSIBLines;
  const readDisputed=options.readDisputedShape||readLSIBDisputedShape,common={binary,signal:options.signal};
  const archiveEvidence=await readArchive({archive,requirePinned:true},{signal:options.signal});
  const records=await readLines({archive,all:true,...(gdal?{binary:gdal}:{})},common);
  const disputeShp=await readFile(join(disputedDirectory,'ne-disputed.shp')),disputeDbf=await readFile(join(disputedDirectory,'ne-disputed.dbf'));
  const disputes=await readDisputed({shp:disputeShp,dbf:disputeDbf},common);
  const source=join(rootPath,'assets/data/territorial-entities/source');
  const view=JSON.parse(await readFile(join(source,'views/world.json'),'utf8'));
  if(!Array.isArray(view.selections))throw Error('Explicit current world selections required');
  const entities={},versions={},geometries={},inputHashes={};
  for(const selection of view.selections){
    options.signal?.throwIfAborted();
    if(typeof selection.entityId!=='string'||!/^state:[A-Z]{3}$/.test(selection.entityId))
      throw Error('Invalid current country identity');
    const bytes=await readFile(join(source,'countries',selection.entityId.replaceAll(':','-')+'.json'));
    const entity=JSON.parse(bytes),version=entity.geometryVersions.find(value=>value.versionId===selection.geometryVersionId);
    if(entity.entityId!==selection.entityId||!version||version.validTo!=null)throw Error('Historical display geometry is protected: '+selection.entityId);
    const code=entity.sourceInfo?.featureId;
    if(typeof code!=='string'||!code||Object.hasOwn(entities,code))throw Error('Duplicate or missing LSIB country identity');
    entities[code]={entityId:entity.entityId};versions[code]={versionId:version.versionId,sourceId:version.sourceId};
    geometries[code]=version.geometry;inputHashes[code]=sha(bytes);
  }
  const sourceRevision=JSON.parse(await readFile(join(rootPath,'config/library-data.json'),'utf8')).revision;
  const candidate=await buildLSIBUntargetedCandidate({records,disputes:disputes.map(row=>row.geometry),
    entities,versions,geometries,inputHashes,sourceRevision},common);
  const files=prepareLSIBEvidence({archiveEvidence,records,disputes,disputeShp,disputeDbf});
  options.signal?.throwIfAborted();await mkdir(evidence,{recursive:true});await mkdir(dirname(outputPath),{recursive:true});
  for(const [name,bytes] of files){options.signal?.throwIfAborted();writeLibraryOutput(join(evidence,name),bytes,{flag:'wx'});}
  options.signal?.throwIfAborted();writeLibraryOutput(outputPath,jsonBytes(candidate),{flag:'wx'});
  return {changedCountries:candidate.changes.length,supplementedPairs:candidate.boundaries.filter(row=>row.status!=='withheld').length,
    withheldEntries:candidate.boundaries.filter(row=>row.status==='withheld').length,output:outputPath};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const request={root:resolve(dirname(fileURLToPath(import.meta.url)),'../..'),output:'build-native/lsib-supplement/candidates.json'};
    const names={'--archive':'archive','--disputed-directory':'disputedDirectory','--evidence-directory':'evidenceDirectory','--output':'output'};
    for(let i=2;i<process.argv.length;i++){
      const name=names[process.argv[i]],value=process.argv[++i];if(!name||!value||value.startsWith('--'))throw Error('Expected LSIB source option and value');
      request[name]=value;
    }
    process.stdout.write(JSON.stringify(await runLSIBUntargeted(request))+'\n');
  }catch(error){process.stderr.write('lsib-untargeted: '+String(error.message)+'\n');process.exitCode=1;}
}
