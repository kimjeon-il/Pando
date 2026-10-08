#!/usr/bin/env node
// Stage 9: a read-only Git-tree publication manifest and fail-closed Pages-size audit.
// Does not download old WebP/shard blobs, deploy, remove, rewrite, or serve any file.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeGitTree,PAGES_PUBLISHED_SITE_LIMIT_BYTES} from './plan-gis-archive-rollout.mjs';

const fail=(condition,message)=>{if(!condition)throw Error(message);};
const BYTES=PAGES_PUBLISHED_SITE_LIMIT_BYTES;
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const DATA='assets/data/';
const GDAL_WASM='assets/js/vendor/gdal/gdal3WebAssembly.wasm';
const GDAL_DATA='assets/js/vendor/gdal/gdal3WebAssembly.data';
const CURRENT_SOURCE='assets/data/territorial-entities/generated/current-world.geojson';
const STATIC_PREFIXES=['assets/js/','assets/css/','assets/fonts/','assets/vendor/'];
const CURRENT_PREFIXES=[
  'assets/data/hydro/v0.13.0/',
  'assets/data/hydro/v0.13.1/',
  'assets/data/terrain/v0.12.6/',
  'assets/data/territorial-entities/generated/',
  'assets/data/places/',
  'assets/data/world/'
];
const BOOTSTRAP_FILES=['index.html','.nojekyll'];
const COMPATIBILITY_FILES=[
  'assets/data/countries-preview-shared-v0.34.0.json.gz',
  'assets/data/countries-canonical-shared-v0.34.0.json.gz',
  'assets/data/country-label-anchors-v0.10.1.json'
];
const must=x=>{fail(typeof x==='string'&&!x.startsWith('/')&&!x.startsWith('../')&&
  !x.includes('\\')&&!x.includes('://')&&!x.includes('?')&&!x.includes('#'),
  'Invalid tracked data asset path '+x);return DATA+x;};
const json=path=>JSON.parse(readFileSync(resolve(path),'utf8'));
const sum=arr=>arr.reduce((s,x)=>s+x.bytes,0);

