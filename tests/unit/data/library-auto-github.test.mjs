import test from 'node:test';
import assert from 'node:assert/strict';
import {createGithubPages} from "../../../scripts/lib/library-auto-github.mjs";
const sha='a'.repeat(40);
test('missing auth fails before network',async()=>{await assert.rejects(()=>createGithubPages({token:'',fetch:()=>assert.fail()}).find(sha),/AUTH/);});
test('uncertain dispatch reconciles matching run without duplicate POST',async()=>{let posts=0,gets=0;const api=createGithubPages({token:'secret',fetch:async(url,o)=>{assert.ok(url.startsWith('https://api.github.com/repos/kimjeon-il/Pando/'));if(o.method==='POST'){posts++;throw Error('timeout');}gets++;return {ok:true,json:async()=>({workflow_runs:gets===1?[]:[{id:12,head_sha:sha,head_branch:'main',path:'.github/workflows/web-pages.yml',status:'in_progress'}]})};}});assert.equal((await api.dispatch(sha,{productionEnabled:true})).id,12);assert.equal(posts,1);});
test('work branch or disabled policy cannot dispatch',async()=>{const api=createGithubPages({token:'s',fetch:()=>assert.fail()});await assert.rejects(()=>api.dispatch(sha,{productionEnabled:false}),/DISABLED/);await assert.rejects(()=>api.dispatch(sha,{productionEnabled:true,branch:'work/gis'}),/DISABLED/);});
test('successful run without live evidence remains pending',async()=>{const api=createGithubPages({token:'s',fetch:async()=>({ok:true,json:async()=>({workflow_runs:[{id:1,head_sha:sha,head_branch:'main',path:'.github/workflows/web-pages.yml',status:'completed',conclusion:'success'}]})})});assert.equal((await api.verify(sha)).status,'pending');});

import {verifyArtifactLive} from "../../../scripts/lib/library-auto-github.mjs";
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
test('real bounded ZIP fixed entry and official live verifier prove app/data hashes; redirect strips auth',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pando-evidence-test-'));try{
  const data='b'.repeat(40),assets={'index.html':Buffer.from('page'),'assets/js/build-meta.js':Buffer.from('const meta = Object.freeze('+JSON.stringify({sourceCommit:sha,dataCommit:data,dataRevision:data})+');')};
  const evidence={schema:'pando-web-pages-staging',sourceCommit:sha,dataCommit:data,files:Object.entries(assets).map(([path,b])=>({path,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}))};
  writeFileSync(join(dir,'pages-evidence.json'),JSON.stringify(evidence));
  if(process.platform==='win32')execFileSync(join(process.env.SystemRoot,'System32','tar.exe'),['-a','-cf','evidence.zip','pages-evidence.json'],{cwd:dir});
  else execFileSync('zip',['-q','evidence.zip','pages-evidence.json'],{cwd:dir});
  const zip=readFileSync(join(dir,'evidence.zip'));
  let redirected=false;
  const result=await verifyArtifactLive({run:{id:1,head_sha:sha},expected:{dataSha:data},token:'secret',api:async p=>{assert.equal(p,'actions/runs/1/artifacts?per_page=100');return {artifacts:[{id:4,name:'pages-evidence-'+sha,size_in_bytes:zip.length,expired:false}]};},fetch:async(url,options)=>{
   const u=new URL(url);if(u.hostname==='api.github.com'){assert.equal(options.headers.Authorization,'Bearer secret');return {status:302,headers:new Headers({location:'https://storage.blob.core.windows.net/zip'})};}
   if(u.hostname==='storage.blob.core.windows.net'){assert.equal(options.headers,undefined);redirected=true;return new Response(zip);}
   assert.equal(u.origin,'https://kimjeon-il.github.io');return new Response(assets[u.pathname.slice('/Pando/'.length)]);
  }});
  assert.equal(result.verified,true);assert.equal(result.checkedFiles,2);assert.equal(redirected,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('artifact redirect to untrusted host is rejected before second fetch',async()=>{let calls=0;await assert.rejects(()=>verifyArtifactLive({run:{id:1,head_sha:sha},expected:{dataSha:'b'.repeat(40)},token:'s',api:async()=>({artifacts:[{id:1,name:'pages-evidence-'+sha,size_in_bytes:1}]}),fetch:async()=>{calls++;return {status:302,headers:new Headers({location:'https://evil.example/zip'})};}}),/UNTRUSTED/);assert.equal(calls,1);});
