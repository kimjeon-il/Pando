import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {verifyNativeTool} from '../native-tool.mjs';
import {qgisNativeSourceFiles,requestNativeQgis,validateNativeQgisConfig} from './native-client.mjs';

function safePath(value){
  if(typeof value!=='string'||!isAbsolute(value)||/["%!?^&|<>\r\n,]/.test(value))throw Error('An absolute QGIS path without command or settings metacharacters is required');
  return resolve(value);
}
export function prepareNativeProfile(config,artifactDirectory){
  const root=safePath(config.profilesRoot),artifact=safePath(artifactDirectory);
  if(typeof config.profile!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(config.profile))throw Error('A dedicated native QGIS profile name is required');
  const parent=join(root,'profiles'),profile=join(parent,config.profile),settings=join(profile,'QGIS','QGIS3.ini');
  const pluginPath=artifact.replaceAll('\\','/');
  if(!existsSync(profile)){
    mkdirSync(parent,{recursive:true});mkdirSync(profile);mkdirSync(join(profile,'QGIS'));
    writeFileSync(settings,`[Plugins]\npando_qgis_bridge=true\nsearchPathsForPlugins=${pluginPath}\n`,{flag:'wx'});
  }else{
    if(!existsSync(settings))throw Error('Existing QGIS profile is not configured for the native bridge; preserve it');
    let group='',enabled=false,path='';
    for(const line of readFileSync(settings,'utf8').split(/\r?\n/)){
      const heading=line.match(/^\s*\[([^\]]+)\]\s*$/);if(heading){group=heading[1].toLowerCase();continue;}
      if(group!=='plugins')continue;
      const entry=line.match(/^\s*([^=]+)=(.*)$/);if(!entry)continue;
      if(entry[1].trim().toLowerCase()==='pando_qgis_bridge')enabled=entry[2].trim().toLowerCase()==='true';
      if(entry[1].trim().toLowerCase()==='searchpathsforplugins')path=entry[2].trim();
    }
    if(!enabled||path!==pluginPath)throw Error('Existing QGIS profile differs from the dedicated native bridge settings; preserve it');
  }
  return settings;
}
export async function startNativeQgis(config,{root,signal,qgisIsRunning=()=>{
  const rows=execFileSync('tasklist.exe',['/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true});
  return rows.split(/\r?\n/).some(row=>/^"qgis(?:-ltr)?-bin\.exe",/i.test(row));
}}={}){
  signal?.throwIfAborted();validateNativeQgisConfig(config);
  if(process.platform!=='win32')throw Error('Native QGIS startup currently requires Windows');
  const projectRoot=resolve(root),artifact=safePath(config.artifactDirectory),qgisRoot=safePath(config.qgisRoot),profilesRoot=safePath(config.profilesRoot);
  const verified=verifyNativeTool({root:projectRoot,directory:artifact,target:'qgis-native-bridge',executable:'pando_qgis_bridge.dll',sourceFiles:qgisNativeSourceFiles});
  if(verified.manifest.runtimeVersion!=='qgis-3.44.15-qt-5.15.13')throw Error('Native QGIS artifact runtime mismatch');
  const launcher=join(qgisRoot,'bin','qgis-ltr.bat');if(!statSync(launcher).isFile())throw Error('QGIS LTR launcher is not a regular file');
  try{
    const existing=await requestNativeQgis(config,{command:'status'},{signal,timeoutMs:3000});
    if(existing.transport!=='pando-native-v1'||!/^3\.44\.15(?:-|$)/.test(existing.qgis_version))throw Error('Occupied QGIS port has an unexpected native service');
    return existing;
  }catch(error){if(error.cause?.code!=='ECONNREFUSED')throw error;}
  if(await qgisIsRunning())throw Error('QGIS is already running without this authenticated bridge; preserve the existing instance');
  prepareNativeProfile(config,artifact);
  const command=`""${launcher}" --nologo --noversioncheck --profiles-path "${profilesRoot}" --profile "${config.profile}""`;
  const child=spawn(process.env.ComSpec||'cmd.exe',['/d','/s','/c',command],{windowsVerbatimArguments:true,windowsHide:true,detached:true,
    stdio:'ignore',env:{...process.env,PANDO_QGIS_NATIVE_TOKEN:config.token,PANDO_QGIS_NATIVE_PORT:String(config.port)}});
  await once(child,'spawn');child.unref();
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    signal?.throwIfAborted();
    try{
      const result=await requestNativeQgis(config,{command:'status'},{signal,timeoutMs:2000});
      if(result.transport!=='pando-native-v1'||!/^3\.44\.15(?:-|$)/.test(result.qgis_version))throw Error('Unexpected native QGIS service');
      return result;
    }catch(error){if(error.cause?.code!=='ECONNREFUSED'&&!/timed out/.test(error.message))throw error;}
    await delay(500,undefined,{signal});
  }
  throw Error('Managed native QGIS did not start; inspect its dedicated profile');
}
