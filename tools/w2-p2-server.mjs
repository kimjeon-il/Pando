import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {instrument} from './w2-p2-instrument.mjs';
const root='D:/dev/worktrees/w2-p2-diagnostic';
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!=='69a34dceccdf4b348dfaaab79fa5dc712a169e53')throw Error('Diagnostic checkout is not the W1 source');
const {buildFrontendSnapshot}=await import('file:///'+root+'/scripts/lib/frontend-build.mjs');
const {developmentAssets}=await import('file:///'+root+'/scripts/frontend-dev-server.mjs');
const {createP3PreviewServer}=await import('file:///'+root+'/scripts/p3-preview-server.mjs');
const revision='5eb7be55208efaafe39bd5a65ec2f111d70b9053';
const index=JSON.parse(execFileSync('git',['show',revision+':archive/index.json'],{cwd:'D:/dev/PandoLab-library-data',maxBuffer:32*1024**2}));
const materialized='D:/dev/PandoLab-library-data/.pando-cache/materialized/ui/'+revision;
function transform(path,source,enabled){
 if(!enabled)return source;
 source=instrument(path,source);
 if(path.endsWith('/viewer-composition.js')){
  const replace=(a,b)=>{if(source.split(a).length!==2)throw Error('Viewer anchor '+a);source=source.replace(a,b);};
  replace('applyMonth:async(month,{isCurrent,commit})=>{',"applyMonth:async(month,{isCurrent,commit})=>{globalThis.__w2Mark?.('transition','requested',{month});");
  replace("onPresented:()=>{commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}","onPresented:()=>{commit();globalThis.__w2Mark?.('transition','presented',{month});window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}");
  replace("status.dataset.ready='true';","status.dataset.ready='true';globalThis.__w2Mark?.('transition','ready');");
 }
 return source;
}
for(const [enabled,port] of [[false,4190],[true,4191]]){
 const snapshot=await buildFrontendSnapshot({root,readPinnedData:path=>readFileSync(materialized+'/'+path),dataPaths:Object.keys(index.files).filter(p=>p.startsWith('assets/data/')),readSourceBytes:path=>{const bytes=readFileSync(root+'/'+path);return /\.[cm]?js$/.test(path)?Buffer.from(transform(path,bytes.toString('utf8'),enabled)):bytes;}});
 const {assets}=await developmentAssets({repository:root,product:'viewer',prepared:{revision,files:index.files,materialized},snapshot});
 for(const [path,asset]of snapshot.assets)assets.set(path,{bytes:asset.bytes});
 const server=createP3PreviewServer(root,{assets:()=>assets,reports:false});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));console.log(JSON.stringify({port,enabled,source:snapshot.sourceCommit,input:snapshot.sourceSha256}));
}
