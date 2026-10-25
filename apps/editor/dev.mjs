import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {validateShellProfile} from './stage.mjs';
import {apkCertificateSha256} from './native-contract.mjs';
import {startDevelopmentServer,developmentOrigin} from '../../scripts/frontend-dev-server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export function selectAndroidDevice(output,serial){
  const devices=output.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(([name,state])=>state==='device'&&!name.startsWith('emulator-')).map(([name])=>name);
  if(serial){if(!devices.includes(serial))throw Error('Requested physical device is not connected and authorized');return serial;}
  if(devices.length!==1)throw Error('Connect one authorized physical Android device; specify --serial when multiple devices are connected');return devices[0];
}
export async function runNativeApplication({platform,mode='development',serial,repository=root}={}){
  const {fetchNativeArtifact}=await import('./packaged-artifacts.mjs');
  const {inspectWindowsBinary}=await import('./native-producer.mjs');
  const {nativeInputIdentity}=await import('./native-contract.mjs');
  let adb,reverseOwned=false,server,child,shutdown;
  if(platform==='android'){
    adb=args=>execFileSync('adb',args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:2*1024**2});
    serial=selectAndroidDevice(adb(['devices','-l']),serial);
    const abi=adb(['-s',serial,'shell','getprop','ro.product.cpu.abi']).trim();
    if(abi!=='arm64-v8a')throw Error('This physical-device development launcher requires arm64-v8a');
  }
  const artifact=await fetchNativeArtifact({root:repository,platform,mode});
  const identity=nativeInputIdentity(repository,{platform,mode});
  if(artifact.manifest.nativeInputSha256!==identity.sha256)throw Error('Native inputs changed during artifact preparation; restart development');
  try{
    if(mode==='development'){
      let health;try{health=await fetch(developmentOrigin+'/__shell/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());}catch{/* Binding below reports a different occupant. */}
      if(health&&(health.root!==resolve(repository)||health.profile!=='map-data'||health.product!=='editor'))throw Error('Port 4175 belongs to another worktree or profile');
      if(!health)server=await startDevelopmentServer({repository,profile:'map-data'});
    }
    if(platform==='windows'){
      const executable=resolve(artifact.directory,'pandolab-web-shell.exe'),info=inspectWindowsBinary(executable);
      if(info.nativeInputSha256!==identity.sha256||info.executionMode!==mode)throw Error('Native executable build-info differs from the verified artifact');
      child=spawn(executable,[],{env:process.env,stdio:'inherit',windowsHide:false});
      shutdown=()=>{if(child&&!child.killed)child.kill();};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
      await new Promise((res,rej)=>{child.once('error',rej);child.once('exit',(code,signal)=>code===0||signal?res():rej(Error('Native app exited with code '+code)));});
    }else{
      const packageName='com.pandolab.webshell.prototype';let installed='';
      try{installed=adb(['-s',serial,'shell','pm','path',packageName]);}catch(error){if(error.status!==1)throw error;}
      const base=installed.split(/\r?\n/).find(p=>p.startsWith('package:')&&p.endsWith('/base.apk'))?.slice(8);
      if(base){
        if(!/^\/data\/app\/[A-Za-z0-9_~+/=.:-]+\/base\.apk$/.test(base))throw Error('Unexpected installed Android package path');
        const bytes=execFileSync('adb',['-s',serial,'exec-out','cat',base],{windowsHide:true,maxBuffer:512*1024**2});
        if(apkCertificateSha256(bytes)!==artifact.manifest.androidCertificateSha256)throw Error('Installed Android certificate differs; existing app must not be uninstalled');
      }
      adb(['-s',serial,'install','-r','-t',resolve(artifact.directory,'app.apk')]);
      if(mode==='development'){
        const mapping=adb(['-s',serial,'reverse','--list']).split(/\r?\n/).find(s=>/\stcp:4175\s/.test(s));
        if(mapping&&!mapping.endsWith('tcp:4175'))throw Error('Device port 4175 belongs to another reverse mapping');
        if(!mapping){adb(['-s',serial,'reverse','tcp:4175','tcp:4175']);reverseOwned=true;}
      }
      adb(['-s',serial,'shell','am','force-stop',packageName]);adb(['-s',serial,'shell','am','start','-W','-n',packageName+'/.MainActivity']);
      console.log('Android '+mode+' ready on physical device '+serial);
      if(mode==='development')await new Promise(res=>{shutdown=res;process.once('SIGINT',res);process.once('SIGTERM',res);});
    }
  }finally{
    if(shutdown){process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
    if(reverseOwned)adb(['-s',serial,'reverse','--remove','tcp:4175']);
    if(server)await server.close();
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const platform=process.argv.find(a=>a.startsWith('--native='))?.slice(9);
 if(!platform)throw Error('Use --native=windows|android; frontend servers use the root dev:web or dev:editor command');
 validateShellProfile(process.env.PANDOLAB_SHELL_PROFILE||'map-data',false);
 await runNativeApplication({platform,mode:process.argv.includes('--offline')?'offline':'development',serial:process.argv.find(a=>a.startsWith('--serial='))?.slice(9)});
}
