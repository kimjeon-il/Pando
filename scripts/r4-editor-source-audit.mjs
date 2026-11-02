// R4 source-of-truth audit. This checker is read-only: no source files are changed.
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {posix,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRepository} from './plan-application-checks.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const slash=p=>p.replaceAll('\\','/');
const excluded=new Set(['node_modules','.git','.library-data','dist','target','build-native','.pnpm','.cache','gen','vendor']);
function walk(dir){
  if(!existsSync(resolve(root,dir)))return [];
  return readdirSync(resolve(root,dir),{withFileTypes:true}).flatMap(d=>{
    const p=slash(posix.join(dir,d.name));
    if(d.isDirectory())return excluded.has(d.name)?[]:walk(p);
    return d.isFile()?[p]:[];
  });
}
const target=[...walk('apps/editor/frontend'),...walk('apps/editor/templates')].sort();
const candidate=new Set(target);
if(target.length>153)throw Error('R4 retired frontend source tree expanded unexpectedly: '+target.length);
const sources=[
  ...walk('scripts'),...walk('tools'),...walk('tests'),
  ...walk('apps'),...walk('shared'),...walk('.github'),
  'package.json','eslint.config.js','playwright.config.js',
].filter(x=>!x.startsWith('apps/editor/frontend/')&&!x.startsWith('apps/editor/templates/')
  &&/\.(?:js|mjs|cjs|json|yml|yaml|html|toml)$/.test(x));
const repo=loadRepository(root);
const edges=new Map(target.map(f=>[f,[]])),broad=[],readers=[];
const getKind=path=>path.startsWith('tests/')
  ? (repo.owners.get(path)?.mode==='retired'?'retired-test'
     : repo.owners.get(path)?.mode==='manual'?'manual-test':'test')
  : path.startsWith('scripts/')?'script':path.startsWith('tools/')?'tool'
  : path.startsWith('.github/')?'workflow':path.startsWith('shared/')?'shared-runtime'
  : path.startsWith('apps/viewer/')?'viewer-runtime':'other';
for(const source of new Set(sources)){
  let body;
  try{body=readFileSync(resolve(root,source),'utf8');}catch{continue;}
  if(!body.includes('apps/editor/frontend/')&&!body.includes('apps/editor/templates/'))continue;
  const kind=getKind(source),found=new Set();
  for(const m of body.matchAll(/apps\/editor\/(?:frontend\/(?:js\/(?:modules|workers)\/)?[\w.-]+|templates\/[\w.-]+)/g)){
    const filename=m[0];
    if(candidate.has(filename))found.add(filename);
  }
  if(found.size)for(const filename of found)edges.get(filename).push({source,kind});
  else broad.push({source,kind});
  readers.push({source,kind,target:[...found]});
}
const count=type=>readers.filter(x=>x.kind===type).length;
const externallyUsed=[...edges].filter(([,v])=>v.length).map(([path,users])=>({path,
  tools:users.filter(x=>['tool','script','shared-runtime','viewer-runtime'].includes(x.kind)).map(x=>x.source),
  tests:users.filter(x=>x.kind==='test').map(x=>x.source),
  retired:users.filter(x=>x.kind==='retired-test').map(x=>x.source),
  other:users.filter(x=>!['tool','script','shared-runtime','viewer-runtime','test','retired-test'].includes(x.kind)).map(x=>x.source)
}));
const eligible=[...edges].filter(([,users])=>!users.length).map(([p])=>p);
const summary={
  candidateCount:target.length,
  directExternalConsumers:externallyUsed.length,
  unreferencedCandidates:eligible.length,
  consumerFiles:readers.length,
  sourceKinds:Object.fromEntries(['tool','script','test','retired-test','viewer-runtime','shared-runtime','workflow','other'].map(k=>[k,count(k)])),
  note:'Source contents may also import relative siblings within the retired tree; preserve the transitive closure of any real external owners.',
  directProduction:externallyUsed.filter(x=>x.tools.length).map(x=>({path:x.path,from:x.tools})),
  otherActiveTests:externallyUsed.filter(x=>x.tests.length).map(x=>({path:x.path,count:x.tests.length,from:x.tests.slice(0,9)})),
  unreferencedCandidates:eligible,
  broadInputs:broad,
};
console.log('R4_AUDIT_JSON_BEGIN');
console.log(JSON.stringify(summary,null,2));
console.log('R4_AUDIT_JSON_END');

// Candidate reachability from actively valuable historical GIS/Core validation.
// Historical editor-only tests are retired independently of product runtime.
const retainedDataModules=new Set([
  'territorial-library.js','territorial-index-entry.js','project-serializer.js',
  'exchange-adapter-registry.js','generic-feature-service.js',
  'cut-worker-preparation.js','river-territory-partition.js',
  'polygon-clipping-calculation.js','timeline-edit.js','territorial-geometry.js',
  'territorial-library-provenance.js',
]);
const retiredTestName = file=>/^tests\/(?:unit|browser)\//.test(file)&&
  /(?:^|\/)(?:app-|editor-|editing-|draft-|map-edit-|task-|workflow-layout|tool-controller|file-menu|color-picker|custom-color|overlay-scrollbars|project-ui|autosave-recovery|selection-ui|property-editor|edit-preview|geometry-rpc-consumers|persistence-service|surface-tabs|surface-metrics)/.test(file.split('/').at(-1));
const requiredModules =new Set(
  [...externallyUsed]
   .filter(x=>x.tools.length||x.tests.some(t=>!retiredTestName(t)))
   .map(x=>x.path)
   .filter(p=>!retainedDataModules.has(p.split('/').at(-1)))
);
const edgeRegex=/(?:from\s*|import\s*\(\s*|import\s*|new URL\(\s*)['"]([^'"]+)['"]/g;
const graph=new Map;
for(const old of target){
  const src=readFileSync(resolve(root,old),'utf8'),siblings=new Set;
  for(const m of src.matchAll(edgeRegex)){
    const imp=m[1].split(/[?#]/,1)[0];
    if(!imp.startsWith('.'))continue;
    const linked=posix.normalize(posix.join(posix.dirname(old),imp));
    if(candidate.has(linked))siblings.add(linked);
  }
  graph.set(old,[...siblings]);
}
const reachable=new Set;
function include(file){
  if(reachable.has(file))return;
  reachable.add(file);
  for(const dep of graph.get(file)||[])include(dep);
}
for(const f of requiredModules)include(f);
const removable=target.filter(p=>!reachable.has(p));
const precious=externallyUsed.filter(x=>reachable.has(x.path)&&x.tests.some(t=>!retiredTestName(t)))
 .map(x=>({path:x.path,activeTests:x.tests.filter(t=>!retiredTestName(t)).slice(0,5),total:x.tests.length}));
console.log('R4_REACHABILITY_BEGIN');
console.log(JSON.stringify({
  protectedRoots:requiredModules.size,
  protectedClosure:reachable.size,
  safeUnusedFiles:removable.length,
  portableDataContractFiles:[...retainedDataModules],
  removable,
  retainedByTests:precious,
},null,2));
console.log('R4_REACHABILITY_END');

