import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {instrument} from './w2-p4-2-instrument.mjs';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');
const root='D:/dev/worktrees/w2-p3-after',revision='5eb7be55208efaafe39bd5a65ec2f111d70b9053';
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!=='fe8282ba32761ab9586348d1712e11cc1f4e7882')throw Error('Unexpected source');
const index=JSON.parse(execFileSync('git',['show',revision+':archive/index.json'],{cwd:'D:/dev/PandoLab-library-data',maxBuffer:32*1024**2}));
const materialized='D:/dev/PandoLab-library-data/.pando-cache/materialized/ui/'+revision;
const {buildFrontendSnapshot}=await import('file:///'+root+'/scripts/lib/frontend-build.mjs');
const {developmentAssets}=await import('file:///'+root+'/scripts/frontend-dev-server.mjs');
const {createP3PreviewServer}=await import('file:///'+root+'/scripts/p3-preview-server.mjs');
for(const [name,port,stepBytes] of [['A',4211,262144],['B',4212,1048576],['A2',4213,262144]]){
 const version=process.env.PANDOLAB_W4_VERSION||'v2';const dir=base+'/instrumented-'+name+'-'+version;mkdirSync(dir,{recursive:true});
 const snapshot=await buildFrontendSnapshot({root,readPinnedData:p=>readFileSync(materialized+'/'+p),dataPaths:Object.keys(index.files).filter(p=>p.startsWith('assets/data/')),readSourceBytes:p=>{const bytes=readFileSync(root+'/'+p);if(!/\.[cm]?js$/.test(p))return bytes;const original=bytes.toString('utf8').replaceAll('\r\n','\n'),result=instrument(p,original,{stepBytes,early:version!=='v2'});if(result!==original)writeFileSync(dir+'/'+p.replaceAll('/','__'),result,{flag:'wx'});return Buffer.from(result);}});
 const {assets}=await developmentAssets({repository:root,product:'viewer',prepared:{revision,files:index.files,materialized},snapshot});for(const [p,a] of snapshot.assets)assets.set(p,{bytes:a.bytes});
 const server=createP3PreviewServer(root,{assets:()=>assets,reports:false});await new Promise(r=>server.listen(port,'127.0.0.1',r));writeFileSync(base+'/server-'+name+'-'+version+'.json',JSON.stringify({port,stepBytes,source:snapshot.sourceCommit,revision}),{flag:'wx'});console.log('W4_SERVER',name,port);
}
