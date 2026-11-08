// Task-owned delivery tool. Removed together with its workflow after remote verification.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync} from 'node:fs';
import {resolve, relative} from 'node:path';
import {parseDocument, isMap, isSeq, isScalar} from 'yaml';
const root=process.cwd();
const plan=JSON.parse(readFileSync('.github/test-scope-delivery.json','utf8'));
const removed=new Set(plan.remove);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const paths=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?paths(directory+'/'+e.name):[directory+'/'+e.name]);
const changed=new Set();
const verified=new Set();
function verifyInput(file){
  if(!/^(?:tests\/unit\/|scripts\/contracts\/|\.github\/workflows\/|package\.json$)/.test(file)||relative(root,resolve(root,file)).startsWith('..'))throw Error('Invalid delivery scope: '+file);
  const expected=execFileSync('git',['rev-parse',plan.base+':'+file],{encoding:'utf8'}).trim();
  const bytes=readFileSync(file),actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  if(actual!==expected)throw Error('Input changed; re-review before delivery: '+file);
  verified.add(file);
}
for(const file of removed){verifyInput(file);unlinkSync(file);changed.add(file);}
const containsRemoved=text=>[...removed].some(file=>text.includes(file));
function cleanCommand(command){
  // An empty node --test command must never discover the full suite.
  return command.replace(/\\\r?\n\s*/g,' ').split('\n').flatMap(line=>{
    if(!containsRemoved(line))return [line];
    for(const file of removed)line=line.split(file).join('');
    line=line.replace(/[ \t]+$/,'');
    if(/^\s*(?:node\s+--test|pnpm\s+exec\s+eslint)\s*$/.test(line)||!line.trim())return [];
    return [line];
  }).join('\n').trimEnd();
}
function cleanJson(value){
  if(Array.isArray(value))return value.filter(x=>typeof x!=='string'||!removed.has(x)).map(cleanJson).filter(x=>!(x&&typeof x==='object'&&Array.isArray(x.tests)&&x.tests.length===0));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,cleanJson(v)]));
  return value;
}
const catalogPath='scripts/contracts/application-checks.json';
const catalog=readFileSync(catalogPath,'utf8');
if(containsRemoved(catalog)){verifyInput(catalogPath);writeFileSync(catalogPath,JSON.stringify(cleanJson(JSON.parse(catalog)),null,2)+'\n');changed.add(catalogPath);}
const packagePath='package.json',packageText=readFileSync(packagePath,'utf8');
if(containsRemoved(packageText)){verifyInput(packagePath);
  const data=JSON.parse(packageText);
  for(const [key,command]of Object.entries(data.scripts||{}))if(containsRemoved(command)){
    const cleaned=cleanCommand(command);if(cleaned)data.scripts[key]=cleaned;else delete data.scripts[key];
  }
  writeFileSync(packagePath,JSON.stringify(data,null,2)+'\n');changed.add(packagePath);
}
for(const file of paths('.github/workflows').filter(p=>/\.ya?ml$/.test(p))){
  const original=readFileSync(file,'utf8');if(!containsRemoved(original))continue;
  verifyInput(file);
  const doc=parseDocument(original);if(doc.errors.length)throw Error('Invalid YAML '+file);
  function cleanNode(node){
    if(isSeq(node)){
      node.items=node.items.filter(item=>!(isScalar(item)&&typeof item.value==='string'&&removed.has(item.value)));
      node.items=node.items.filter(item=>{
        if(isMap(item)&&typeof item.get('run')==='string'&&containsRemoved(item.get('run'))){
          const command=cleanCommand(item.get('run'));if(!command.trim())return false;item.set('run',command);
        }
        cleanNode(item);return true;
      });
    }else if(isMap(node))for(const pair of node.items)cleanNode(pair.value);
    else if(isScalar(node)&&typeof node.value==='string'&&containsRemoved(node.value)){
      node.value=node.value.split('\n').filter(line=>![...removed].some(file=>line.trim()===file||line.trim()==='/'+file)).join('\n');
    }
  }
  cleanNode(doc.contents);
  const result=doc.toString({lineWidth:0});
  if(containsRemoved(result))throw Error('Unhandled retired workflow reference '+file);
  writeFileSync(file,result);changed.add(file);
}
for(const file of changed)if(!verified.has(file))throw Error('Unexpected output '+file);
const result=[...changed].sort().map(file=>({path:file,sha256:existsSync(file)?digest(readFileSync(file)):null}));
if(digest(JSON.stringify(result))!==plan.outputsSha256)throw Error('Delivery output differs from reviewed local result');
writeFileSync('/tmp/pando-test-scope-output.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({changed:result.length,removed:removed.size,files:result},null,2));
