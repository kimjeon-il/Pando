import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {instrument} from './w2-p3-instrument.mjs';
const base=process.env.PANDOLAB_W3_EVIDENCE;
if(!base)throw Error('Specify evidence directory');
const revision='5eb7be55208efaafe39bd5a65ec2f111d70b9053';
const index=JSON.parse(execFileSync('git',['show',revision+':archive/index.json'],{cwd:'D:/dev/PandoLab-library-data',maxBuffer:32*1024**2}));
const materialized='D:/dev/PandoLab-library-data/.pando-cache/materialized/ui/'+revision;
const sources=process.env.PANDOLAB_W3_LATEST?[[process.env.PANDOLAB_W3_LATEST,4203,null]]:[['D:/dev/worktrees/w2-p3-before',4201,'7c1c55e2a47b03177104bd4a54452692a80674b1'],['D:/dev/worktrees/w2-p3-after',4202,'fe8282ba32761ab9586348d1712e11cc1f4e7882']];
for(const [root,port,expected]of sources){
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();if(expected&&sha!==expected)throw Error('Source mismatch');
 if(JSON.parse(readFileSync(root+'/config/library-data.json')).revision!==revision)throw Error('Data pin changed');
 const {buildFrontendSnapshot}=await import('file:///'+root+'/scripts/lib/frontend-build.mjs');
 const {developmentAssets}=await import('file:///'+root+'/scripts/frontend-dev-server.mjs');
 const {createP3PreviewServer}=await import('file:///'+root+'/scripts/p3-preview-server.mjs');
 const version=process.env.PANDOLAB_W3_INSTRUMENT_VERSION||'v2';const dir=base+'/instrumented-'+port+'-'+version;mkdirSync(dir,{recursive:true});
 const snapshot=await buildFrontendSnapshot({root,readPinnedData:path=>readFileSync(materialized+'/'+path),dataPaths:Object.keys(index.files).filter(p=>p.startsWith('assets/data/')),readSourceBytes:path=>{const bytes=readFileSync(root+'/'+path);if(!/\.[cm]?js$/.test(path))return bytes;const original=bytes.toString('utf8').replaceAll('\r\n','\n'),result=instrument(path,original);if(result!==original)writeFileSync(dir+'/'+path.replaceAll('/','__'),result,{flag:'wx'});return Buffer.from(result);}});
 const {assets}=await developmentAssets({repository:root,product:'viewer',prepared:{revision,files:index.files,materialized},snapshot});for(const [path,asset]of snapshot.assets)assets.set(path,{bytes:asset.bytes});
 const server=createP3PreviewServer(root,{assets:()=>assets,reports:false});await new Promise(r=>server.listen(port,'127.0.0.1',r));const meta={port,source:snapshot.sourceCommit,input:snapshot.sourceSha256,revision};writeFileSync(base+'/server-'+port+'-'+version+'.json',JSON.stringify(meta),{flag:'wx'});console.log(meta);
}
