import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const root=fileURLToPath(new URL('../',import.meta.url));
const arg=name=>{const inline=process.argv.find(x=>x.startsWith(name+'='));if(inline)return inline.slice(name.length+1);const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const output=resolve(arg('--out')||join(root,'build-native/predicate-comparison/native.json'));
const build=resolve(arg('--build')||join(root,'build-native/predicate-comparison'));
const cxx=arg('--cxx')||process.env.CXX||'g++';
const emxx=arg('--emxx-driver');
const wasm=arg('--target')==='wasm'||Boolean(emxx);
if(arg('--target')&&!['native','wasm'].includes(arg('--target')))throw Error('Unknown target');
const extension=wasm?'.mjs':'.exe';
const baselineSha=execFileSync('git',['rev-parse',(arg('--baseline')||'main')+'^{commit}'],{cwd:root,encoding:'utf8'}).trim();
const sourcePath='shared/core/src/geometrypredicates.cpp';
let variants=[
 {id:'main-control',sha:baselineSha},
 {id:'geo-containment-index',sha:'0362f3ddda0475dc68fb78cf2647a3f804287371'},
 {id:'geographic-2d-index',sha:'c07acc763061900ea421f4d3104a5ecd36bfccae'},
 {id:'geographic-broadphase',sha:'00b5616f2348a78b01dfe8188d3cab504d895cca'},
 {id:'geographic-direct-smoke',sha:'2c24855ef49df249527389eaaaa55877cea93fd6'},
];
variants.push({id:'main-1deg',sha:variants[0].sha,derived:'main latitude buckets 2deg/91 -> 1deg/181; same 32-degree long-edge cutoff'});
if(arg('--only')){const selected=new Set(arg('--only').split(','));variants=variants.filter(v=>selected.has(v.id));if(!variants.length)throw Error('No selected variants');}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:8*1024*1024});
const run=(exe,args,timeout=45000)=>spawnSync(exe,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:8*1024*1024,windowsHide:true});
const invokeCompiler=args=>run(cxx,emxx?[emxx,...args]:args);
function compile(args){const r=invokeCompiler(args);if(r.status!==0)throw Error('Compiler failed: '+r.stderr+' '+r.error);}
const flags=['-std=c++20',arg('--optimization')||'-O2','-I'+join(root,'shared/core/include'),...(wasm?['-fwasm-exceptions']:[])];
const linkFlags=wasm?['-sENVIRONMENT=node','-sEXPORT_ES6=1','-sALLOW_MEMORY_GROWTH=1','-sMAXIMUM_MEMORY=134217728','-sINITIAL_MEMORY=16777216','-sEXIT_RUNTIME=1']:[];
const launcher=join(build,'run-wasm.mjs');
if(wasm){mkdirSync(build,{recursive:true});writeFileSync(launcher,"import{pathToFileURL}from'node:url';import{resolve}from'node:path';const{default:create}=await import(pathToFileURL(resolve(process.argv[2])).href);await create({arguments:process.argv.slice(3)});\n");}
const execute=(path,args)=>wasm?run(process.execPath,[launcher,path,...args]):run(path,args);
const renamed=['geometryContains','geometrySignificantOverlap','planarArea','significantArea'].map(name=>'-D'+name+'=legacy'+name[0].toUpperCase()+name.slice(1));
const fixture=join(root,'tests/fixtures/geographic-predicate-comparison/historical-parity.cpp');
const fixturePin=JSON.parse(readFileSync(join(root,'tests/fixtures/geographic-predicate-comparison/manifest.json')));
if(sha(readFileSync(fixture))!==fixturePin.sha256)throw Error('Historical corpus hash mismatch');
mkdirSync(build,{recursive:true});
const baseline=join(build,'main.cpp');writeFileSync(baseline,git(['show',baselineSha+':'+sourcePath]));
const baselineObject=join(build,'main-oracle.o');compile([...flags,...renamed,'-c',baseline,'-o',baselineObject]);
const median=values=>{const a=[...values].sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
const artifactHashes=path=>wasm?{loaderSha256:sha(readFileSync(path)),wasmSha256:sha(readFileSync(path.replace(/\.mjs$/,'.wasm')))}:{binarySha256:sha(readFileSync(path))};
const report={schema:'pandolab-predicate-comparison-v1',baseline:baselineSha,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model,compiler:invokeCompiler(['--version']).stdout.split('\n')[0],target:wasm?'WASM (Node, no UI)':'native pure C++',flags,linkFlags,fixture:fixturePin,rounds:5,harnessSha256:sha(readFileSync(join(root,'tests/cpp/geographic-predicate-comparison.cpp'))),runnerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),appsRun:false,scope:'Bounded synthetic geometry. No full world, application, GUI or browser. Exact booleans and unrounded coordinate bits.',variants:[]};
for(const variant of variants){
 const path=join(build,variant.id+'.cpp'),object=join(build,variant.id+'.o');let bytes=git(['show',variant.sha+':'+sourcePath]);if(variant.derived){let text=bytes.toString();for(const [before,after]of [['bucketCount=91','bucketCount=181'],['bucketSize=2.','bucketSize=1.'],['maximumBucketSpan=16','maximumBucketSpan=32']]){if(text.split(before).length!==2)throw Error('Unexpected main index definition');text=text.replace(before,after);}bytes=Buffer.from(text);}writeFileSync(path,bytes);compile([...flags,'-c',path,'-o',object]);
 const corpusExe=join(build,variant.id+'-corpus'+extension),probeExe=join(build,variant.id+'-probe'+extension);
 compile([...flags,fixture,baselineObject,object,...linkFlags,'-o',corpusExe]);compile([...flags,join(root,'tests/cpp/geographic-predicate-comparison.cpp'),baselineObject,object,...linkFlags,'-o',probeExe]);
 const historical=execute(corpusExe,[]),adversarial=execute(probeExe,['correctness']),performance=execute(probeExe,['benchmark']);
 const cases=performance.status===0?JSON.parse(performance.stdout).map(x=>({...x,medianMainMs:median(x.rounds.map(r=>r.mainMs)),medianCandidateMs:median(x.rounds.map(r=>r.candidateMs)),medianSpeedup:median(x.rounds.map(r=>r.mainMs/r.candidateMs))})):[];
 for(const sample of cases){if(sample.rounds.length!==5||!sample.rounds.every(r=>Number.isFinite(r.mainMs)&&r.mainMs>0&&Number.isFinite(r.candidateMs)&&r.candidateMs>0))throw Error('Incomplete/nonfinite timing: '+sample.id);}
 if(performance.status===0&&!cases.length)throw Error('No benchmark cases executed');
 const row={...variant,sourceSha256:sha(bytes),artifacts:{probe:artifactHashes(probeExe),historical:artifactHashes(corpusExe)},historical:{exit:historical.status,stdout:historical.stdout,stderr:historical.stderr,error:historical.error?.message},adversarial:{exit:adversarial.status,stdout:adversarial.stdout,stderr:adversarial.stderr,error:adversarial.error?.message},performance:{exit:performance.status,stderr:performance.stderr,error:performance.error?.message,cases}};
 row.exact=historical.status===0&&/OBJ098_PARITY_OK 1262 checks/.test(historical.stdout)&&adversarial.status===0&&JSON.parse(adversarial.stdout).checks===1164&&JSON.parse(adversarial.stdout).mismatches===0&&performance.status===0;report.variants.push(row);writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({variant:variant.id,exact:row.exact,historicalExit:historical.status,performanceExit:performance.status,adversarial:adversarial.stdout.trim(),differences:adversarial.stderr.trim(),cases:cases.map(x=>({id:x.id,speedup:Number(x.medianSpeedup.toFixed(3))}))}));
}
