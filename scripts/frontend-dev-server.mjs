import {watch,readFileSync,statSync,realpathSync,existsSync} from 'node:fs';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createP3PreviewServer,previewFileIdentity} from './p3-preview-server.mjs';
import {buildFrontendSnapshot} from './lib/frontend-build.mjs';
import {frontendRoots,frontendTemplates,frontendFragmentRoot} from './lib/frontend-layout.mjs';
import {prepareLibraryData,libraryMaterializedRoot,libraryRuntimeLeasePath} from '../tools/library-data.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const developmentOrigin='http://127.0.0.1:4175';
export async function developmentAssets({repository,product,prepared}){
 if(product==='editor')return (await import('../apps/editor/stage.mjs')).createDevelopmentAssets({root:repository});
 const snapshot=await buildFrontendSnapshot({root:repository}),assets=new Map();
 for(const path of snapshot.viewerPaths){
  if(snapshot.assets.has(path)){assets.set(path,{bytes:snapshot.assets.get(path).bytes});continue;}
  if(!path.startsWith('assets/data/')||!prepared?.files[path])throw Error('Unowned viewer data resource: '+path);
  const file=realpathSync(resolve(prepared.materialized,path)),stats=statSync(file,{bigint:true});
  if(Number(stats.size)!==prepared.files[path].bytes)throw Error('Pinned viewer data size changed: '+path);
  assets.set(path,{file,identity:previewFileIdentity(stats)});
 }
 return{assets,evidence:{sourceCommit:snapshot.sourceCommit,frontendInputSha256:snapshot.sourceSha256,dataCommit:prepared.revision,product}};
}
export async function startDevelopmentServer({repository=root,product='editor',port=product==='viewer'?4173:4175,profile='map-data',observe=true,prepareLibrary=prepareLibraryData,buildAssets=developmentAssets}={}){
 repository=resolve(repository);if(!['viewer','editor'].includes(product))throw Error('Unknown frontend product');
 if(profile!=='map-data')throw Error('A development frontend cannot use verification fixtures');
 let preparedPin=null,prepared,current,revision=0,error=null,pending=null,dirty=false,timer;
 const watchers=[],lease=libraryRuntimeLeasePath(repository,product);
 const prepare=()=>{const next=readFileSync(resolve(repository,'config/library-data.json'),'utf8');if(next!==preparedPin){prepared=prepareLibrary({root:repository});preparedPin=next;}};
 prepare();current=await buildAssets({repository,product,prepared,profile});
 const reloadSource=Buffer.from(`let revision;async function check(){try{const state=await fetch('/__shell/health',{cache:'no-store'}).then(r=>r.json());if(revision!==undefined&&revision!==state.revision){location.reload();return;}revision=state.revision;}catch{}setTimeout(check,1000);}check();`);
 const decorate=()=>{const html=current.assets.get('index.html').bytes;current.assets.set('index.html',{bytes:Buffer.concat([html,Buffer.from('<script type="module" src="/__frontend/reload.js"></script>')])});current.assets.set('__frontend/reload.js',{bytes:reloadSource});};
 decorate();
 const updateLease=async()=>{await mkdir(dirname(lease),{recursive:true});await writeFile(lease,JSON.stringify({pid:process.pid,root:repository,product,materialized:[libraryMaterializedRoot(repository)]}));};
 async function refresh(){dirty=true;if(pending)return pending;pending=(async()=>{do{dirty=false;try{prepare();const next=await buildAssets({repository,product,prepared,profile});current=next;decorate();if(observe)await updateLease();error=null;revision++;}catch(failure){error=failure.message;console.error('Development assets rejected:',error);}}while(dirty);})().finally(()=>{pending=null;});return pending;}
 const configuration=product==='editor'?JSON.parse(readFileSync(resolve(repository,'apps/editor/src-tauri/tauri.conf.json'),'utf8')):null;
 const server=createP3PreviewServer(repository,{reports:product==='editor',assets:()=>current.assets,handleRequest(request,response,pathname){
  if(pathname==='/__shell/health'){response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({root:repository,product,profile,revision,error,executionMode:'development'}));return true;}
  if(configuration&&(pathname==='/'||pathname==='/index.html')){const hashes=[...current.assets.get('index.html').bytes.toString().matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>`'sha256-${createHash('sha256').update(m[1].replace(/\r\n?/g,'\n')).digest('base64')}'`).join(' ');response.setHeader('Content-Security-Policy',configuration.app.security.csp.replace("script-src 'self'",`script-src 'self' ${hashes}`));}
  return false;
 }});
 await new Promise((yes,no)=>server.once('error',no).listen(port,'127.0.0.1',yes));if(observe)await updateLease();
 if(observe){const changed=(_event,name)=>{if(name&&/(?:^|[/\\])(?:node_modules|dist|target|gen|\.library-data)(?:[/\\]|$)/.test(name))return;clearTimeout(timer);timer=setTimeout(()=>{refresh().catch(failure=>console.error(failure));},250);};
  const paths=new Map(frontendRoots.map(e=>[e.sourcePath,!e.shallow]));for(const path of Object.values(frontendTemplates))paths.set(path.slice(0,path.lastIndexOf('/')),true);paths.set(frontendFragmentRoot,true);paths.set('config',false);
  for(const [path,recursive]of paths)if(existsSync(resolve(repository,path)))watchers.push(watch(resolve(repository,path),{recursive},changed));
 }
 return{server,refresh,get evidence(){return current.evidence;},async close(){clearTimeout(timer);for(const watcher of watchers)watcher.close();if(pending)await pending;await new Promise(yes=>server.close(yes));if(observe)await unlink(lease);}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const product=process.argv.find(a=>a.startsWith('--product='))?.slice(10);if(!product)throw Error('Specify --product=viewer|editor');
 const app=await startDevelopmentServer({product});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);}));
 console.log('Frontend ready: '+product+' http://127.0.0.1:'+app.server.address().port);
}
