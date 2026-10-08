#!/usr/bin/env node
// Audits tracked Web GIS revisions without deleting files or reading large binary blobs.
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,posix,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
const versioned=/^v\d+\.\d+\.\d+$/;

export function parseGitDataTree(raw) {
  const records=new Map();
  for(const row of raw.toString('utf8').split('\0')) {
    if(!row)continue;
    const m=/^[0-7]{6} blob ([0-9a-f]{40})\s+(\d+)\tassets\/data\/(.+)$/.exec(row);
    requireThat(!!m,'Invalid git ls-tree entry: '+row.slice(0,120));
    requireThat(!records.has(m[3]),'Duplicate Git path: '+m[3]);
    records.set(m[3],{sha:m[1],bytes:Number(m[2])});
  }
  return records;
}
export function dataRelative(manifest,relative) {
  requireThat(typeof relative==='string' && relative.length>0 &&
    !relative.startsWith('/') && !relative.includes('\\') &&
    !/^[a-z]+:/i.test(relative) && !relative.includes('?') && !relative.includes('#'),
    'Unsafe dataset path '+relative);
  const result=posix.normalize(posix.join(posix.dirname(manifest),relative));
  requireThat(!result.startsWith('../') && result!=='..' && result!=='',
    'Dataset path traversal '+relative);
  return result;
}
export function groupOf(path) {
  let m=/^(terrain|hydro)\/(v\d+\.\d+\.\d+)\//.exec(path);
  if(m)return m[1]+'/'+m[2];
  m=/^(world-preview|countries-preview|countries-canonical|world-mesh-preview|world-mesh)-v(\d+\.\d+\.\d+)\./.exec(path);
  if(m)return m[1]+'/v'+m[2];
  if(path.startsWith('world/objects/'))return 'world/content-addressed';
  return null;
}
export function duplicateStats(records) {
  const blobs=new Map();
  for(const [path,m] of records) {
    if(!blobs.has(m.sha))blobs.set(m.sha,[]);
    blobs.get(m.sha).push({path,bytes:m.bytes});
  }
  const groups=[...blobs.values()].filter(rows=>rows.length>1);
  return {identicalBlobGroups:groups.length,nominalRepeatedFileBytes:groups.reduce((s,rows)=>s+rows[0].bytes*(rows.length-1),0),
    note:'Nominal checked-out file bytes only: Git already de-duplicates identical blobs internally'};
}
function argumentMap(argv) {
  const out=new Map();
  for(let i=0;i<argv.length;i+=2){
    requireThat(argv[i]?.startsWith('--') && argv[i+1] && !argv[i+1].startsWith('--') && !out.has(argv[i]),
      'Invalid CLI option '+argv[i]);
    requireThat(['--root','--app-manifest','--out'].includes(argv[i]),'Unknown CLI option '+argv[i]);
    out.set(argv[i],argv[i+1]);
  }
  return out;
}
export function audit(root,{appManifest=null}={}) {
  root=resolve(root);
  const tree=parseGitDataTree(execFileSync('git',['-C',root,'ls-tree','-r','-l','-z','HEAD','--','assets/data'],
    {maxBuffer:16*1024*1024}));
  const protectedPaths=new Map(),historicalPaths=new Map(),errors=[];
  function mark(path,reason,{historical=false,bytes=null}={}) {
    const record=tree.get(path);
    if(!record) {errors.push('Missing tracked dependency: '+path+' ('+reason+')');return;}
    if(bytes!==null && record.bytes!==bytes)errors.push('Wrong stored size '+path+
      ': '+record.bytes+' vs '+bytes+' ('+reason+')');
    const target=historical?historicalPaths:protectedPaths;
    if(!target.has(path))target.set(path,new Set());
    target.get(path).add(reason);
  }
  const read=(path)=>JSON.parse(readFileSync(join(root,'assets/data',path),'utf8'));
  const manifest=(path,reason,historical=false)=>{
    mark(path,reason,{historical});return read(path);
  };
  const current=manifest('world/current.json','runtime:world');
  const seed=manifest('world/build-input.json','build:world');
  requireThat(current.schema==='pandolab-world-bundle','Unexpected world bundle schema');
  mark(current.source.url,'runtime:world-source');
  for(const [key,asset] of Object.entries(current.assets||{}))
    mark(asset.url,'runtime:world:'+key,{bytes:asset.compressedBytes});
  for(const [key,p] of Object.entries(current.compatibility?.sharedBoundaries||{}))
    mark(p,'runtime:shared-boundary:'+key);
  mark(seed.canonicalSource,'build:canonical-source');
  const legacy=manifest(seed.legacyPreviewManifest,'build:pinned-legacy-preview');
  for(const [key,asset] of Object.entries(legacy.assets||{}))
    mark(asset.url,'build:pinned-legacy:'+key,{bytes:asset.compressedBytes});
  for(const [key,p] of Object.entries(seed.sharedBoundaries||{}))
    mark(p,'build:shared-boundary:'+key);
  const environment=readFileSync(join(root,'assets/js/modules/app-environment.js'),'utf8');
  const terrainModule=readFileSync(join(root,'assets/js/modules/terrain-manifest.js'),'utf8');
  const hv=/HYDRO_DATA_VERSION\s*=\s*['"]([\d.]+)['"]/.exec(environment);
  const tv=/TERRAIN_RASTER_VERSION\s*=\s*['"]([\d.]+)['"]/.exec(terrainModule);
  requireThat(!!hv && !!tv,'Cannot resolve current hydro/terrain dataset from runtime');
  const hydroPath='hydro/v'+hv[1]+'/manifest.json',terrainPath='terrain/v'+tv[1]+'/manifest.json';
  const buildMeta=readFileSync(join(root,'scripts/generate-build-metadata.mjs'),'utf8');
  requireThat(buildMeta.includes('assets/data/'+hydroPath) && buildMeta.includes('assets/data/'+terrainPath),
    'Runtime physical dataset and build metadata pins disagree');
  const hydro=manifest(hydroPath,'runtime:hydro');
  for(const [key,d] of [['index',hydro.index],['metadata-core',hydro.metadata?.core],['metadata-detail',hydro.metadata?.detail],
    ...(hydro.shards||[]).map(s=>['shard-'+s.id,s])]) {
    requireThat(typeof d?.url==='string' && Number.isSafeInteger(d.bytes),
      'Missing current hydro role '+key);
    mark(dataRelative(hydroPath,d.url),'runtime:hydro:'+key,{bytes:d.bytes});
  }
  const terrain=manifest(terrainPath,'runtime:terrain');
  requireThat(terrain.urlTemplate?.startsWith('terrain/v'+tv[1]+'/'),
    'Terrain manifest tile version differs from runtime');
  let terrainTiles=0;
  for(const level of terrain.levels||[]){
    requireThat(Number.isInteger(level.id)&&level.columns>0&&level.rows>0,'Invalid raster tile level');
    for(let x=0;x<level.columns;x++)for(let y=0;y<level.rows;y++){
      const tile=terrain.urlTemplate.replace('{level}',String(level.id))
        .replace('{column}',String(x)).replace('{row}',String(y));
      mark(tile,'runtime:terrain-tile');terrainTiles++;
    }
  }
  mark('places/manifest.json','runtime:places');
  mark('territorial-entities/generated/v2/index.json','runtime:history');
  // Every previous manifest is a historical release snapshot, not a proof of active runtime use.
  for(const path of tree.keys()) {
    if(/^world-preview-v\d+\.\d+\.\d+\.json$/.test(path) && path!==seed.legacyPreviewManifest){
      const version=path.match(/v\d+\.\d+\.\d+/)?.[0];
      const obj=manifest(path,'historical:world:'+version,true);
      for(const [role,a] of Object.entries(obj.assets||{}))
        if(a?.url)mark(a.url,'historical:world:'+version+':'+role,{historical:true,bytes:a.compressedBytes});
    }
    if(/^(hydro|terrain)\/v\d+\.\d+\.\d+\/manifest\.json$/.test(path)
      && ![hydroPath,terrainPath].includes(path))mark(path,'historical:physical-snapshot',{historical:true});
  }
  const externalPins=[];
  if(appManifest){
    const app=JSON.parse(readFileSync(resolve(appManifest),'utf8'));
    requireThat(app.schema==='pandoeditor-world-dataset','Invalid App native manifest');
    for(const [role,spec] of Object.entries(app)){
      if(!spec || typeof spec!=='object' || !spec.source?.path)continue;
      const web=spec.source.path;
      requireThat(web.startsWith('assets/data/'),'Unsafe external App source path: '+web);
      const path=web.slice('assets/data/'.length),got=tree.get(path);
      mark(path,'native-pin:'+role);
      if(got?.sha!==spec.gitBlobSha)errors.push('Native source Web Git Blob differs: '+role+': '+path);
      externalPins.push({role,path,webRef:spec.source.ref,blobMatchesCurrent:got?.sha===spec.gitBlobSha});
    }
  }
  // The code/test scan is informational only. Missing sparse-checkout text cannot authorize removal.
  const codeRefs=new Map(),scan={materialized:0,missingOrSkipped:0};
  const tracked=execFileSync('git',['-C',root,'ls-tree','-r','--name-only','-z','HEAD'],
    {maxBuffer:16*1024*1024}).toString('utf8').split('\0').filter(Boolean);
  const scanTargets=tracked.filter(p=>/^(assets\/js\/|scripts\/|tools\/|tests\/|\.github\/)/.test(p)
    && /\.(?:js|mjs|cjs|ts|py|json|yml|yaml|sh|md|html)$/.test(p)
    && !p.includes('/fixtures/') && !p.includes('/research/') && !p.includes('/historical-library/'));
  const knownGroups=[...new Set([...tree.keys()].map(groupOf).filter(Boolean))];
  for(const p of scanTargets){
    const source=join(root,p);
    if(!existsSync(source)){scan.missingOrSkipped++;continue;}
    const text=readFileSync(source,'utf8');scan.materialized++;
    for(const group of knownGroups){
      const [family,version]=group.split('/');
      if(!version || !versioned.test(version))continue;
      const re=family==='terrain'||family==='hydro'
        ? family+'/'+version
        : family+'-'+version;
      if(text.includes(re)){
        if(!codeRefs.has(group))codeRefs.set(group,[]);
        if(codeRefs.get(group).length<12)codeRefs.get(group).push(p);
      }
    }
  }
  const groups=new Map();
  for(const [path,record] of tree){
    const group=groupOf(path);if(!group)continue;
    if(!groups.has(group))groups.set(group,{group,files:0,bytes:0,runtimeOrBuildFiles:0,legacySnapshotFiles:0,appPinnedFiles:0});
    const g=groups.get(group);g.files++;g.bytes+=record.bytes;
    if(protectedPaths.has(path)){
      g.runtimeOrBuildFiles++;
      if([...protectedPaths.get(path)].some(x=>x.startsWith('native-pin:')))g.appPinnedFiles++;
    }
    if(historicalPaths.has(path))g.legacySnapshotFiles++;
  }
  const rows=[...groups.values()].sort((a,b)=>a.group.localeCompare(b.group)).map(g=>({
    ...g,codeOrTestReferences:codeRefs.get(g.group)||[],
    classification:g.runtimeOrBuildFiles?'retain-active-or-native':
      (codeRefs.has(g.group)?'retain-for-code-test-review':'archive-review-not-delete-ready')
  }));
  const currentMissing=errors.length>0;
  const report={schema:'pandolab-legacy-assets-audit',version:1,gitHead:
    execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    passed:!currentMissing,errors,
    metadata:{totalDataFiles:tree.size,totalDataBytes:[...tree.values()].reduce((s,x)=>s+x.bytes,0),
      currentTerrainVersion:tv[1],currentHydroVersion:hv[1],terrainTiles,activeFileCount:protectedPaths.size,
      oldManifestDependencies:historicalPaths.size,externalPins,sourceScan:scan,duplicates:duplicateStats(tree)},
    groups:rows,
    policy:'No files are delete-ready: historical snapshots require archive/access/consumer evidence first'};
  return report;
}
const run=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(run){
  try{
    const args=argumentMap(process.argv.slice(2));
    const report=audit(args.get('--root')||resolve(dirname(fileURLToPath(import.meta.url)),'..'),
      {appManifest:args.get('--app-manifest')});
    if(args.has('--out')){
      const dest=resolve(args.get('--out'));mkdirSync(dirname(dest),{recursive:true});
      writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
    }
    console.log(JSON.stringify({passed:report.passed,errors:report.errors,
      metadata:report.metadata,groups:report.groups},null,2));
    if(!report.passed)process.exitCode=1;
  }catch(error){console.error('Legacy assets audit failed: '+error.stack);process.exitCode=1;}
}
