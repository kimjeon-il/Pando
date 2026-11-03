// R4-E0: deterministic, read-only inventory of the unshipped editor.
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {posix,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseJavaScript} from './lib/source-analysis.mjs';
import {loadRepository} from './plan-application-checks.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const LEDGER='docs/development/r4e0-source-dispositions.json';
const PRUNING='docs/development/r4-source-pruning.json';
const PREFIX='apps/editor/frontend/';
const excluded=new Set(['.git','node_modules','.library-data','dist','target',
  'build-native','.pnpm','.cache','gen','vendor','.next','coverage','test-results']);
const text=path=>readFileSync(resolve(ROOT,path),'utf8');
const sorted=values=>[...values].sort((a,b)=>a.localeCompare(b));
function walk(directory){
 if(!existsSync(resolve(ROOT,directory)))return [];
 return readdirSync(resolve(ROOT,directory),{withFileTypes:true}).flatMap(entry=>{
   const path=posix.join(directory,entry.name);
   if(entry.isDirectory())return excluded.has(entry.name)?[]:walk(path);
   return entry.isFile()?[path]:[];
 });
}
const isLegacy=path=>path.startsWith(PREFIX)||path.startsWith('apps/editor/templates/');
function sourceOwner(file,repo){
 if(isLegacy(file))return 'legacy-editor';
 if(file.startsWith('docs/'))return 'documentation';
 if(file.startsWith('.github/workflows/'))return 'workflow';
 if(file.startsWith('config/')||file.endsWith('.json'))return 'policy';
 if(file.startsWith('apps/viewer/'))return 'viewer-runtime';
 if(file.startsWith('shared/frontend/'))return 'shared-runtime';
 if(file.startsWith('apps/editor/src-tauri/'))return 'windows-runtime';
 if(file.startsWith('tools/'))return 'gis-or-build-tool';
 if(file.startsWith('scripts/'))return 'script';
 if(file.startsWith('tests/unit/')||file.startsWith('tests/browser/')){
   const mode=repo.owners.get(file)?.mode;
   return mode==='retired'?'retired-test':mode==='manual'?'manual-test':'active-test';
 }
 if(file.startsWith('tests/')||file.startsWith('apps/editor/tests/'))return 'test-helper';
 return 'other';
}
const simpleLiteral=node=>{
 if(node?.type==='Literal'&&typeof node.value==='string')return node.value;
 if(node?.type!=='TemplateLiteral')return null;
 const prefix=node.quasis?.[0]?.value?.cooked||'';
 // Only a query/hash cache buster may be dynamic. Never guess a variable file name.
 if(node.expressions?.length&&!/\.(?:m?js|html|json)[?#]/.test(prefix))return null;
 return prefix.split(/[?#]/)[0];
};
const calleeName=node=>node?.type==='Identifier'?node.name:node?.type==='MemberExpression'?node.property?.name:null;
function resolveLiteral(file,value){
 if(typeof value!=='string')return null;
 const path=value.replaceAll('\\','/').split(/[?#]/)[0];
 if(path.startsWith('apps/editor/frontend/')||path.startsWith('apps/editor/templates/'))return path;
 if(path.startsWith('/apps/editor/frontend/')||path.startsWith('/apps/editor/templates/'))return path.slice(1);
 if(path.startsWith('.'))return posix.normalize(posix.join(posix.dirname(file),path));
 return null;
}
function references(file,body,known){
 const list=[],unresolved=[];
 const emit=(literal,kind,line=null)=>{
   const target=resolveLiteral(file,literal);
   if(!known.has(target))return;
   list.push({target,kind,line:line||1});
 };
 const sourceLines=body.split('\n');
 const lineAt=at=>body.slice(0,Math.max(0,at)).split('\n').length;
 if(/\.(?:m?js|cjs)$/.test(file)){
  let parsed;
  try{parsed=parseJavaScript(body,{filePath:file,sourceType:file.endsWith('.cjs')?'script':'module'});}
  catch(e){if(isLegacy(file))throw Error('Archived source failed to parse: '+file+': '+e.message);parsed=null;}
  if(parsed){
   const visit=(node,ancestors=[])=>{
     if(!node||!node.type)return;
     const stack=[...ancestors,node],row=lineAt(node.range?.[0]||0);
     const value=node.source&&simpleLiteral(node.source);
     if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&value)
       emit(value,node.type==='ImportDeclaration'?'static-import':'re-export',row);
     if(node.type==='ImportExpression'){
       const valueNode=node.source?.type==='NewExpression'&&calleeName(node.source.callee)==='URL'
         ?node.source.arguments?.[0]:node.source;
       const literal=simpleLiteral(valueNode);
       if(literal)emit(literal,'dynamic-import',row);
       else if(isLegacy(file)||body.includes(PREFIX))unresolved.push({file,line:row,kind:'dynamic-import-expression'});
     }
     if(node.type==='NewExpression'&&calleeName(node.callee)==='URL'){
       const literal=simpleLiteral(node.arguments?.[0]);
       if(literal&&!ancestors.some(n=>n.type==='ImportExpression')){
         const parents=ancestors.filter(n=>n.type==='CallExpression'||n.type==='NewExpression')
           .map(n=>calleeName(n.callee));
         const kind=parents.includes('Worker')?'worker-url':
           parents.some(n=>['readFileSync','readFile','read','existsSync'].includes(n))?'file-read':'url-reference';
         emit(literal,kind,row);
       }
     }
     if(node.type==='CallExpression'){
       const name=calleeName(node.callee);
       if(['importScripts','versionedWorkerAssetUrl','workerAssetUrl',
         'readFileSync','readFile','read','readSource','existsSync'].includes(name)){
         const literal=simpleLiteral(node.arguments?.[0]);
         if(literal)emit(literal,['readFileSync','readFile','read','readSource','existsSync'].includes(name)?
           'file-read':'worker-import',row);
       }
     }
     for(const key of parsed.visitorKeys[node.type]||[]){
       const child=node[key];
       for(const entry of Array.isArray(child)?child:[child])
         if(entry?.type)visit(entry,stack);
     }
   };
   visit(parsed.ast);
  }
 }
 // Catalog, policy, source-inspection or quoted paths need a lexical fallback.
 const raw=/apps\/editor\/(?:frontend\/(?:js\/(?:modules|workers)\/[\w.-]+|js\/[\w.-]+)|templates\/[\w.-]+)/g;
 for(const match of body.matchAll(raw)){
   if(!known.has(match[0])||list.some(x=>x.target===match[0]))continue;
   const line=lineAt(match.index);
   const sourceLine=sourceLines[line-1]||'';
   const kind=/\bread(?:FileSync)?\s*\(|\bexistsSync\s*\(|\bfile\s*\(/.test(sourceLine)?
     'source-inspection':file.endsWith('.json')?'policy-reference':
     file.endsWith('.yml')||file.endsWith('.yaml')?'workflow-reference':'path-reference';
   emit(match[0],kind,line);
 }
 const unique=new Map;
 for(const ref of list)unique.set([ref.target,ref.kind,ref.line].join('|'),ref);
 return {direct:[...unique.values()],unresolved};
}
function stronglyConnected(graph){
 const index=new Map,low=new Map,stack=[],active=new Set,components=[];
 function visit(v){
   const i=index.size;index.set(v,i);low.set(v,i);stack.push(v);active.add(v);
   for(const n of graph.get(v)||[]){
     if(!index.has(n)){visit(n);low.set(v,Math.min(low.get(v),low.get(n)));}
     else if(active.has(n))low.set(v,Math.min(low.get(v),index.get(n)));
   }
   if(low.get(v)===index.get(v)){
     const group=[];let w;
     do{w=stack.pop();active.delete(w);group.push(w);}while(w!==v);
     components.push(sorted(group));
   }
 }
 for(const node of sorted(graph.keys()))if(!index.has(node))visit(node);
 return components.sort((a,b)=>a[0].localeCompare(b[0]));
}
export function buildR4E0Map(root=ROOT){
 if(resolve(root)!==resolve(ROOT))throw Error('R4-E0 audit uses repository root only');
 const repo=loadRepository(root);
 const ledger=JSON.parse(text(LEDGER));
 const pruning=JSON.parse(text(PRUNING));
 const legacy=sorted([...walk('apps/editor/frontend'),...walk('apps/editor/templates')]);
 const set=new Set(legacy),recorded=new Set(ledger.decisions.map(x=>x.path));
 const previous=new Set(pruning.removedSources||[]);
 const errors=[];
 if(ledger.schema!=='pandolab-r4e0-dependency-decisions-v1')errors.push('Invalid E0 ledger schema');
 if(ledger.decisions.length!==ledger.baselineCandidateCount||recorded.size!==ledger.decisions.length)
   errors.push('Duplicate or missing baseline classification');
 for(const path of legacy)if(!recorded.has(path))errors.push('Unclassified editor source: '+path);
 for(const row of ledger.decisions){
   if(!ledger.categories[row.category])errors.push('Unknown disposition for '+row.path);
   if(!set.has(row.path)&&!previous.has(row.path))
     errors.push('Deleted without a source-retirement receipt: '+row.path);
 }
 for(const path of ledger.invariants||[])if(!existsSync(resolve(ROOT,path)))
   errors.push('Canonical invariant missing: '+path);
 const externalFiles=sorted(new Set(['apps','shared','scripts','tools','tests','.github','config','docs']
   .flatMap(walk).filter(f=>!isLegacy(f)&&/\.(?:js|mjs|cjs|json|yml|yaml|html|toml|md)$/.test(f))));
 const byTarget=new Map(ledger.decisions.map(row=>[row.path,[]]));
 const graph=new Map(legacy.map(path=>[path,new Set]));
 const broad=[],unresolved=[];
 for(const file of sorted(new Set([...legacy,...externalFiles]))){
   let body;
   try{body=text(file);}catch(e){errors.push('Unreadable reference source: '+file);continue;}
   if(!isLegacy(file)&&!body.includes('apps/editor/frontend')&&!body.includes('apps/editor/templates'))continue;
   let refs;
   try{refs=references(file,body,recorded);}
   catch(e){errors.push(e.message);continue;}
   for(const entry of refs.direct){
     const ref={from:file,owner:sourceOwner(file,repo),kind:entry.kind,line:entry.line};
     byTarget.get(entry.target).push(ref);
     if(set.has(file)&&set.has(entry.target))graph.get(file).add(entry.target);
   }
   unresolved.push(...refs.unresolved);
   if((body.includes('apps/editor/frontend')||body.includes('apps/editor/templates'))&&!refs.direct.length)
     broad.push({from:file,owner:sourceOwner(file,repo),matches:body.split('\n').map((s,i)=>({line:i+1,text:s.trim().slice(0,180)}))
       .filter(row=>/apps\/editor\/(?:frontend|templates)/.test(row.text)).slice(0,5)});
 }
 const components=stronglyConnected(graph);
 const cyclic=components.filter(c=>c.length>1);
 const blockerOwners=new Set(['active-test','test-helper','windows-runtime','viewer-runtime',
  'shared-runtime','gis-or-build-tool','script','workflow','policy','other']);
 const records=ledger.decisions.map(row=>{
   const refs=(byTarget.get(row.path)||[]).sort((a,b)=>a.from.localeCompare(b.from)||a.line-b.line);
   const blocking=refs.filter(x=>blockerOwners.has(x.owner));
   return {...row,...ledger.categories[row.category],present:set.has(row.path),
     archivedUsage:refs.filter(x=>x.owner==='retired-test').length,
     activeRefs:blocking.length,blocking,
     internalOutgoing:sorted(graph.get(row.path)||[]),
     internalIncoming:legacy.filter(s=>(graph.get(s)||new Set).has(row.path)),
     referenceCounts:Object.fromEntries(sorted(new Set(refs.map(x=>x.kind))).map(k=>[k,refs.filter(x=>x.kind===k).length]))};
 });
 const componentOf=new Map;
 for(const group of components)for(const f of group)componentOf.set(f,group);
 for(const row of records)row.atomicDeletionGroup=componentOf.get(row.path)||[row.path];
 const summary={
  baseline:ledger.baselineCommit,tracked:records.length,present:legacy.length,removed:records.length-legacy.length,
  decisions:Object.fromEntries(sorted(Object.keys(ledger.categories)).map(k=>[k,records.filter(r=>r.category===k).length])),
  referencedFiles:records.filter(r=>r.blocking.length).length,
  directActiveReferences:records.reduce((n,r)=>n+r.activeRefs,0),
  retiredReferences:records.reduce((n,r)=>n+r.archivedUsage,0),
  internalEdges:[...graph.values()].reduce((n,s)=>n+s.size,0),
  stronglyConnectedGroups:cyclic.length,largestCycle:Math.max(0,...cyclic.map(c=>c.length)),
  broadReferences:broad.length,unresolvedExpressions:unresolved.length
 };
 return {schema:'pandolab-r4e0-dependency-map-v1',summary,records,cycles:cyclic,
    broadReferences:broad,unresolvedExpressions:unresolved,errors};
}
const direct=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct){
 const report=buildR4E0Map();
 const at=process.argv.indexOf('--output');
 if(at!==-1){
   const relative=process.argv[at+1];
   if(!relative||!relative.startsWith('test-results/')||relative.split('/').includes('..'))
     throw Error('R4-E0 output must remain under test-results/');
   mkdirSync(resolve(ROOT,dirname(relative)),{recursive:true});
   writeFileSync(resolve(ROOT,relative),JSON.stringify(report,null,2)+'\n');
 }
 if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
 else console.log(JSON.stringify({schema:report.schema,summary:report.summary,
   cycles:report.cycles.slice(0,12),broadReferences:report.broadReferences.slice(0,15),
   unresolvedExpressions:report.unresolvedExpressions.slice(0,15),errors:report.errors},null,2));
 if(process.argv.includes('--check')&&report.errors.length)process.exitCode=1;
}
