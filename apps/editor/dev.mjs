import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setInterval,clearInterval} from 'node:timers';
import {validateShellProfile} from './stage.mjs';
import {startDevelopmentServer,developmentOrigin} from '../../scripts/frontend-dev-server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));

export async function waitForDevelopmentStop(){
  const keepAlive=setInterval(()=>{},60_000);let stop;
  try{await new Promise(resolve=>{stop=resolve;process.once('SIGINT',stop);process.once('SIGTERM',stop);});}
  finally{clearInterval(keepAlive);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
/** Windows reviewer only. Mobile users use the ordinary responsive Web viewer. */
export async function runNativeApplication({platform='windows',mode='development',repository=root}={}){
  if(platform!=='windows')throw Error('Only the Windows read-only reviewer is supported');
  const {fetchNativeArtifact}=await import('./packaged-artifacts.mjs');
  const {inspectWindowsBinary}=await import('./native-producer.mjs');
  const {nativeInputIdentity}=await import('./native-contract.mjs');
  const artifact=await fetchNativeArtifact({root:repository,platform,mode});
  const identity=nativeInputIdentity(repository,{platform,mode});
  if(artifact.manifest.nativeInputSha256!==identity.sha256)
    throw Error('Native inputs changed during artifact preparation; restart development');
  let server,child,shutdown;
  try{
    if(mode==='development'){
      let health;
      try{health=await fetch(developmentOrigin+'/__shell/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());}
      catch{/* An absent server will be started below. */}
      if(health&&(health.root!==resolve(repository)||health.profile!=='map-data'||health.product!=='editor'))
        throw Error('Port 4175 belongs to another worktree or profile');
      if(!health)server=await startDevelopmentServer({repository,profile:'map-data'});
    }
    const executable=resolve(artifact.directory,'pandolab-web-shell.exe'),info=inspectWindowsBinary(executable);
    if(info.nativeInputSha256!==identity.sha256||info.executionMode!==mode)
      throw Error('Native executable build-info differs from the verified artifact');
    child=spawn(executable,[],{env:process.env,stdio:'inherit',windowsHide:false});
    shutdown=()=>{if(child&&!child.killed)child.kill();};
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
    await new Promise((res,rej)=>{child.once('error',rej);child.once('exit',(code,signal)=>
      code===0||signal?res():rej(Error('Windows reviewer exited with code '+code)));});
  }finally{
    if(shutdown){process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
    if(server)await server.close();
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const platform=process.argv.find(a=>a.startsWith('--native='))?.slice(9)||'windows';
  validateShellProfile(process.env.PANDOLAB_SHELL_PROFILE||'map-data',false);
  await runNativeApplication({platform,mode:process.argv.includes('--offline')?'offline':'development'});
}
