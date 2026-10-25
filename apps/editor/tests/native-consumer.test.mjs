import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNativeRun} from '../packaged-artifacts.mjs';
import {fetchNativeArtifact} from '../packaged-artifacts.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {nativeHash,nativeInputIdentity} from '../native-contract.mjs';
test('remote artifact selection rejects another workflow, source commit or fork',()=>{
 const expected={head:'a'.repeat(40),workflowId:17,repository:'owner/repo',title:'Native windows development'},good={id:1,head_sha:'a'.repeat(40),workflow_id:17,head_repository:{full_name:'owner/repo'},display_title:'Native windows development'};
 for(const candidate of [{...good,workflow_id:18},{...good,head_sha:'b'.repeat(40)},{...good,head_repository:{full_name:'other/repo'}},{...good,display_title:'Other task'}])assert.equal(selectNativeRun([candidate],expected),null);
 assert.equal(selectNativeRun([good],expected).id,1);
});
function consumer(t,{expired=false,changed=false,transient=false,interrupted=false}={}){
 const root=mkdtempSync(join(tmpdir(),'pando-native-client-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const put=(p,value)=>{mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),typeof value==='string'?value:JSON.stringify(value));};
 for(const p of ['Cargo.toml','Cargo.lock','build.rs','src/lib.rs'])put('apps/editor/src-tauri/'+p,'native source\n');put('apps/editor/src-tauri/tauri.conf.json',{});put('apps/editor/src-tauri/tauri.dev.json',{});put('apps/editor/package.json',{devDependencies:{'@tauri-apps/cli':'2.12.3'}});put('config/toolchain-versions.json',{rust:'1.99.1'});put('config/library-data.json',{repository:'owner/data',revision:'a'.repeat(40)});put('config/native-artifacts.json',{schema:1,repository:'owner/repo',workflow:'remote-development-p1.yml',androidCertificateSha256:'a'.repeat(64)});put('.gitignore','cache/\n.library-data/\n');
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git(['init','-q','-b','work/ui']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','.']);git(['commit','-qm','native inputs']);git(['remote','add','origin',root]);mkdirSync(join(root,'cache'));put('.git/pando-storage.json',{schema:'pando-worktree-storage-v1',cacheRoot:join(root,'cache'),compilerEnabled:false});
 const head=git(['rev-parse','HEAD']),identity=nativeInputIdentity(root,{platform:'windows',mode:'development'}),bytes=Buffer.from('fixture executable');let attempt=1,reruns=0,reads=0,downloads=0;const run=()=>({id:101,head_sha:head,workflow_id:17,head_repository:{full_name:'owner/repo'},display_title:`Native windows development ${head}`,html_url:'https://github.com/owner/repo/actions/runs/101',status:'completed',conclusion:'success',run_attempt:attempt});
 const github=args=>{
   if(args[0]==='api'){if(transient&&reads++===0)throw Object.assign(Error('temporary Windows process spawn'),{code:'UNKNOWN'});const endpoint=args.at(-1);if(endpoint.endsWith('remote-development-p1.yml'))return JSON.stringify({id:17});if(endpoint.includes('/runs?'))return JSON.stringify({workflow_runs:[run()]});if(endpoint.includes('/artifacts?'))return JSON.stringify({artifacts:[{name:`native-windows-development-${head}`,expired:expired&&attempt===1,size_in_bytes:20}]});}
   if(args[0]==='run'&&args[1]==='rerun'){attempt++;reruns++;return '';}
   if(args[0]==='run'&&args[1]==='download'){const directory=args[args.indexOf('--dir')+1];mkdirSync(directory,{recursive:true});downloads++;writeFileSync(join(directory,'pandolab-web-shell.exe'),changed||interrupted&&downloads===1?'corrupt':bytes);writeFileSync(join(directory,'native-artifact.json'),JSON.stringify({schema:1,sourceCommit:head,nativeInputSha256:identity.sha256,platform:'windows',target:identity.target,mode:'development',toolchainVersion:'1.99.1',files:[{path:'pandolab-web-shell.exe',bytes:bytes.length,sha256:nativeHash(bytes)}]}));if(interrupted&&downloads===1)throw Error('connection lost while downloading');return '';}
   throw Error('Unexpected GitHub operation '+args.join(' '));
 };return{root,github,reruns:()=>reruns};
}
test('a real Git source resolves to an immutable CI view and cached execution needs no GitHub access',async t=>{const c=consumer(t),first=await fetchNativeArtifact({...c,pollMs:1,timeoutMs:10000});assert.equal(first.cached,false);const next=await fetchNativeArtifact({...c,github:()=>{throw Error('must stay offline');}});assert.equal(next.cached,true);assert.equal(first.directory,next.directory);assert.equal(readFileSync(join(next.directory,'pandolab-web-shell.exe'),'utf8'),'fixture executable');});
test('changed downloaded bytes never replace the active branch pointer',async t=>{const c=consumer(t,{changed:true});await assert.rejects(fetchNativeArtifact({...c,pollMs:1,timeoutMs:10000}),/hash|bytes/i);assert.equal(existsSync(join(c.root,'.library-data/native-artifacts.json')),false);});
test('an expired artifact reruns its exact source workflow once and resumes the request',async t=>{const c=consumer(t,{expired:true});const result=await fetchNativeArtifact({...c,pollMs:1,timeoutMs:10000});assert.equal(result.cached,false);assert.equal(c.reruns(),1);});
test('a transient Windows gh read spawn is retried without duplicating a workflow request',async t=>{const c=consumer(t,{transient:true});assert.equal((await fetchNativeArtifact({...c,pollMs:1,timeoutMs:10000})).cached,false);});
test('a partial failed download retries without replacing a running runtime or requiring a compiler',async t=>{const c=consumer(t,{interrupted:true});await assert.rejects(fetchNativeArtifact({...c,pollMs:1,timeoutMs:10000}),/connection lost/);assert.equal(existsSync(join(c.root,'.library-data/native-artifacts.json')),false);assert.equal((await fetchNativeArtifact({...c,pollMs:1,timeoutMs:10000})).cached,false);});
