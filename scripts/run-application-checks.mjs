import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repository=fileURLToPath(new URL('../',import.meta.url));
export function executeChecks({groups=['node','browser','lint'],root=repository,catalog=JSON.parse(readFileSync(new URL('./contracts/application-checks.json',import.meta.url),'utf8')),run=(argv,options)=>spawnSync(argv[0],argv.slice(1),{...options,stdio:'inherit',windowsHide:true}),testNamePattern}={}) {
 if(!Array.isArray(groups)||!groups.length||groups.some(id=>typeof id!=='string')||new Set(groups).size!==groups.length)throw Error('Expected distinct check groups');
 const selected=groups.map(id=>{const group=catalog.groups.find(group=>group.id===id);if(!group||!Array.isArray(group.argv)||!group.argv.length)throw Error('Unknown check group: '+id);return group;});
 if(testNamePattern&&selected.some(group=>group.id!=='node'))throw Error('Test name selection applies to Node scenarios only');
 for(const group of selected) {
  const argv=[...group.argv];if(argv[0]==='node')argv[0]=process.execPath;
  if(testNamePattern)argv.splice(2,0,'--test-name-pattern='+testNamePattern);
  const result=run(argv,{cwd:resolve(root),env:process.env});
  if(result?.error)throw result.error;
  if(result?.status!==0)throw Error('Check failed or blocked: '+group.id+' (exit '+String(result?.status)+')');
 }
 return {ok:true,groups:[...groups]};
}
export function main(args=process.argv.slice(2)) {
 const options={};
 args=args.flatMap(value=>{const i=value.indexOf('=');return i>0?[value.slice(0,i),value.slice(i+1)]:[value];});
 for(let i=0;i<args.length;i++){const key=args[i];if(!['--group','--test-name-pattern'].includes(key))throw Error('Unknown check option: '+key);const value=args[++i];if(!value||value.startsWith('--'))throw Error('Missing check option value: '+key);if(key==='--group')options.groups=value.split(',');else options.testNamePattern=value;}
 const result=executeChecks(options);console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main();}catch(error){console.error(error.stack);process.exitCode=1;}
