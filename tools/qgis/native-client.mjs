// Bounded, authenticated loopback transport for the native QGIS plugin.
import {connect} from 'node:net';

const commands=new Set(['status','project','layers','active-layer','schema','raster-info','raster-sample','set-visibility','algorithms','buffer','features','select','selection','clear-selection','begin-edit','commit-edit','rollback-edit','undo-edit','redo-edit','set-attribute','set-geometry','add-field','delete-field','rename-field','delete-feature','add-feature','open','open-raster','export']);
export const qgisNativeSourceFiles=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/qgis/pando-qgis-plugin.cpp',
  'tools/cpp/qgis/qgis-export.cpp','tools/cpp/qgis/qgis-export.h','shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
export function validateNativeQgisConfig(config){
  if(!config||config.host!=='127.0.0.1'||!Number.isInteger(config.port)||config.port<1024||config.port>65535||
    typeof config.token!=='string'||!config.token||config.token.length>4096)throw Error('Authenticated IPv4 loopback QGIS configuration is required');
}
export async function requestNativeQgis(config,request,{signal,timeoutMs=30000,maxResponseBytes=1024*1024}={}){
  signal?.throwIfAborted();
  validateNativeQgisConfig(config);
  if(!request||typeof request!=='object'||Array.isArray(request)||!commands.has(request.command)||'token' in request)
    throw Error('An allowed native QGIS command is required');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>2*1024*1024)
    throw Error('Invalid QGIS transport limit');
  const message=Buffer.from(JSON.stringify({token:config.token,...request})+'\n','utf8');
  if(message.length>1024*1024)throw Error('Native QGIS request is too large');
  return new Promise((accept,reject)=>{
    const socket=connect({host:config.host,port:config.port});let done=false,size=0,chunks=[],timer;
    const finish=(error,value)=>{
      if(done)return;done=true;signal?.removeEventListener('abort',abort);globalThis.clearTimeout(timer);socket.destroy();
      if(error)reject(error);else accept(value);
    };
    const abort=()=>finish(signal.reason instanceof Error?signal.reason:new Error('QGIS request aborted'));
    signal?.addEventListener('abort',abort,{once:true});
    timer=globalThis.setTimeout(()=>finish(Error('Native QGIS request timed out')),timeoutMs);
    socket.on('error',error=>finish(new Error('Native QGIS connection failed: '+error.message,{cause:error})));
    socket.on('connect',()=>socket.write(message));
    socket.on('data',chunk=>{
      size+=chunk.length;if(size>maxResponseBytes){finish(Error('Native QGIS response is too large'));return;}
      chunks.push(chunk);const bytes=Buffer.concat(chunks,size),end=bytes.indexOf(10);
      if(end<0)return;
      if(bytes.subarray(end+1).some(value=>![9,10,13,32].includes(value))){finish(Error('Invalid response from native QGIS'));return;}
      let response;
      try{response=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,end)));}
      catch(error){finish(new Error('Invalid response from native QGIS',{cause:error}));return;}
      if(!response||typeof response!=='object'||Array.isArray(response)||typeof response.ok!=='boolean'){
        finish(Error('Invalid response from native QGIS'));return;
      }
      if(!response.ok){const message=typeof response.error==='string'?response.error:'QGIS operation failed';
        const error=Error('Native QGIS: '+message.replaceAll(config.token,'[redacted]'));
        error.qgisCompleted=true;finish(error);return;}
      if(!response.result||typeof response.result!=='object'||Array.isArray(response.result)){finish(Error('Invalid response from native QGIS'));return;}
      finish(null,response.result);
    });
    socket.on('end',()=>finish(Error('Native QGIS closed the connection before a complete response')));
    if(signal?.aborted)abort();
  });
}