export function pinnedLegacyPaths(legacyManifest,nativeManifest){
  fail(legacyManifest?.version==='0.36.0' && legacyManifest.assets,
    'Expected version-pinned legacy world manifest');
  fail(nativeManifest?.schema==='pandoeditor-world-dataset' &&
    Number.isInteger(nativeManifest.version),'Invalid native App provenance');
  const required=new Set(BOOTSTRAP_FILES.concat(COMPATIBILITY_FILES));
  required.add(DATA+'world-preview-v0.36.0.json');
  const source=legacyManifest.source;
  if(source)required.add(must(source));
  for(const [role,a] of Object.entries(legacyManifest.assets)){
    fail(typeof a?.url==='string','Invalid pinned role '+role);
    required.add(must(a.url));
  }
  for(const [role,entry] of Object.entries(nativeManifest)){
    if(!entry||typeof entry!=='object'||typeof entry.path!=='string')continue;
    const src=entry.source?.path?.startsWith(DATA)?entry.source.path:must(entry.path);
    fail(typeof entry.gitBlobSha==='string'&&sha40(entry.gitBlobSha),'Missing native provenance '+role);
    required.add(src);
  }
  return [...required].sort();
}
export function validateArchiveLock(lock,mainTree,gisTree){
  fail(lock?.schema==='pandolab-gis-archive-delete-lock'&&lock.version===1&&
    sha40(lock.sourceCommit)&&Array.isArray(lock.files),'Missing exact Stage8 archive lock');
  fail(lock.totalFiles===lock.files.length&&lock.totalFiles===2124&&
    lock.totalBytes===564189000,'Unapproved change in immutable legacy URL inventory');
  const errors=[],seen=new Set(),seenGroups=new Set();
  for(const entry of lock.files){
    const p=entry.path;
    if(typeof p!=='string'||!p.startsWith(DATA)||seen.has(p))errors.push('Invalid duplicate archive path '+p);
    seen.add(p);seenGroups.add(entry.group);
    fail(sha40(entry.gitBlob)&&Number.isSafeInteger(entry.bytes),'Invalid archive Git metadata: '+p);
    for(const [label,tree] of [['main',mainTree],['gis',gisTree]]){
      const found=tree.get(p);
      if(!found||found.sha!==entry.gitBlob||found.bytes!==entry.bytes)
        errors.push('Locked URL path differs from '+label+': '+p);
    }
  }
  if(lock.groups!==seenGroups.size)errors.push('Archive group coverage mismatch');
  if(sum(lock.files)!==lock.totalBytes)errors.push('Archive byte total mismatch');
  fail(!errors.length,errors.slice(0,18).join('\n'));
  return {groups:lock.groups,files:lock.totalFiles,bytes:lock.totalBytes,verifiedBothTrees:true};
}
function staticCategory(p){
  return BOOTSTRAP_FILES.includes(p)?'bootstrap':
    STATIC_PREFIXES.some(root=>p.startsWith(root))?'app-static':null;
}
function generatedCategory(p){
  if(p.startsWith('assets/data/territorial-entities/generated/'))return 'historical-catalog-and-source';
  if(p.startsWith('assets/data/terrain/v0.12.6/'))return 'current-terrain';
  if(/^assets\/data\/hydro\/v0\.13\.[01]\//.test(p))return 'current-hydro';
  if(p.startsWith('assets/data/world/'))return 'content-hash-world-bridge';
  if(p.startsWith('assets/data/places/'))return 'places';
  return null;
}
export function buildPublicationProfile(tree,lock,required,{profile='main-legacy'}={}){
  fail(tree instanceof Map,'Pinned Git file map required');
  const chosen=new Map(),requiredPaths=new Set(required);
  const archive=new Set(lock.files.map(f=>f.path));
  function include(path,category,{required=false}={}){
    const m=tree.get(path);
    fail(!!m,'Missing '+category+' asset: '+path);
    if(!chosen.has(path))chosen.set(path,{path,gitBlob:m.sha,bytes:m.bytes,reason:category});
    if(required)requiredPaths.add(path);
  }
  for(const [path] of tree){
    const category=staticCategory(path)||generatedCategory(path);
    if(category)include(path,category);
  }
  for(const path of archive)include(path,'locked-public-legacy-url',{required:true});
  for(const path of required)include(path,'verified-world-and-native-pin',{required:true});
  // These are functional contracts, not discretionary trim targets.
  for(const path of ['assets/js/gis-io.js',GDAL_WASM,GDAL_DATA,
      'assets/data/hydro/v0.13.1/manifest.json',
      'assets/data/hydro/v0.13.0/index.bin.gz',
      'assets/data/terrain/v0.12.6/manifest.json',
      'assets/data/territorial-entities/generated/v2/index.json']){
    fail(chosen.has(path),'Mandatory Web/native runtime asset missing: '+path);
  }
  const files=[...chosen.values()].sort((a,b)=>a.path.localeCompare(b.path));
  const buckets=new Map();
  for(const f of files){
    const reason=archive.has(f.path)?'locked-public-legacy-url':f.reason;
    const b=buckets.get(reason)||{files:0,bytes:0};b.files++;b.bytes+=f.bytes;buckets.set(reason,b);
  }
  const excludedByPrefix=new Map();
  const broad=path=>{
    if(path.startsWith('assets/data/territorial-entities/source/'))return 'territorial-source-build-only';
    if(path.startsWith('assets/data/hydro/'))return 'hydro-name-and-build-sources';
    if(path.startsWith('assets/data/research/'))return 'gis-research-material';
    if(path.startsWith('assets/data/'))return 'other-data-source-or-legacy-url';
    if(path.startsWith('reports/'))return 'reports';
    if(path.startsWith('docs/'))return 'docs';
    if(path.startsWith('tools/'))return 'tools';
    if(path.startsWith('tests/'))return 'tests';
    if(path.startsWith('scripts/'))return 'scripts';
    return 'other-project-only';
  };
  for(const [path,m] of tree){
    if(chosen.has(path))continue;
    const bucket=broad(path),b=excludedByPrefix.get(bucket)||{files:0,bytes:0};
    b.files++;b.bytes+=m.bytes;excludedByPrefix.set(bucket,b);
  }
  const countGDAL=[GDAL_WASM,GDAL_DATA].reduce((n,p)=>n+(chosen.get(p)?.bytes||0),0);
  const mainSourceBytes=chosen.get(CURRENT_SOURCE)?.bytes||0;
  const bytes=sum(files);
  const risk=[
    {scenario:'full-functional-legacy-URLs',bytes,satisfiesPagesCap:bytes<=BYTES,
      wouldKeepAllCriticalWebFunctions:true,mayNotPreserveOtherPublicSourceURLs:true},
    {scenario:'omit-GDAL-WASM-and-DATA',bytes:bytes-countGDAL,
      satisfiesPagesCap:bytes-countGDAL<=BYTES,wouldBreakGISImport:true,
      approvedForDeployment:false},
    {scenario:'omit-GDAL-and-current-world-source',bytes:bytes-countGDAL-mainSourceBytes,
      satisfiesPagesCap:bytes-countGDAL-mainSourceBytes<=BYTES,
      wouldBreakGISImport:true,wouldBreakManifestSourceUrl:true,approvedForDeployment:false}
  ];
  const archiveIncluded=lock.files.filter(f=>chosen.get(f.path)?.gitBlob===f.gitBlob&&
    chosen.get(f.path)?.bytes===f.bytes).length;
  fail(archiveIncluded===lock.totalFiles,'Archive paths changed after profile selection');
  const rootFiles=BOOTSTRAP_FILES.every(p=>chosen.has(p));
  fail(rootFiles&&requiredPaths.size===required.length+archive.size-
    required.filter(p=>archive.has(p)).length,'Bootstrap or mandatory URL coverage incomplete');
  const sizeOver=bytes>BYTES;
  return {
    schema:'pandolab-stage9-publication-profile',version:1,name:profile,
    budget:{limitBytes:BYTES,includedBytes:bytes,overByBytes:Math.max(0,bytes-BYTES),
      underByBytes:Math.max(0,BYTES-bytes),withinLimit:!sizeOver},
    archive:{groups:lock.groups,files:archiveIncluded,bytes:lock.totalBytes,allOriginalBlobsPreserved:true},
    assetTotal:{files:files.length,bytes},
    breakdown:Object.fromEntries([...buckets].sort((a,b)=>a[0].localeCompare(b[0]))),
    excluded:Object.fromEntries([...excludedByPrefix].sort((a,b)=>a[0].localeCompare(b[0]))),
    excludedBytes:[...excludedByPrefix.values()].reduce((s,b)=>s+b.bytes,0),
    protectedFeatures:{
      nativePinsAndLegacyWorld:true,
      allHistoricalLibraryGenerated:true,
      fullGDALRuntime:countGDAL>0,
      gdalRuntimeBytes:countGDAL,
      worldSourceManifestBytes:mainSourceBytes,
      allListedPublicLegacyURLBytes:true
    },
    diagnosticOnlyAlternatives:risk,
    fileManifest:files
  };
}
export function finalStage9Plan(main,gis,lock,{mainSha,gisSha}={}){
  fail(sha40(mainSha)&&sha40(gisSha),'Both exact source heads required');
  fail(main.archive.files===2124&&gis.archive.files===2124,'Incomplete legacy URL coverage');
  const options=[main,gis].map(p=>({
    name:p.name,includedBytes:p.budget.includedBytes,
    overByBytes:p.budget.overByBytes,
    preserveLegacyCount:p.archive.files,
    eligibleForDeployment:p.budget.withinLimit&&false
  }));
  return {schema:'pandolab-stage9-pages-footprint',version:1,mainSha,gisSha,
    archiveSourceSha:lock.sourceCommit,
    archivePaths:lock.totalFiles,archiveBytes:lock.totalBytes,
    siteLimitBytes:BYTES,profiles:options,
    necessaryBeforeDeployment:[
      'Confirm Pages 1 GB includes generated site, not merely artifact tar.gz transfer bytes',
      'Find an approved, fully functional <=1GB site without losing 2124 old URLs, or approve another hosting/URL model',
      'Verify every publication path (including legacy 2124) matches immutable pre-cutover Git blob bytes',
      'Validate all asset access under the production origin and in real browsers',
      'Verify native releases and full Qt regression separately',
      'Authorize deployment cutover explicitly with rollback controls'
    ],
    eligibleForPagesCutover:false,eligibleForLegacyDeletion:false,
    writesPerformed:false,
    warning:'No static GitHub Pages artifact built/uploaded. Exact binary byte integrity beyond Git tree SHA requires a separate checkout and HTTP verification.'
  };
}
function parseArgs(argv){
  const map=new Map(),names=new Set(['--main-tree','--gis-tree','--archive-lock','--legacy-manifest',
    '--native-manifest','--main-sha','--gis-sha','--out','--main-files-out','--gis-files-out']);
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i],v=argv[i+1];
    fail(names.has(k)&&v&&!v.startsWith('--')&&!map.has(k),'Bad CLI argument '+k);
    map.set(k,v);
  }
  for(const k of names)fail(map.has(k),'Missing argument '+k);
  return map;
}
function save(path,obj){
  const f=resolve(path);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,JSON.stringify(obj,null,2)+'\n');
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const a=parseArgs(process.argv.slice(2));
    const main=normalizeGitTree(json(a.get('--main-tree'))),gis=normalizeGitTree(json(a.get('--gis-tree')));
    const lock=json(a.get('--archive-lock'));
    const confirmed=validateArchiveLock(lock,main,gis);
    const required=pinnedLegacyPaths(json(a.get('--legacy-manifest')),json(a.get('--native-manifest')));
    const old=buildPublicationProfile(main,lock,required,{profile:'main-current-publication'});
    const next=buildPublicationProfile(gis,lock,required,{profile:'gis-bundle-compatibility'});
    const plan=finalStage9Plan(old,next,lock,
      {mainSha:a.get('--main-sha'),gisSha:a.get('--gis-sha')});
    save(a.get('--out'),plan);
    save(a.get('--main-files-out'),old);
    save(a.get('--gis-files-out'),next);
    console.log(JSON.stringify({passed:true,archive:confirmed,
      main:old.budget,gis:next.budget,groupBreakdown:old.breakdown,
      alternatives:old.diagnosticOnlyAlternatives,
      approvedPagesCutover:false,approvedLegacyDeletion:false},null,2));
  }catch(error){console.error('Stage9 Pages publication footprint failed: '+error.stack);process.exitCode=1;}
}
