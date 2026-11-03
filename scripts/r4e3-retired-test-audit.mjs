// R4-E3: resolve exactly which tests and helper fixtures belong only to the retired editor.
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,posix,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRepository} from './plan-application-checks.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),repository=loadRepository(root);
const read=path=>readFileSync(resolve(root,path),'utf8'),exists=path=>existsSync(resolve(root,path));
const retired=repository.tests.filter(f=>repository.owners.get(f)?.mode==='retired').sort(),retiredSet=new Set(retired);
const active=repository.tests.filter(f=>!retiredSet.has(f));
function files(dir){if(!exists(dir))return [];
 return readdirSync(resolve(root,dir),{withFileTypes:true}).flatMap(e=>{
  const path=posix.join(dir,e.name);
  return e.isDirectory()?files(path):e.isFile()?[path]:[];
 });}
const refs=[];
for(const from of active){
 const body=repository.read(from);
 for(const to of retired){
  const rel=posix.relative(posix.dirname(from),to);
  if(body.includes(to)||body.includes(rel))refs.push({from,to});
 }
}
const candidateHelpers=[
 'tests/helpers/editing-domain.mjs','tests/browser/helpers/editor-entry.mjs',
 'tests/browser/helpers/mobile-vertex-ui.mjs','tests/unit/helpers/editor-dom-fixture.mjs'
];
const fixtureConsumers=candidateHelpers.map(path=>({
 path,exists:exists(path),activeUsers:active.filter(from=>{
  const s=repository.read(from);return s.includes(path)||s.includes(posix.relative(posix.dirname(from),path));
 }),retiredUsers:retired.filter(from=>{
  const s=repository.read(from);return s.includes(path)||s.includes(posix.relative(posix.dirname(from),path));
 })
}));
const sensitive=retired.filter(f=>/gis|core|wasm|geometr|river|hydro|country|territor|library|gpkg|source|history|timeline|date|precision|border|worker/i.test(f));
const result={schema:'pandolab-r4e3-test-retirement-inventory-v1',
 baseline:'b5a9ad09837ce7057b58c66e905ff82b84af6490',
 total:retired.length,unit:retired.filter(f=>f.startsWith('tests/unit/')).length,
 browser:retired.filter(f=>f.startsWith('tests/browser/')).length,active:active.length,
 retired,sensitive,activeReferencesToRetired:refs,fixtureConsumers,
 errors:[...refs.map(r=>'ACTIVE_IMPORT:'+r.from+':'+r.to),...fixtureConsumers.filter(x=>x.activeUsers.length).map(x=>'HELPER_IS_ACTIVE:'+x.path)]};
console.log(JSON.stringify(result,null,2));
const ix=process.argv.indexOf('--output');if(ix!==-1){
 const path=process.argv[ix+1];if(!path?.startsWith('test-results/')||path.includes('..'))throw Error('Invalid output path');
 mkdirSync(resolve(root,dirname(path)),{recursive:true});writeFileSync(resolve(root,path),JSON.stringify(result,null,2)+'\n');
}
if(process.argv.includes('--check')&&result.errors.length)process.exitCode=1;
