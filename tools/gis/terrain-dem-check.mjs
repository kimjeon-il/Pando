import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export const terrainDemCheckSources=Object.freeze(['tools/cpp/terrain-dem-check/CMakeLists.txt','tools/cpp/terrain-dem-check/check.cpp']);
export async function checkNativeDemTile({tile,reference,left,top,west,shadeStep=4,excludeNorth=false,excludeSouth=false},
  {root=rootDefault,directory=resolve(root,'build-native/terrain-dem-check/artifact'),signal}={}){
  signal?.throwIfAborted();const {width,height,data}=tile||{};
  if(![width,height].every(value=>Number.isSafeInteger(value)&&value>=3&&value<=16384)||width*height>16777216||
    !(data instanceof Uint8Array)||data.length!==width*height*4)throw Error('Valid DEM tile pixels required');
  if(!Number.isInteger(shadeStep)||shadeStep<1||shadeStep>255||typeof excludeNorth!=='boolean'||typeof excludeSouth!=='boolean')
    throw Error('Invalid DEM shade settings');
  if(reference!==undefined&&(!reference||reference.width!==width||reference.height!==height||!(reference.data instanceof Uint8Array)||reference.data.length!==data.length))
    throw Error('Matching DEM reference tile required');
  for(const [name,value,length] of [['left',left,height*4],['top',top,width*4],['west',west,height*4]])
    if(value!==undefined&&(!(value instanceof Uint8Array)||value.length!==length))throw Error('Invalid DEM '+name+' gutter');
  const flags=(reference?1:0)|(left?2:0)|(top?4:0)|(west?8:0)|(excludeNorth?16:0)|(excludeSouth?32:0);
  const header=Buffer.alloc(24);header.write('PDTCHK01');header.writeUInt32LE(width,8);header.writeUInt32LE(height,12);
  header.writeUInt32LE(flags,16);header.writeUInt32LE(shadeStep,20);
  const executable=process.platform==='win32'?'pando-terrain-dem-check.exe':'pando-terrain-dem-check';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-dem-check',executable,sourceFiles:terrainDemCheckSources});
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:65536,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native DEM tile check failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});
    for(const part of [header,data,reference?.data,left,top,west])if(part)child.stdin.write(part);child.stdin.end();
  });
  signal?.throwIfAborted();if(JSON.parse(output)?.verified!==true)throw Error('Invalid native DEM tile verification result');return true;
}
