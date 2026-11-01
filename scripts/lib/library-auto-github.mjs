import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyPagesDeployment} from '../../tools/verify-pages-deployment.mjs';
// Fixed GitHub authority. No repository, URL, ref, workflow or executable from events.
const BASE='https://api.github.com/repos/kimjeon-il/Pando/';
const SHA=/^(?!0{40}$)[a-f0-9]{40}$/;
function fail(code){throw Object.assign(Error(code),{code});}
export function createGithubPages({token=process.env.GITHUB_TOKEN,fetch=globalThis.fetch,verifyLive=undefined}={}){
 async function api(path,{method='GET',body}={}){
  if(!token)fail('GITHUB_AUTH_MISSING');
  const response=await fetch(BASE+path,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)fail('GITHUB_HTTP_'+response.status);
  return response.status===204?null:response.json();
 }
 async function find(appSha){
  if(!SHA.test(appSha))fail('INVALID_APP_SHA');
  const result=await api('actions/workflows/web-pages.yml/runs?branch=main&per_page=100');
  return (result.workflow_runs||[]).filter(r=>r.head_sha===appSha&&r.head_branch==='main'&&r.path==='.github/workflows/web-pages.yml').sort((a,b)=>b.id-a.id)[0]||null;
 }
 async function dispatch(appSha,{productionEnabled=false,branch='main'}={}){
  if(!productionEnabled||branch!=='main')fail('PRODUCTION_DISABLED');
  if(!SHA.test(appSha))fail('INVALID_APP_SHA');
  const existing=await find(appSha);if(existing&&!(existing.status==='completed'&&existing.conclusion!=='success'))return existing;
  try{
   const receipt=await api('actions/workflows/web-pages.yml/dispatches',{method:'POST',body:{ref:'main',return_run_details:true}});
   // Even a returned run id is reconciled against immutable workflow/head identity.
   const run=await find(appSha);if(run&&run.id!==existing?.id)return run;
   return {status:'pending',...(receipt?.workflow_run_id?{id:receipt.workflow_run_id}:{})};
  }catch(error){const run=await find(appSha);if(run&&run.id!==existing?.id)return run;throw Object.assign(Error('DISPATCH_UNCERTAIN'),{code:'DISPATCH_UNCERTAIN',cause:error});}
 }
 async function verify(appSha,expected){
  const run=await find(appSha);if(!run)return {status:'pending',reason:'run-not-visible'};
  if(run.status!=='completed')return {status:'pending',run};
  if(run.conclusion!=='success')return {status:'failed',run};
  // A successful Actions run is not Pages artifact/live evidence.
  let evidence;
  try { evidence=await (verifyLive===undefined?verifyArtifactLive:verifyLive)?.({run,expected,api,token,fetch}); } catch { return {status:'pending',reason:'live-evidence-unavailable',run}; }
  return evidence?.verified===true?{status:'verified',run,evidence}:{status:'pending',reason:'live-evidence-unavailable',run};
 }
 return {find,dispatch,verify};
}

/** Bounded ZIP download, fixed entry only; artifact redirects never receive auth. */
export async function verifyArtifactLive({run,expected,api,token,fetch=globalThis.fetch}){
 if(!Number.isSafeInteger(run.id)||run.id<=0||!SHA.test(expected?.dataSha||''))fail('INVALID_EVIDENCE_IDENTITY');
 const listing=await api(`actions/runs/${run.id}/artifacts?per_page=100`);
 const item=(listing.artifacts||[]).find(a=>a.name===`pages-evidence-${run.head_sha}`&&!a.expired);
 if(!item||!Number.isSafeInteger(item.id)||item.id<=0||!Number.isSafeInteger(item.size_in_bytes)||item.size_in_bytes>16*1024*1024)fail('ARTIFACT_UNAVAILABLE');
 let response=await fetch(BASE+`actions/artifacts/${item.id}/zip`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},redirect:'manual',signal:AbortSignal.timeout(30000)});
 if([301,302,303,307,308].includes(response.status)){
  const url=new URL(response.headers.get('location'));
  if(url.protocol!=='https:'||url.username||url.password||!/(?:^|\.)(?:blob\.core\.windows\.net|githubusercontent\.com|amazonaws\.com)$/.test(url.hostname))fail('UNTRUSTED_ARTIFACT_REDIRECT');
  response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
 }
 if(!response.ok)fail('ARTIFACT_DOWNLOAD_FAILED');
 const length=Number(response.headers.get('content-length'));if(length>16*1024*1024)fail('ARTIFACT_TOO_LARGE');
 const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>16*1024*1024)fail('ARTIFACT_TOO_LARGE');chunks.push(Buffer.from(chunk));}
 const dir=mkdtempSync(join(tmpdir(),'pando-auto-evidence-'));
 let evidence;
 try{const path=join(dir,'evidence.zip');writeFileSync(path,Buffer.concat(chunks));evidence=JSON.parse(execFileSync('unzip',['-p',path,'pages-evidence.json'],{maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']}));}finally{rmSync(dir,{recursive:true,force:true});}
 if(evidence.sourceCommit!==run.head_sha||evidence.dataCommit!==expected.dataSha)fail('ARTIFACT_IDENTITY_MISMATCH');
 const verified=await verifyPagesDeployment({baseUrl:'https://kimjeon-il.github.io/Pando/',evidence,fetchFn:(url,options)=>{const u=new URL(url);if(u.origin!=='https://kimjeon-il.github.io'||!u.pathname.startsWith('/Pando/'))fail('INVALID_LIVE_URL');return fetch(u,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});}});
 return {verified:true,...verified,artifactId:item.id};
}
