import { describe as contractSuite } from 'node:test';
import * as __library_dep0 from "node:test";
import * as __library_dep1 from "node:assert/strict";
import * as __library_dep2 from "../../../scripts/lib/library-auto-sync.mjs";
import * as __library_dep3 from "../../../scripts/lib/library-auto-request.mjs";
import * as __library_dep4 from "node:fs";
import * as __library_dep5 from "node:url";


// Original feature contract: library-auto-sync.test.mjs
contractSuite("library-auto-sync", () => {
const test = __library_dep0.default;
const assert = __library_dep1.default;
const { validateSyncRequest, planSync } = __library_dep2;
const sha='a'.repeat(40), newer='b'.repeat(40), output='c'.repeat(40), fp='d'.repeat(64), gen='e'.repeat(64);
const policy={productionEnabled:false};
const request={dataRepository:'kimjeon-il/PandoLab-library-data',dataBranch:'work/gis',dataSha:sha,appRepository:'kimjeon-il/Pando',appBranch:'work/gis',appSha:sha,production:false};
const desired={...request,inputFingerprint:fp,generatorIdentity:gen,supported:true};
const receipt={inputFingerprint:fp,generatorIdentity:gen,dataSha:output};
const available={pinnedDataSha:null,run:null};
const plan=(changes={})=>planSync({desired,completed:null,available,policy,...changes});
test('validates fixed tuple without implying external trust',()=>assert.deepEqual(validateSyncRequest(request,policy),request));
for(const [field,value] of [['dataRepository','evil/repo'],['appRepository','evil/repo'],['dataBranch','refs/heads/main'],['appBranch','other'],['dataSha','A'.repeat(40)],['appSha','a'.repeat(39)],['command','curl']]) test(`rejects invalid ${field}`,()=>assert.throws(()=>validateSyncRequest({...request,[field]:value},policy)));
test('work cannot request production even with policy enabled',()=>assert.throws(()=>validateSyncRequest({...request,production:true},{productionEnabled:true})));
test('disabled main production request rejected',()=>assert.throws(()=>validateSyncRequest({...request,dataBranch:'main',appBranch:'main',production:true},policy)));
test('unknown policy key rejected',()=>assert.throws(()=>validateSyncRequest(request,{...policy,token:'secret'})));
test('missing completed data derives',()=>assert.equal(plan().action,'derive'));
test('stale fingerprint derives',()=>assert.equal(plan({completed:{...receipt,inputFingerprint:'f'.repeat(64)}}).action,'derive'));
test('stale generator derives',()=>assert.equal(plan({completed:{...receipt,generatorIdentity:'f'.repeat(64)}}).action,'derive'));
test('new desired event uses latest revision rather than old receipt source',()=>assert.equal(plan({desired:{...desired,dataSha:newer}}).expected.dataSha,newer));
test('complete data recovers missing pin',()=>assert.equal(plan({completed:receipt}).action,'connect'));
test('preview missing run requests verify and never deploy',()=>assert.equal(plan({completed:receipt,available:{pinnedDataSha:output,run:null}}).action,'verify'));
test('pending run recovers verification',()=>assert.equal(plan({completed:receipt,available:{pinnedDataSha:output,run:{dataSha:output,appSha:sha,status:'pending',target:'preview'}}}).action,'verify'));
test('reports-only event preserves verified preview without regeneration',()=>assert.equal(plan({desired:{...desired,dataSha:newer},completed:receipt,available:{pinnedDataSha:output,run:{dataSha:output,appSha:sha,status:'verified',target:'preview'}}}).action,'noop'));
test('verified wrong app revision is not noop',()=>assert.equal(plan({completed:receipt,available:{pinnedDataSha:output,run:{dataSha:output,appSha:newer,status:'verified',target:'preview'}}}).action,'verify'));
test('production enabled main deploys only after paired pin',()=>{const d={...desired,dataBranch:'main',appBranch:'main',production:true}; assert.equal(plan({desired:d,policy:{productionEnabled:true},completed:receipt,available:{pinnedDataSha:output,run:null}}).action,'deploy'); assert.equal(plan({desired:d,policy:{productionEnabled:true},completed:receipt}).action,'connect');});
test('production disabled planning blocks rather than writes',()=>assert.equal(plan({desired:{...desired,dataBranch:'main',appBranch:'main',production:true}}).action,'blocked'));
test('unsupported inputs block',()=>assert.equal(plan({desired:{...desired,supported:false}}).action,'blocked'));
test('unknown state and malformed fingerprints rejected',()=>{assert.throws(()=>plan({available:{...available,url:'evil'}})); assert.throws(()=>plan({desired:{...desired,inputFingerprint:'x'}}));});
test('source provenance and publication revision remain separate',()=>{const p=plan({completed:receipt});assert.equal(p.expected.inputDataSha,sha);assert.equal(p.expected.outputDataSha,output);});
test('reports-only input still recovers missing paired pin',()=>assert.equal(plan({desired:{...desired,dataSha:newer},completed:receipt}).action,'connect'));
test('production pending, failed, verified and wrong evidence recover correctly',()=>{const d={...desired,dataBranch:'main',appBranch:'main',production:true};for(const [status,target,action] of [['pending','production','verify'],['failed','production','deploy'],['verified','production','noop'],['verified','preview','deploy']])assert.equal(plan({desired:d,policy:{productionEnabled:true},completed:receipt,available:{pinnedDataSha:output,run:{dataSha:output,appSha:sha,status,target}}}).action,action);});
test('main non-production remains preview only',()=>assert.equal(plan({desired:{...desired,dataBranch:'main',appBranch:'main'},completed:receipt,available:{pinnedDataSha:output,run:null}}).action,'verify'));
test('exact completed and run schemas reject extras',()=>{assert.throws(()=>plan({completed:{...receipt,token:'x'}}));assert.throws(()=>plan({available:{...available,run:{dataSha:output,appSha:sha,status:'verified',target:'preview',url:'evil'}}}));});
for(const [dataBranch,appBranch] of [['main','work/gis'],['work/gis','main']])test(`rejects mixed branch pair ${dataBranch}/${appBranch}`,()=>assert.throws(()=>validateSyncRequest({...request,dataBranch,appBranch},policy)));
for(const field of ['dataSha','appSha'])test(`rejects zero request ${field}`,()=>assert.throws(()=>validateSyncRequest({...request,[field]:'0'.repeat(40)},policy)));
for(const field of ['inputFingerprint','generatorIdentity'])test(`rejects zero desired ${field}`,()=>assert.throws(()=>plan({desired:{...desired,[field]:'0'.repeat(64)}})));
for(const field of ['inputFingerprint','generatorIdentity','dataSha'])test(`rejects zero completed ${field}`,()=>assert.throws(()=>plan({completed:{...receipt,[field]:'0'.repeat(field==='dataSha'?40:64)}})));
test('rejects zero pin',()=>assert.throws(()=>plan({available:{...available,pinnedDataSha:'0'.repeat(40)}})));
for(const field of ['dataSha','appSha'])test(`rejects zero run ${field}`,()=>assert.throws(()=>plan({available:{...available,run:{dataSha:output,appSha:sha,status:'verified',target:'preview',[field]:'0'.repeat(40)}}})));
for(const field of ['dataSha','appSha'])test(`rejects zero desired ${field}`,()=>assert.throws(()=>plan({desired:{...desired,[field]:'0'.repeat(40)}})));
for(const [dataBranch,appBranch] of [['main','work/gis'],['work/gis','main']])test(`planner rejects mixed branch pair ${dataBranch}/${appBranch}`,()=>assert.throws(()=>plan({desired:{...desired,dataBranch,appBranch}})));
});

