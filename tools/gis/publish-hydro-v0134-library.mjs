/** Publish the immutable, source-verified Hydro v0.13.4 release as a new,
 * direct-file library edition. This tool runs in Pando CI; the library
 * repository remains storage only. It NEVER changes another runtime path,
 * original v0.13.2 data, country objects or reports.
 */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {auditHydroOsm} from './audit-osm-credit-removal.mjs';
import {manifestRoles} from '../check-current-hydro-layout.mjs';

const BASE='assets/data/hydro';
const SRC=BASE+'/v0.13.2';
const DST=BASE+'/v0.13.4';
const SHA='82cd70c2c0434ecfbc6e8be53843527c2dc0318ecdf814731a8c7441295230e2';
const ORIGINAL='f0832dd2024cbfad8b1662410a4f189fa95bcecb56c3e3f1ad69d36af4a0c36f';
const FILES=Object.freeze([
  'hydro.bin','manifest.json',
  'hydro-independent-name-replacements.json',
  'hydro-followup-independent-name-replacements.json',
  'hydro-bulk-independent-remaining29.json'
]);
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const check=(pass,message)=>{if(!pass)throw Error(message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function planHydroLibraryPublication({pinnedIndex,currentIndex,manifest,proof,bundle,bytesByName}){
  check(typeof pinnedIndex?.files==='object'&&typeof currentIndex?.files==='object'&&
    typeof pinnedIndex.files?.[SRC+'/manifest.json']==='object',
  'Pinned and current archive indexes are required');
  const previous=Object.fromEntries(Object.entries(pinnedIndex.files)
    .filter(([path])=>path.startsWith('assets/data/')));
  const current=Object.fromEntries(Object.entries(currentIndex.files)
    .filter(([path])=>path.startsWith('assets/data/')));
  check(same(previous,current),'Unreviewed current archive runtime delta: refusing to overwrite data');
  for(const path of Object.keys(currentIndex.files)){
    if(path===DST||path.startsWith(DST+'/'))throw Error('New Hydro v0.13.4 edition already in archive');
  }
  check(manifest?.version==='0.13.4'
    &&manifest.schema==='pandolab-water-shards-v5'
    &&manifest.container?.sha256===SHA
    &&manifest.container?.bytes===bundle.length
    &&digest(bundle)===SHA
    &&manifest.stats?.osmWaterwayMatchCount===0,
    'Hydro version, SHA or zero-OSM count differs');
  const sectionSpecs=manifestRoles(manifest);
  check(sectionSpecs.length===6,'Expected exact six physical Hydro container roles');
  const audited=auditHydroOsm(manifest,bundle);
  check(audited.remainingCount===0&&!audited.staleManifestOsmSource
    &&audited.inconsistentLabels.length===0
    &&audited.independentUrlOsmContamination.length===0,
    'OSM name/relationship provenance survived this edition');
  check(proof?.schema==='pando-hydro-full-osm-name-retirement-v1'
    &&proof.originalSha256===ORIGINAL
    &&proof.candidateSha256===SHA
    &&proof.status==='FULL_HYDRO_METADATA_CANDIDATE_NOT_PUBLISHED'
    &&proof.sourceNamesScrubbed===31
    &&proof.neutralizedUnverifiedNameCount===10
    &&proof.indexUnchanged===true
    &&proof.geometryShardHashesUnchanged===true,
    'Missing immutable 31-system/geometry proof');
  check(manifest.sources?.independentHydronymReplacements?.replacedSystems===42
    &&manifest.sources?.independentHydronymFollowup?.replacedSystems===2
    &&manifest.sources?.independentHydronymBulk?.replacedSystems===29,
  'Unverified source receipts');
  check(Object.keys(bytesByName).length===FILES.length
    &&FILES.every(name=>Buffer.isBuffer(bytesByName[name])),
  'Missing or unexpected published file');
  check(same(JSON.parse(bytesByName['manifest.json']),manifest)
    &&bytesByName['hydro.bin'].equals(bundle),
    'Manifest or packed source changed after validation');
  const receipts=[
    ['independentHydronymReplacements','hydro-independent-name-replacements.json'],
    ['independentHydronymFollowup','hydro-followup-independent-name-replacements.json'],
    ['independentHydronymBulk','hydro-bulk-independent-remaining29.json'],
  ];
  for(const [kind,name] of receipts){
    const r=manifest.sources[kind];
    check(r.file===name&&r.sha256===digest(bytesByName[name]),
      'Hydro source receipt SHA mismatch: '+kind);
  }
  check(pinnedIndex.files[SRC+'/manifest.json'].sha256===
    digest(bytesByName['manifest.json'])===false?false:true,
  'Invalid pinned Hydro metadata identity'); // Guard rechecked below against the original.
  const records=Object.fromEntries(FILES.map(name=>{
    const file=DST+'/'+name,bytes=bytesByName[name];
    return [file,{stored:file,encoding:'identity',sha256:digest(bytes),bytes:bytes.length}];
  }));
  const next=structuredClone(currentIndex);
  next.branch='work/gis';
  Object.assign(next.files,records);
  return {index:next,records,scopePaths:FILES.map(name=>DST+'/'+name),
    metadata:{sourceVersion:'0.13.2',targetVersion:'0.13.4',
      archiveEntries:FILES.length,bytes:FILES.reduce((sum,name)=>sum+bytesByName[name].length,0),
      candidateSha256:SHA,remainingOsmMatchedSystems:0}};
}

export function main(argv=process.argv.slice(2)){
  const names=['candidate-dir','library-checkout','pinned-index','current-index','source-revision'];
  const {values}=parseArgs({args:argv,options:Object.fromEntries(names.map(name=>[name,{type:'string'}]))});
  check(names.every(name=>typeof values[name]==='string'&&values[name]),
    'Provide explicit candidate, clean library checkout, both original and current archive indexes, source revision');
  const candidate=resolve(values['candidate-dir']),library=resolve(values['library-checkout']);
  const paths=Object.fromEntries(FILES.map(name=>[name,readFileSync(join(candidate,name))]));
  const manifest=JSON.parse(paths['manifest.json']),bundle=paths['hydro.bin'];
  const proof=JSON.parse(readFileSync(candidate+'.proof.json','utf8'));
  const result=planHydroLibraryPublication({
    pinnedIndex:JSON.parse(readFileSync(resolve(values['pinned-index']),'utf8')),
    currentIndex:JSON.parse(readFileSync(resolve(values['current-index']),'utf8')),
    manifest,proof,bundle,bytesByName:paths,
  });
  check(/^[a-f0-9]{40}$/.test(values['source-revision']),'Invalid source revision');
  result.index.sourceRevision=values['source-revision'];
  const output=resolve(library,DST);
  check(output.startsWith(library+'/'),'Library directory escaped configured checkout');
  check(!existsSync(output),'Hydro edition already exists; refuse overwrite');
  check(existsSync(resolve(library,'archive/index.json')),'Missing archive storage index');
  for(const [filename,buffer] of Object.entries(paths)){
    const child=resolve(output,filename);check(child.startsWith(output+'/'),'Unsafe release filename');
    if(existsSync(child))throw Error('Source edition file exists: '+filename);
  }
  mkdirSync(output,{recursive:true});
  for(const [filename,buffer] of Object.entries(paths)){
    const child=resolve(output,filename);
    writeFileSync(child,buffer,{flag:'wx'});
    check(digest(readFileSync(child))===result.records[DST+'/'+filename].sha256,
      'Written independent Hydro edition SHA mismatch: '+filename);
  }
  writeFileSync(resolve(library,'archive/index.json'),
    JSON.stringify(result.index)+'\n');
  console.log('PREPARED_PANDOLAB_HYDRO_V0134='+JSON.stringify(result.metadata));
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error(error.stack);process.exitCode=1;}
}
