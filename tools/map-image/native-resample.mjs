// Source-bound standalone C++ image primitive. No runtime compilation or fallback.
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

export const mapImageSourceFiles=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/map-image/main.cpp',
  'tools/cpp/map-image/resample.cpp','tools/cpp/map-image/resample.h','tools/cpp/map-image/png.cpp',
  'tools/cpp/map-image/png.h','tools/cpp/map-image/zlib-LICENSE']);
const root=fileURLToPath(new URL('../../',import.meta.url));
export function collectMapImageArtifacts({workspace=root,revision,
  linuxDirectory=process.env.PANDO_MAP_IMAGE_LINUX_ARTIFACT||resolve(workspace,'build-native/map-image/linux-x64'),
  windowsDirectory=process.env.PANDO_MAP_IMAGE_WINDOWS_ARTIFACT||resolve(workspace,'build-native/map-image',process.platform==='win32'?'artifact':'win32-x64')}={}){
  if(revision!==undefined&&!/^[a-f0-9]{40}$/.test(revision))throw Error('A full pinned source revision is required');
  const entries=[];
  for(const [platform,directory,executable] of [['linux',linuxDirectory,'pando-map-image'],['win32',windowsDirectory,'pando-map-image.exe']]){
    const {binary,manifest}=verifyNativeTool({root:workspace,directory,target:'map-image',executable,sourceFiles:mapImageSourceFiles,platform,architecture:'x64'});
    if(revision)for(const file of manifest.sourceFiles){
      const source=execFileSync('git',['show',revision+':'+file.path],{cwd:workspace,encoding:'utf8',maxBuffer:16*1024*1024});
      if(createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex')!==file.sha256)
        throw Error('Native image artifact differs from pinned source: '+file.path);
    }
    const prefix=`build-native/map-image/${platform}-x64/`;
    entries.push({path:prefix+'native-tool.manifest.json',data:readFileSync(resolve(directory,'native-tool.manifest.json'))},
      {path:prefix+executable,data:readFileSync(binary)});
  }
  return entries;
}
function dimensions(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>16777216)
    throw Error('Image dimensions exceed the 16MP graph budget');
}
async function operateNativeRgba(image,size,action,{signal,workspace=root,directory=process.env.PANDO_MAP_IMAGE_ARTIFACT||
  resolve(workspace,'build-native/map-image',existsSync(resolve(workspace,'.map-runtime.json'))?`${process.platform}-${process.arch}`:'artifact')}={}){
  signal?.throwIfAborted();
  if(!image||!Array.isArray(size)||size.length!==2||!(image.data instanceof Uint8Array))throw Error('RGBA image and output size are required');
  dimensions(image.width,image.height);dimensions(size[0],size[1]);
  if(image.data.length!==image.width*image.height*4)throw Error('RGBA input byte length differs from dimensions');
  const executable=process.platform==='win32'?'pando-map-image.exe':'pando-map-image';
  const {binary}=verifyNativeTool({root:workspace,directory,target:'map-image',executable,sourceFiles:mapImageSourceFiles});
  if(process.platform!=='win32'&&!process.env.PANDO_MAP_IMAGE_ARTIFACT&&existsSync(resolve(workspace,'.map-runtime.json')))
    chmodSync(binary,0o755);
  const expected=size[0]*size[1]*4,encoded=action[0]==='encode-png',maximum=encoded?expected+size[1]+1048576:expected;
  const data=await new Promise((accept,reject)=>{
    const child=spawn(binary,[action[0],String(image.width),String(image.height),...action.slice(1).map(String)],
      {stdio:['pipe','pipe','pipe'],windowsHide:true,signal:signal||undefined});
    const output=[],errors=[];let length=0,errorBytes=0,overflow=false,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else accept(value);};
    const timer=setTimeout(()=>{child.kill();finish(Error('Native image operation timed out'));},120000);
    child.on('error',error=>finish(error));
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>maximum){overflow=true;child.kill();}else output.push(chunk);});
    child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<=65536)errors.push(chunk);});
    child.on('close',(code,reason)=>{
      if(code!==0||reason||overflow)return finish(Error('Native image operation failed: '+Buffer.concat(errors).toString('utf8')));
      if((!encoded&&length!==expected)||(encoded&&length<8))return finish(Error('Native image output byte length mismatch'));
      finish(null,Buffer.concat(output,length));
    });
    child.stdin.end(image.data);
  });
  signal?.throwIfAborted();return {width:size[0],height:size[1],data};
}
export function resizeNativeRgba(image,size,options){
  return operateNativeRgba(image,size,['resize-rgba',...(Array.isArray(size)?size:[])],options);
}
export function rotateNativeRgba(image,degrees,options){
  if(![0,90,180,270].includes(degrees))return Promise.reject(Error('Invalid clockwise rotation'));
  const width=image?.width,height=image?.height,size=degrees===90||degrees===270?[height,width]:[width,height];
  return operateNativeRgba(image,size,['rotate-rgba',degrees],options);
}
export function encodeNativePng(image,options){
  return operateNativeRgba(image,[image?.width,image?.height],['encode-png'],options);
}