// Original feature contract: library-auto-request.test.mjs
contractSuite("library-auto-request", () => {
const test = __library_dep0.default;
const assert = __library_dep1.default;
const { resolveWorkGisRequest, assertRequestedDataHead, REQUEST_PATH } = __library_dep3;
const sha='a'.repeat(40),before='b'.repeat(40),after='c'.repeat(40);
const request={schemaVersion:1,dataBranch:'work/gis',dataRevision:sha};
const input=()=>({repository:'kimjeon-il/Pando',ref:'refs/heads/work/gis',before,after,changedPaths:[REQUEST_PATH],request});
test('changed exact work/gis request enters existing publisher',()=>assert.deepEqual(resolveWorkGisRequest(input()),{branch:'work/gis',revision:sha}));
test('ordinary code pushes do not execute persistent request',()=>assert.equal(resolveWorkGisRequest({...input(),changedPaths:['scripts/lib/library-auto-request.mjs']}),null));
test('foreign repo/ref and invalid push endpoints fail closed',()=>{for(const patch of [{repository:'evil/Pando'},{ref:'refs/heads/main'},{before:'0'.repeat(40)},{after:';echo x'}])assert.throws(()=>resolveWorkGisRequest({...input(),...patch}));});
test('request schema is closed and forbids main, malformed revisions, commands and unknown keys',()=>{for(const patch of [{schemaVersion:2},{dataBranch:'main'},{dataRevision:'0'.repeat(40)},{dataRevision:'a'.repeat(39)},{dataRevision:'$(danger)'},{command:'anything'}])assert.throws(()=>resolveWorkGisRequest({...input(),request:{...request,...patch}}));});
test('strict input head guard cannot silently consume newer native input',()=>{assert.doesNotThrow(()=>assertRequestedDataHead(sha,sha));assert.throws(()=>assertRequestedDataHead(sha,before),/REQUEST_DATA_HEAD_MOVED/);assert.throws(()=>assertRequestedDataHead('',sha));});
});

