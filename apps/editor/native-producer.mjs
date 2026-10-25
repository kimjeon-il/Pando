// CI compilation is separate from artifact transport so its actual recipe is hashed.
import {copyFile,mkdir,readFile,readdir,unlink,writeFile,stat} from 'node:fs/promises';
import {editorStageRoot} from '../../tools/worktree-storage.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {nativeInputIdentity,nativeTargets,nativeModes,nativeHash,apkCertificateSha256,verifyNativeBundle} from './native-contract.mjs';
const shell=fileURLToPath(new URL('./',import.meta.url));
const exists=path=>stat(path).then(()=>true,()=>false);
export function nativeBuildArguments(platform,mode) {
  if(!Object.hasOwn(nativeTargets,platform))throw Error('Unsupported native platform');
  if(!nativeModes.includes(mode))throw Error('Unsupported native mode');
  const android=platform.startsWith('android');
  return [...(android?['android','build']:['build']),'--debug',...(android?['--apk']:['--no-bundle']),'--target',
    android?(platform==='android'?'aarch64':'x86_64'):nativeTargets.windows,'--features',
    mode==='development'?'custom-protocol,development':mode==='verification'?'custom-protocol,verification':'custom-protocol'];
}
export function inspectWindowsBinary(path) {
  return JSON.parse(execFileSync(path, ['--build-info'], { encoding: 'utf8', timeout: 15_000, windowsHide: true }));
}
export function nativeCompilerInvocation(platform,args){
  return platform.startsWith('android')?{command:'pnpm',args:['exec','tauri',...args]}:{command:process.execPath,args:[resolve(shell,'node_modules/@tauri-apps/cli/tauri.js'),...args]};
}
export function nativeTestArguments(platform,mode){const args=nativeBuildArguments(platform,mode);return ['test','--locked','--manifest-path',resolve(shell,'src-tauri/Cargo.toml'),'--target',nativeTargets[platform],'--features',args[args.indexOf('--features')+1]];}
export async function buildNativeOnCI({root=resolve(shell,'../..'),platform,mode,output=resolve(root,'build-native/native-artifacts',platform,mode),test=false}={}){
  if(process.env.GITHUB_ACTIONS!=='true')throw Error('Native compilation runs only on GitHub Actions; request a remote build.');
  const identity=nativeInputIdentity(root,{platform,mode}),sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  const buildInfo={sourceCommit,nativeInputSha256:identity.sha256,platform,target:identity.target,mode,toolchainVersion:identity.toolchainVersion};
  const config=JSON.parse(await readFile(resolve(shell,'src-tauri',mode==='development'?'tauri.dev.json':mode==='verification'?'tauri.verification.json':'tauri.conf.json'),'utf8'));
  if(mode==='development'){
    const capability=JSON.parse(await readFile(resolve(shell,'src-tauri/capabilities/prototype-main.json'),'utf8'));
    delete capability.$schema;capability.remote={urls:['http://127.0.0.1:4175']};
    config.app={...config.app,security:{...config.app?.security,capabilities:[capability]}};
  }
  if(mode!=='development')config.build={...config.build,frontendDist:resolve(editorStageRoot(root),'dist')};
  const library=JSON.parse(await readFile(resolve(root,'config/library-data.json'),'utf8'));
  const env={...process.env,CARGO_INCREMENTAL:'0',PANDOLAB_NATIVE_BUILD_INFO:JSON.stringify(buildInfo),PANDOLAB_LIBRARY_REPOSITORY:library.repository,PANDOLAB_SHELL_PROFILE:'map-data',PANDOLAB_SHELL_DEVELOPMENT:mode==='development'?'1':'0',PANDOLAB_SHELL_VERIFICATION:mode==='verification'?'1':'0',TAURI_CONFIG:JSON.stringify(config)};
  await mkdir(output,{recursive:true});const overlay=resolve(output,'ci-config.json');await writeFile(overlay,JSON.stringify(config));
  const invocation=nativeCompilerInvocation(platform,[...nativeBuildArguments(platform,mode),'--config',overlay]);
  try{
    if(platform.startsWith('android')){
      const init=nativeCompilerInvocation(platform,['android','init','--ci']);
      execFileSync(init.command,init.args,{cwd:shell,env,stdio:'inherit',windowsHide:true});
      execFileSync(process.execPath,[resolve(shell,'src-tauri/sync-android.mjs')],{cwd:shell,env,stdio:'inherit',windowsHide:true});
    }
    execFileSync(invocation.command,invocation.args,{cwd:shell,env,stdio:'inherit',windowsHide:true});
  }
  finally{await unlink(overlay);}
  if(test)execFileSync('cargo',nativeTestArguments(platform,mode),{cwd:shell,env,stdio:'inherit',windowsHide:true});
  const files=[];async function copy(source,name){const bytes=await readFile(source);await copyFile(source,resolve(output,name));files.push({path:name,bytes:bytes.length,sha256:nativeHash(bytes)});}
  let certificate;
  if(platform==='windows'){
    await copy(resolve(shell,'src-tauri/target',identity.target,'debug/pandolab-web-shell.exe'),'pandolab-web-shell.exe');
    const build=resolve(shell,'src-tauri/target',identity.target,'debug/build');
    for(const entry of await readdir(build))if(entry.startsWith('webview2-com-sys-')){const dll=resolve(build,entry,'out/x64/WebView2Loader.dll');if(await exists(dll)){await copy(dll,'WebView2Loader.dll');break;}}
    const info=inspectWindowsBinary(resolve(output,'pandolab-web-shell.exe'));if(info.nativeInputSha256!==identity.sha256||info.executionMode!==mode)throw Error('Compiled Windows identity differs');
  }else{
    await copy(resolve(shell,'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk'),'app.apk');
    certificate=apkCertificateSha256(await readFile(resolve(output,'app.apk')));
  }
  const manifest={schema:1,...buildInfo,files,...certificate?{androidCertificateSha256:certificate}:{}};
  await writeFile(resolve(output,'native-artifact.json'),JSON.stringify(manifest,null,2));
  const pin=JSON.parse(await readFile(resolve(root,'config/native-artifacts.json'),'utf8'));
  verifyNativeBundle(output,identity,{androidCertificateSha256:pin.androidCertificateSha256});return manifest;
}
