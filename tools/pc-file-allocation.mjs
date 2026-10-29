// Node owns invocation; the Windows C++ tool owns file identity and allocation.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from './native-tool.mjs';

export const allocationSourceFiles=Object.freeze(['tools/cpp/pc-file-allocation.cpp','shared/core/src/losslessjson.cpp','shared/core/include/pandoeditor/losslessjson.h']);
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
export function auditFileAllocation(manifestPath,{root=sourceRoot,directory=resolve(root,'build-native/pc-allocation')}={}){
  if(process.platform!=='win32')throw Error('PC allocation requires the Windows native tool');
  const {binary}=verifyNativeTool({root,directory,target:'pc-allocation',executable:'pando-pc-file-allocation.exe',sourceFiles:allocationSourceFiles});
  return JSON.parse(execFileSync(binary,[resolve(manifestPath)],{encoding:'utf8',windowsHide:true,maxBuffer:1024**2}));
}