// Original feature contract: library-auto-workflows.test.mjs
contractSuite("library-auto-workflows", () => {
const test = __library_dep0.default;
const assert = __library_dep1.default;
const { readFileSync, existsSync } = __library_dep4;
const { fileURLToPath, pathToFileURL } = __library_dep5;

const appPath=new URL("../../../.github/workflows/library-data-auto-sync.yml",import.meta.url);
const repoRoot=fileURLToPath(new URL("../../..",import.meta.url));

const source=p=>existsSync(p)?readFileSync(p,'utf8').replaceAll('\r\n','\n'):'';
async function gate({event='workflow_dispatch',branch='main',ref=`refs/heads/${branch}`,enabled=false,sha='a'.repeat(40),head='main',changed=true,before='b'.repeat(40),request={schemaVersion:1,dataBranch:'work/gis',dataRevision:'c'.repeat(40)},repo='kimjeon-il/Pando'}={}) {
 const s=source(appPath),script=s.split('          script: |\n')[1].split('\n  sync:')[0].split('\n').map(l=>l.slice(12)).join('\n');
 const outputs={},commands=[],[owner,name]=repo.split('/');
 const fn=new (Object.getPrototypeOf(async function(){}).constructor)('require','process','context','core',script);
 await fn(name=>name==='node:fs'?{readFileSync:()=>JSON.stringify({productionEnabled:enabled})}:name==='node:url'?{pathToFileURL}:{execFileSync:(exe,args)=>{assert.equal(exe,'git');commands.push(args);if(args[0]==='diff')return changed?'config/library-auto-work-gis-request.json\n':'';if(args[0]==='show')return JSON.stringify(request);throw Error('unexpected git');}}, {env:{DATA_BRANCH:branch,DATA_REVISION:sha},cwd:()=>repoRoot}, {eventName:event,ref,sha,repo:{owner,repo:name},payload:{before,workflow_run:{head_branch:head}}}, {setOutput:(k,v)=>outputs[k]=v});
 return {outputs,commands};
}
test('actual receiver gate rejects mismatched refs and disabled main, permits explicit work branch',async()=>{
 assert.equal((await gate()).outputs.allowed,'false');
 assert.equal((await gate({branch:'work/gis'})).outputs.allowed,'true');
 assert.equal((await gate({enabled:true})).outputs.allowed,'true');
 assert.equal((await gate({event:'schedule'})).outputs.allowed,'false');
 await assert.rejects(gate({branch:'work/gis',ref:'refs/heads/main'}),/branch mismatch/);
 await assert.rejects(gate({sha:'$(danger)'}),/Invalid data revision/);
 await assert.rejects(gate({event:'workflow_run',head:'work/gis'}),/Invalid recovery branch/);
});
test('actual push gate reads only event commit request and permits exact work branch',async()=>{
 const {outputs,commands}=await gate({event:'push',branch:'work/gis'});
 assert.equal(outputs.allowed,'true');assert.equal(outputs.branch,'work/gis');assert.equal(outputs.revision,'c'.repeat(40));
 assert.deepEqual(commands,[['diff','--name-only','b'.repeat(40),'a'.repeat(40),'--','config/library-auto-work-gis-request.json'],['show','a'.repeat(40)+':config/library-auto-work-gis-request.json']]);
 assert.equal((await gate({event:'push',branch:'work/gis',changed:false})).outputs.allowed,'false');
 await assert.rejects(gate({event:'push',branch:'main'}),/BRANCH_NOT_ALLOWED/);
 await assert.rejects(gate({event:'push',branch:'work/gis',before:';bad'}),/push SHA/);
 await assert.rejects(gate({event:'push',branch:'work/gis',request:{schemaVersion:1,dataBranch:'main',dataRevision:'c'.repeat(40)}}),/INVALID_WORK_GIS_REQUEST/);
});
});
