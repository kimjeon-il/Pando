import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const appPath=new URL('../../.github/workflows/library-data-auto-sync.yml',import.meta.url);
const repoRoot=fileURLToPath(new URL('../..',import.meta.url));
const dataPath=resolve(repoRoot,'../data-code-stage/.github/workflows/notify-library-data.yml');
const source=p=>existsSync(p)?readFileSync(p,'utf8').replaceAll('\r\n','\n'):'';
test('receiver tests work/gis pushes and serializes durable writes',()=>{
 const s=source(appPath);assert.match(s,/branches: \['work\/gis'\]/);assert.match(s,/cancel-in-progress: false/);assert.match(s,/contracts:[\s\S]*github.event_name == 'push'/);assert.match(s,/node --test tests\/unit\/library-auto-/);assert.doesNotMatch(s,/pages: write|id-token: write/);
});
test('receiver gates production before credentials and dependencies, pairs fixed full-history branches',()=>{
 const s=source(appPath);assert.match(s,/productionEnabled === true/);assert.ok(s.indexOf('productionEnabled === true')<s.indexOf('secrets.PANDOLAB_LIBRARY_WRITE_TOKEN'));assert.match(s,/context.ref !== `refs\/heads\/\$\{branch\}`/);assert.match(s,/repository: kimjeon-il\/PandoLab-library-data/);assert.equal((s.match(/fetch-depth: 0/g)||[]).length,3);assert.match(s,/LIBRARY_AUTO_BRANCH:/);assert.match(s,/LIBRARY_AUTO_DATA_SHA=/);assert.match(s,/node scripts\/library-auto-sync.mjs/);assert.match(s,/pnpm install --frozen-lockfile --ignore-scripts/);assert.match(s,/if: always\(\)/);
});
test('recovery is fixed main-only and no direct Pages dispatch exists',()=>{
 const s=source(appPath);assert.match(s,/cron: '17 \* \* \* \*'/);assert.match(s,/workflow_run:/);assert.match(s,/head_branch !== 'main'/);assert.doesNotMatch(s,/gh workflow run|web-pages.yml\/dispatches/);assert.match(s,/branch === 'main' && !enabled/);
});
test('data notifier has fixed URL, validated same branch and fail-closed token, no generation',{skip: !existsSync(dataPath) && 'notifier is independently installed in data repository'},()=>{
 const s=source(dataPath);assert.match(s,/branches: \['main', 'work\/gis'\]/);assert.match(s,/library.json/);assert.match(s,/objects\/\*\*/);assert.match(s,/archive\/index.json/);assert.match(s,/if \(!token\) throw new Error\('PANDO_AUTO_DATA_NOTIFY_TOKEN is required'\)/);assert.match(s,/https:\/\/api.github.com\/repos\/kimjeon-il\/Pando\/actions\/workflows\/library-data-auto-sync.yml\/dispatches/);assert.match(s,/ref: branch, inputs: \{data_revision: sha, data_branch: branch\}/);assert.doesNotMatch(s,/checkout@|pnpm |library-auto-sync.mjs|contents: write|console.log\(token/);
});

async function gate({event='workflow_dispatch',branch='main',ref=`refs/heads/${branch}`,enabled=false,sha='a'.repeat(40),head='main',changed=true,before='b'.repeat(40),request={schemaVersion:1,dataBranch:'work/gis',dataRevision:'c'.repeat(40)},repo='kimjeon-il/Pando'}={}) {
 const s=source(appPath),script=s.split('          script: |\n')[1].split('\n  sync:')[0].split('\n').map(l=>l.slice(12)).join('\n');
 const outputs={},commands=[],[owner,name]=repo.split('/');
 const fn=new (Object.getPrototypeOf(async function(){}).constructor)('require','process','context','core',script);
 await fn(name=>name==='node:fs'?{readFileSync:()=>JSON.stringify({productionEnabled:enabled})}:{execFileSync:(exe,args)=>{assert.equal(exe,'git');commands.push(args);if(args[0]==='diff')return changed?'config/library-auto-work-gis-request.json\n':'';if(args[0]==='show')return JSON.stringify(request);throw Error('unexpected git');}}, {env:{DATA_BRANCH:branch,DATA_REVISION:sha},cwd:()=>repoRoot}, {eventName:event,ref,sha,repo:{owner,repo:name},payload:{before,workflow_run:{head_branch:head}}}, {setOutput:(k,v)=>outputs[k]=v});
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
test('push strict input is wired before preparation and independently rechecked by executor',()=>{
 const s=source(appPath);assert.ok(s.indexOf('Reject moved exact work/gis request input')<s.indexOf('Prepare pinned external library data'));
 assert.match(s,/LIBRARY_AUTO_REQUEST_DATA_SHA:/);assert.match(s,/assertRequestedDataHead\(process.env.REQUESTED_DATA_SHA,actual\)/);
});
test('request publication waits for contracts while ordinary dispatch tolerates skipped contracts',()=>{const s=source(appPath);assert.match(s,/needs: \[gate, contracts\]/);assert.match(s,/if: always\(\) && needs.gate.outputs.allowed == 'true' && \(github.event_name != 'push' \|\| needs.contracts.result == 'success'\)/);});
