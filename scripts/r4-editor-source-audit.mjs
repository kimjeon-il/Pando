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
if(target.length!==153)throw Error('R4 expected 153 archived frontend sources, found '+target.length);
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
