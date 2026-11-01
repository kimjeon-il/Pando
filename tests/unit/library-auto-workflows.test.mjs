import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const appPath=new URL('../../.github/workflows/library-data-auto-sync.yml',import.meta.url);
const repoRoot=fileURLToPath(new URL('../..',import.meta.url));
const dataPath=resolve(repoRoot,'../data-code-stage/.github/workflows/notify-library-data.yml');
const source=p=>existsSync(p)?readFileSync(p,'utf8').replaceAll('\r\n','\n'):'';
test('receiver isolates work/gis pushes to focused tests and serializes durable writes',()=>{
 const s=source(appPath);assert.match(s,/branches: \['work\/gis'\]/);assert.match(s,/cancel-in-progress: false/);assert.match(s,/contracts:[\s\S]*github.event_name == 'push'/);assert.match(s,/node --test tests\/unit\/library-auto-/);assert.doesNotMatch(s,/pages: write|id-token: write/);
});
test('receiver gates production before credentials and dependencies, pairs fixed full-history branches',()=>{
 const s=source(appPath);assert.match(s,/productionEnabled === true/);assert.ok(s.indexOf('productionEnabled === true')<s.indexOf('secrets.PANDOLAB_LIBRARY_WRITE_TOKEN'));assert.match(s,/context.ref !== `refs\/heads\/\$\{branch\}`/);assert.match(s,/repository: kimjeon-il\/PandoLab-library-data/);assert.equal((s.match(/fetch-depth: 0/g)||[]).length,2);assert.match(s,/LIBRARY_AUTO_BRANCH:/);assert.match(s,/LIBRARY_AUTO_DATA_SHA=/);assert.match(s,/node scripts\/library-auto-sync.mjs/);assert.match(s,/pnpm install --frozen-lockfile --ignore-scripts/);assert.match(s,/if: always\(\)/);
});
test('recovery is fixed main-only and no direct Pages dispatch exists',()=>{
 const s=source(appPath);assert.match(s,/cron: '17 \* \* \* \*'/);assert.match(s,/workflow_run:/);assert.match(s,/head_branch !== 'main'/);assert.doesNotMatch(s,/gh workflow run|web-pages.yml\/dispatches/);assert.match(s,/branch === 'main' && !enabled/);
});
test('data notifier has fixed URL, validated same branch and fail-closed token, no generation',{skip: !existsSync(dataPath) && 'notifier is independently installed in data repository'},()=>{
 const s=source(dataPath);assert.match(s,/branches: \['main', 'work\/gis'\]/);assert.match(s,/library.json/);assert.match(s,/objects\/\*\*/);assert.match(s,/archive\/index.json/);assert.match(s,/if \(!token\) throw new Error\('PANDO_AUTO_DATA_NOTIFY_TOKEN is required'\)/);assert.match(s,/https:\/\/api.github.com\/repos\/kimjeon-il\/Pando\/actions\/workflows\/library-data-auto-sync.yml\/dispatches/);assert.match(s,/ref: branch, inputs: \{data_revision: sha, data_branch: branch\}/);assert.doesNotMatch(s,/checkout@|pnpm |library-auto-sync.mjs|contents: write|console.log\(token/);
});

test('actual receiver gate rejects mismatched refs and disabled main, permits explicit work branch',async()=>{
 const {runInNewContext}=await import('node:vm');
 const s=source(appPath),script=s.split('          script: |\n')[1].split('\n  sync:')[0].split('\n').map(l=>l.slice(12)).join('\n');
 const gate=({event='workflow_dispatch',branch='main',ref=`refs/heads/${branch}`,enabled=false,sha='a'.repeat(40),head='main'}={})=>{
  const outputs={};
  runInNewContext(script,{require:()=>({readFileSync:()=>JSON.stringify({productionEnabled:enabled})}),process:{env:{DATA_BRANCH:branch,DATA_REVISION:sha}},context:{eventName:event,ref,payload:{workflow_run:{head_branch:head}}},core:{setOutput:(k,v)=>outputs[k]=v}});
  return outputs;
 };
 assert.equal(gate().allowed,'false');
 assert.equal(gate({branch:'work/gis'}).allowed,'true');
 assert.equal(gate({enabled:true}).allowed,'true');
 assert.equal(gate({event:'schedule'}).allowed,'false');
 assert.throws(()=>gate({branch:'work/gis',ref:'refs/heads/main'}),/branch mismatch/);
 assert.throws(()=>gate({sha:'$(danger)'}),/Invalid data revision/);
 assert.throws(()=>gate({event:'workflow_run',head:'work/gis'}),/Invalid recovery branch/);
});
