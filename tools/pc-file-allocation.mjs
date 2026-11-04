// Node owns invocation; the Windows C++ tool owns file identity and allocation.
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from './native-tool.mjs';

export const allocationSourceFiles=Object.freeze(['tools/cpp/pc-file-allocation.cpp','shared/core/src/losslessjson.cpp','shared/core/include/pandoeditor/losslessjson.h']);
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
export function auditFileAllocation(manifestPath,{root=sourceRoot,directory}={}){
  if(process.platform!=='win32')throw Error('PC allocation requires the Windows native tool');
  if(!directory){
    const local=resolve(root,'build-native/pc-allocation');directory=local;
    if(!existsSync(resolve(local,'pando-pc-file-allocation.exe'))&&existsSync(resolve(root,'.git'))){
      const roots=execFileSync('git',['-C',root,'worktree','list','--porcelain'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).filter(s=>s.startsWith('worktree ')).map(s=>s.slice(9));
      const existing=roots.map(r=>resolve(r,'build-native/pc-allocation')).find(d=>existsSync(resolve(d,'pando-pc-file-allocation.exe')));if(existing)directory=existing;
    }
  }
  const {binary}=verifyNativeTool({root,directory,target:'pc-allocation',executable:'pando-pc-file-allocation.exe',sourceFiles:allocationSourceFiles});
  return JSON.parse(execFileSync(binary,[resolve(manifestPath)],{encoding:'utf8',windowsHide:true,maxBuffer:1024**2}));
}
