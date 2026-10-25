// Local application storage owner. Library bytes remain owned by library-data.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, statfsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicStorageJSON, containedPath, contentHash } from './library-content.mjs';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const schema='pando-worktree-storage-v1';
export const cacheLimit=2*1024**3;
export function commonGit(root){return resolve(root,execFileSync('git',['-C',root,'rev-parse','--git-common-dir'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim());}
export function storageSettings(root){
  if(!existsSync(join(root,'.git')))return null;
  const path=join(commonGit(root),'pando-storage.json');
  if(!existsSync(path))return null;
  const settings=JSON.parse(readFileSync(path,'utf8'));
  if(settings.schema!==schema)throw Error('Invalid activated worktree storage configuration');
  return settings;
}
export function compilerCacheEnvironment({root=repository,env=process.env,settings=storageSettings(root)}={}){
  const result={...env};if(!settings)return result;
  if(settings.schema!==schema||!Number.isInteger(settings.port)||settings.port<1024||settings.port>65535)throw Error('Invalid compiler cache configuration');
  if(!existsSync(settings.tool)||contentHash(readFileSync(settings.tool))!==settings.toolSha256)throw Error('Activated compiler cache tool integrity failed');
  const values={RUSTC_WRAPPER:settings.tool,CMAKE_C_COMPILER_LAUNCHER:settings.tool,CMAKE_CXX_COMPILER_LAUNCHER:settings.tool,
    EM_COMPILER_WRAPPER:settings.tool,SCCACHE_DIR:join(settings.cacheRoot,'sccache'),SCCACHE_CACHE_SIZE:String(cacheLimit),
    SCCACHE_SERVER_PORT:String(settings.port),SCCACHE_SERVER_UDS:'',SCCACHE_BASEDIRS:settings.basedirs?.join(';')||''};
  for(const [key,value]of Object.entries(values)){
    if(result[key]&&result[key]!==value)throw Error(`Compiler cache configuration conflict: ${key}`);
    if(value)result[key]=value;
  }
  return result;
}
export async function activateCompilerCache(root=repository){
  const versions=JSON.parse(readFileSync(join(root,'config/toolchain-versions.json'),'utf8')).sccache;
  const toolDirectory=`D:/build/toolchains/sccache/${versions.version}`,tool=join(toolDirectory,'sccache.exe');
  const cacheRoot='D:/build/cache/pandolab';
  mkdirSync(cacheRoot,{recursive:true});containedPath(cacheRoot,'blobs');
  const fs=statfsSync(cacheRoot);if(fs.bavail*fs.bsize<8*1024**3)throw Error('Insufficient headroom for 3GiB peak + 5GiB');
  if(!existsSync(tool)){
    if(existsSync(toolDirectory)&&readdirSync(toolDirectory).length)throw Error('Preserve unexpected existing tool installation');
    mkdirSync(toolDirectory,{recursive:true});
    const archive=join(toolDirectory,'download.zip'),unpacked=join(toolDirectory,'unpacked');
    if(existsSync(archive)||existsSync(unpacked))throw Error('Preserve unfinished sccache download; inspect before resuming installation');
    const response=await fetch(versions.url);if(!response.ok)throw Error(`sccache download failed: ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(contentHash(bytes)!==versions.sha256)throw Error('Official sccache archive integrity failed');
    writeFileSync(archive,bytes,{flag:'wx'});
    execFileSync('tar.exe',['-xf',archive,'-C',toolDirectory],{windowsHide:true,stdio:'pipe'});
    // Only the fixed official executable is installed. Extraction remnants are task-owned.
    const {copyFileSync,rmSync}=await import('node:fs');
    const extracted=join(toolDirectory,`sccache-v${versions.version}-x86_64-pc-windows-msvc`);
    copyFileSync(join(extracted,'sccache.exe'),tool,1);
    rmSync(extracted,{recursive:true});unlinkSync(archive);
  }
  const version=execFileSync(tool,['--version'],{encoding:'utf8',windowsHide:true}).trim();
  if(version!==`sccache ${versions.version}`)throw Error('Unexpected sccache version');
  const settings={schema,cacheRoot,tool,toolSha256:contentHash(readFileSync(tool)),port:42427,version:versions.version};
  const existing=storageSettings(root);
  if(existing&&JSON.stringify(existing)!==JSON.stringify(settings))throw Error('Preserve existing storage activation; configuration differs');
  compilerCacheEnvironment({root,settings});
  if(!existing){
    const {createServer}=await import('node:net');
    const server=createServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(settings.port,'127.0.0.1',yes);});
    await new Promise(yes=>server.close(yes));
    atomicStorageJSON(join(commonGit(root),'pando-storage.json'),settings);
  }
  console.log(JSON.stringify(settings));return settings;
}

async function main(){
  const args=process.argv.slice(2),root=resolve(args.find(x=>x.startsWith('--root='))?.slice(7)||repository);
  if(args.includes('--activate-compiler-cache'))return activateCompilerCache(root);
  if(args.includes('--compiler-env')){console.log(JSON.stringify(compilerCacheEnvironment({root})));return;}
  if(args.includes('--with-compiler-cache')){
    const index=args.indexOf('--'),command=args.slice(index+1);
    if(index<0||!command.length)throw Error('Expected --with-compiler-cache -- command arguments');
    const result=spawnSync(command[0],command.slice(1),{cwd:process.cwd(),env:compilerCacheEnvironment({root}),stdio:'inherit',windowsHide:true});
    if(result.error)throw result.error;process.exitCode=result.status??1;return;
  }
  throw Error('Select a worktree storage operation');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
