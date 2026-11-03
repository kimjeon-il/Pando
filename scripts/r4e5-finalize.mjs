// Archived-editor closure, must run on an isolated integration branch only.
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const rel=path=>resolve(root,path);
const read=path=>readFileSync(rel(path),'utf8');
const save=(path,data)=>{mkdirSync(dirname(rel(path)),{recursive:true});writeFileSync(rel(path),data)};
const ledger=JSON.parse(read('docs/development/r4e0-source-dispositions.json'));
const pruning=JSON.parse(read('docs/development/r4-source-pruning.json'));
const originals=ledger.decisions.map(row=>row.path);
const remaining=originals.filter(path=>existsSync(rel(path)));
if(!remaining.length){console.log('R4E5_ALREADY_COMPLETE');process.exit(0)}
if(remaining.length!==74)throw Error('R4E5_EXPECTED_74_REMAINING: '+remaining.length);
const oldNames=new Set(remaining.map(p=>posix.basename(p)));
const oldPrefix=/^apps\/editor\/(?:frontend|templates)\//;
const forbidden=text=>{
  if(/['\"][^'\"\n]*apps\/editor\/(?:frontend|templates)\//.test(text))return true;
  if(/\breadApplicationOwners\s*\(/.test(text))return true;
  for(const match of text.matchAll(/['\"]([^'\"\n]+)['\"]/g)){
    const value=match[1].replaceAll('\\','/');
    if(!oldNames.has(posix.basename(value.split(/[?#]/)[0])))continue;
    if((value.startsWith('modules/')||value.startsWith('workers/')||
      /(?:^|\/)(?:modules|workers)\/[^/]+$/.test(value)) &&
      !value.includes('shared/frontend/')&&!value.includes('tools/gis/'))return true;
  }
  return false;
};
function bindings(n){const names=new Set();const add=x=>{
  if(!x)return;
  if(x.type==='Identifier')names.add(x.name);
  else if(x.type==='ObjectPattern')for(const item of x.properties)add(item.value||item.argument);
  else if(x.type==='ArrayPattern')for(const item of x.elements)add(item);
  else if(x.type==='AssignmentPattern')add(x.left);
  else if(x.type==='RestElement')add(x.argument);
};
if(n.type==='ImportDeclaration')for(const item of n.specifiers)add(item.local);
if(n.type==='VariableDeclaration')for(const item of n.declarations)add(item.id);
if(['ClassDeclaration','FunctionDeclaration'].includes(n.type))add(n.id);
if(n.type==='ExportNamedDeclaration'&&n.declaration)return bindings(n.declaration);
return names;}
function callTest(n){if(n.type!=='ExpressionStatement')return false;let p=n.expression;
if(p?.type!=='CallExpression')return false;p=p.callee;
while(p?.type==='MemberExpression')p=p.object;
return p?.type==='Identifier'&&['test','it','describe'].includes(p.name);}
function usedIds(n,visitorKeys){const result=new Set();const visit=x=>{
 if(!x||typeof x.type!=='string')return;
 if(x.type==='Identifier')result.add(x.name);
 for(const k of visitorKeys[x.type]||[]){const v=x[k];if(Array.isArray(v))v.forEach(visit);else visit(v)}
};visit(n);return result;}
const protectedTests=new Set([
 'tests/unit/r4e0-dependency-audit.test.mjs',
 'tests/unit/r4e1-gis-interop-boundaries.test.mjs',
 'tests/unit/r4e2-core-gis-boundaries.test.mjs',
 'tests/unit/r4e3-retirement-boundaries.test.mjs',
 'tests/unit/r4e3-retired-editor-closure.test.mjs',
 'tests/unit/r4-editor-source-retirement.test.mjs',
 'tests/unit/r4c-spatial-boundaries.test.mjs'
]);
const {parseJavaScript}=await import('./lib/source-analysis.mjs');
const consumers=new Set();
// Audit originates from the exact current branch and refuses shipping runtime references.
const {buildR4E0Map}=await import('./r4e0-dependency-audit.mjs');
const before=buildR4E0Map();
if(before.errors.length)throw Error('R4E0 audit failed: '+before.errors.join(';'));
for(const row of before.records.filter(row=>row.present))for(const ref of row.blocking){
 if(ref.owner==='active-test'&&ref.from.startsWith('tests/unit/'))consumers.add(ref.from);
 if(['viewer-runtime','shared-runtime','windows-runtime'].includes(ref.owner)&&
   ['static-import','dynamic-import','worker-url','worker-import'].includes(ref.kind))
   throw Error('Shipped owner depends on old editor: '+ref.from);
}
const retiredFiles=[],preserved=[],removedCases=[];
for(const file of [...consumers].sort()){
 if(!existsSync(rel(file))||protectedTests.has(file))continue;
 const body=read(file),code=parseJavaScript(body,{filePath:file}),statements=code.ast.body;
 const banned=new Set(),badNames=new Set();
 statements.forEach((n,i)=>{if(forbidden(body.slice(...n.range)))banned.add(i)});
 for(let changed=true;changed;){changed=false;
   for(const i of banned)for(const name of bindings(statements[i]))if(!badNames.has(name)){
     badNames.add(name);changed=true;
   }
   statements.forEach((n,i)=>{if(banned.has(i)||n.type==='ImportDeclaration')return;
     if([...usedIds(n,code.visitorKeys)].some(name=>badNames.has(name))){banned.add(i);changed=true}
   });
 }
 const all=statements.filter(callTest).length,keep=statements.filter((n,i)=>callTest(n)&&!banned.has(i)).length;
 if(!all||!keep){unlinkSync(rel(file));retiredFiles.push(file);removedCases.push({file,retired:all,retained:0});continue}
 let next=body;
 for(const range of [...banned].map(i=>statements[i].range).sort((a,b)=>b[0]-a[0]))
   next=next.slice(0,range[0])+next.slice(range[1]);
 if(forbidden(next))throw Error('Retained test has stale editor use: '+file);
 if(next!==body){save(file,next);preserved.push({file,retired:all-keep,retained:keep})}
}
for(const path of remaining){if(!oldPrefix.test(path))throw Error('Not a legacy editor source: '+path);unlinkSync(rel(path))}
pruning.removedSources=[...new Set([...pruning.removedSources,...remaining])].sort();
pruning.removedSourceCount=pruning.removedSources.length;
pruning.remainingSourceCount=pruning.baselineCandidates-pruning.removedSourceCount;
if(pruning.removedSourceCount!==153||pruning.remainingSourceCount!==0)throw Error('Not all 153 sources retired');
pruning.removedTests=[...new Set([...pruning.removedTests,...retiredFiles])].sort();
pruning.removedTestCount=pruning.removedTests.length;
save('docs/development/r4-source-pruning.json',JSON.stringify(pruning,null,2)+'\n');
// Remove exact references to already-deleted tests from application catalog and CI.
const dead=new Set(retiredFiles),contract='scripts/contracts/application-checks.json';
const filter=node=>Array.isArray(node)?node.filter(x=>!dead.has(x)).map(filter):
  node&&typeof node==='object'?Object.fromEntries(Object.entries(node).map(([k,v])=>[k,filter(v)])):node;
save(contract,JSON.stringify(filter(JSON.parse(read(contract))),null,2)+'\n');
const policyPath='scripts/contracts/territorial-storage-access.json';
const dropOld=node=>Array.isArray(node)?node.filter(x=>typeof x!=='string'||!oldPrefix.test(x))
 .filter(x=>!x||typeof x!=='object'||!Object.values(x).some(v=>typeof v==='string'&&remaining.includes(v))).map(dropOld):
 node&&typeof node==='object'?Object.fromEntries(Object.entries(node).filter(([k,v])=>
 !remaining.includes(k)&&!(typeof v==='string'&&remaining.includes(v))).map(([k,v])=>[k,dropOld(v)])):node;
save(policyPath,JSON.stringify(dropOld(JSON.parse(read(policyPath))),null,2)+'\n');
for(const name of readdirSync(rel('.github/workflows')).filter(x=>/\.ya?ml$/.test(x))){
 const file='.github/workflows/'+name,body=read(file);
 let updated=body;for(const p of retiredFiles)updated=updated.replaceAll(p,'');
 if(updated!==body)save(file,updated);
}
const e0='tests/unit/r4e0-dependency-audit.test.mjs';let e0source=read(e0);
e0source=e0source.replace('assert.ok(audit.summary.referencedFiles>0);','assert.equal(audit.summary.referencedFiles,0);');
const anchor="test('R4-E0 dependency graph produces unique complete deletion units',()=>{";
const i=e0source.indexOf(anchor);
if(i<0)throw Error('E0 graph test anchor changed');
e0source=e0source.slice(0,i)+"test('R4-E5 closes the archived source dependency graph',()=>{\n"+
 " assert.equal(audit.summary.present,0);\n assert.equal(audit.summary.removed,103);\n"+
 " assert.equal(audit.summary.referencedFiles,0);\n assert.deepEqual(audit.errors,[]);\n});\n";
save(e0,e0source);
const e3='tests/unit/r4e3-retired-editor-closure.test.mjs';let e3source=read(e3);
e3source=e3source.replace("assert.equal(exists('apps/editor/frontend/js/modules/editing-domain.js'),true,",
 "assert.equal(exists('apps/editor/frontend/js/modules/editing-domain.js'),false,");
save(e3,e3source);
const preservedProof={
 'gis-interop':['tests/unit/gis-geometry-worker.test.mjs','tests/unit/gis-adapters.test.mjs',
  'tests/unit/core-gpkg-file-boundary.test.mjs'],
 'core-fixture':['tests/unit/core-territorial-service-wasm.test.mjs','tests/unit/core-service-writer-clock-wasm.test.mjs',
  'tests/unit/core-direct-object-writers-wasm.test.mjs','tests/unit/core-label-gesture-wasm.test.mjs'],
 'retired-ui':['tests/browser/viewer-review-e4.spec.mjs','tests/browser/viewer-gpu-backend-cross.spec.mjs',
  'tests/browser/windows-review-e5.spec.mjs'],
 'retired-worker':['tests/unit/country-shared-boundary-state.test.mjs','tests/unit/gis-geometry-worker.test.mjs']
};
for(const paths of Object.values(preservedProof))for(const path of paths)if(!existsSync(rel(path)))
 throw Error('Canonical proof missing: '+path);
const evidence={schema:'pando-r4-e5-closure-v1',retired:remaining.sort(),
 retiredFiles,preserved,removedCases,canonicalTests:preservedProof};
save('docs/development/r4e5-final-migration.json',JSON.stringify(evidence,null,2)+'\n');
const after=buildR4E0Map();
if(after.summary.present!==0||after.errors.length)throw Error('R4E5 audit did not close: '+JSON.stringify(after.errors));
console.log('R4E5_FINALIZED',JSON.stringify({remaining:after.summary.present,
 removed:remaining.length,retiredTestFiles:retiredFiles.length,migratedTestFiles:preserved.length}));
