// Source-bound standalone C++ image primitive. No runtime compilation or fallback.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

export const mapImageSourceFiles=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/map-image/main.cpp',
  'tools/cpp/map-image/resample.cpp','tools/cpp/map-image/resample.h']);
const root=fileURLToPath(new URL('../../',import.meta.url));
function dimensions(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>16777216)
    throw Error('Image dimensions exceed the 16MP graph budget');
}
export async function resizeNativeRgba(image,size,{signal,workspace=root,directory=process.env.PANDO_MAP_IMAGE_ARTIFACT||resolve(workspace,'build-native/map-image/artifact')}={}){
  signal?.throwIfAborted();
  if(!image||!Array.isArray(size)||size.length!==2||!Buffer.isBuffer(image.data))throw Error('RGBA image and output size are required');
  dimensions(image.width,image.height);dimensions(size[0],size[1]);
  if(image.data.length!==image.width*image.height*4)throw Error('RGBA input byte length differs from dimensions');
  const executable=process.platform==='win32'?'pando-map-image.exe':'pando-map-image';
  const {binary}=verifyNativeTool({root:workspace,directory,target:'map-image',executable,sourceFiles:mapImageSourceFiles});
  const expected=size[0]*size[1]*4;
  const data=await new Promise((accept,reject)=>{
    const child=spawn(binary,['resize-rgba',String(image.width),String(image.height),String(size[0]),String(size[1])],
      {stdio:['pipe','pipe','pipe'],windowsHide:true,signal});
    const output=[],errors=[];let length=0,errorBytes=0,overflow=false,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else accept(value);};
    const timer=setTimeout(()=>{child.kill();finish(Error('Native image resize timed out'));},120000);
    child.on('error',error=>finish(error));
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>expected){overflow=true;child.kill();}else output.push(chunk);});
    child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<=65536)errors.push(chunk);});
    child.on('close',(code,reason)=>{
      if(code!==0||reason||overflow)return finish(Error('Native image resize failed: '+Buffer.concat(errors).toString('utf8')));
      if(length!==expected)return finish(Error('Native image resize output byte length mismatch'));
      finish(null,Buffer.concat(output,length));
    });
    child.stdin.end(image.data);
  });
  signal?.throwIfAborted();return {width:size[0],height:size[1],data};
}
