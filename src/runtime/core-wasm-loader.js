import { fetchWithRetry } from './reliability-core.js';
import {createStoredAssetLoader} from '../data/stored-asset-loader.js';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const digestSyntax = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const hex = value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const now = () => performance.now();
const identity = m => ({sourceSha256:m.sourceSha256,abiVersion:m.abiVersion,compilerVersion:m.compiler.version,
  jsSha256:m.assets.js.sha256,wasmSha256:m.assets.wasm.sha256});
const sameIdentity = (a,b) => !!a && !!b && ['sourceSha256','abiVersion','compilerVersion','jsSha256','wasmSha256'].every(key=>a[key]===b[key]);
let verifiedPackage = null;

/** Compile/code bytes have one owner. Worker sessions still instantiate their
 * own memory and retain their existing lifetime and application transports. */
export function createVerifiedCoreWorker(value,options,{WorkerClass=globalThis.Worker}={}) {
  const prepared=verifiedPackage;
  if(!prepared)return new WorkerClass(value,options);
  const url=new URL(value);url.searchParams.set('shareCore',prepared.identity.sourceSha256);
  const worker=new WorkerClass(url,options);
  const listener=event=>{
    const message=event.data;
    if(message?.type==='pando-core-timing'){
      if(sameIdentity(message.identity,prepared.identity))
        globalThis.__PANDOLAB_PERFORMANCE__?.record('core.worker-ready',message.milliseconds,{...message.metrics,worker:options?.name||url.pathname.split('/').at(-1)});
      return;
    }
    if(message?.type!=='pando-core-module-request')return;
    if(!sameIdentity(message.identity,prepared.identity)){
      worker.postMessage({type:'pando-core-module',requestId:message.requestId,
        error:{code:'PL-CORE-WASM-SHARED',message:'Worker compiled source identity differs from the admitted engine.'}});
      return;
    }
    // WebAssembly.Module is structured-cloned, not an ArrayBuffer transfer.
    try{worker.postMessage({type:'pando-core-module',requestId:message.requestId,package:prepared});}
    catch(error){worker.postMessage({type:'pando-core-module',requestId:message.requestId,
      error:{code:'PL-CORE-WASM-SHARED',message:'Compiled Core transfer failed: '+error.message}});}
  };
  worker.addEventListener('message',listener);
  const terminate=worker.terminate.bind(worker);
  worker.terminate=()=>{worker.removeEventListener('message',listener);return terminate();};
  return worker;
}

async function requestSharedCore(manifest,signal){
  const worker=globalThis;
  const enabled=typeof worker.document==='undefined'&&typeof worker.postMessage==='function'
    &&new URL(worker.location.href).searchParams.get('shareCore');
  if(!enabled)return null;
  if(enabled!==manifest.sourceSha256)fail('PL-CORE-WASM-SHARED','Worker source differs from its parent engine.');
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();let timer;
    const finish=(error,value)=>{clearTimeout(timer);worker.removeEventListener('message',listen);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>finish(signal.reason||Object.assign(Error('Core sharing cancelled'),{name:'AbortError'}));
    const listen=event=>{
      const value=event.data;
      if(value?.type!=='pando-core-module'||value.requestId!==requestId)return;
      if(value.error)finish(Object.assign(Error(value.error.message),{code:value.error.code}));
      else finish(null,value.package);
    };
    worker.addEventListener('message',listen);
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(Object.assign(Error('Shared compiled Core did not arrive'),{code:'PL-CORE-WASM-SHARED'})),30000);
    try{worker.postMessage({type:'pando-core-module-request',requestId,identity:identity(manifest)});}
    catch(error){finish(error);}
  });
}

/** Opens only the manifest-pinned JS/WASM pair for this compiled C++ source. */
export async function loadVerifiedCore({baseUrl,fetchAsset=globalThis.fetch,
  importModule=url=>import(url),subtle=null,signal=null,cacheStorage=globalThis.caches,sharedCore=null,
  createModuleUrl=bytes=>{
    if(typeof Blob!=='function'||typeof URL.createObjectURL!=='function'||typeof URL.revokeObjectURL!=='function')
      fail('PL-CORE-WASM-DEPENDENCY','Verified JavaScript Blob module support is required.');
    return URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));
  },revokeModuleUrl=url=>URL.revokeObjectURL(url),
}={}){
  const started=now(),metrics={manifestMs:0,assetReadVerifyMs:0,instantiateMs:0,factoryMs:0,shared:false,assetRequests:0};
  const hashing=subtle??globalThis.crypto?.subtle;
  if(!hashing||typeof hashing.digest!=='function'||typeof fetchAsset!=='function'
    ||typeof importModule!=='function'||typeof createModuleUrl!=='function'||typeof revokeModuleUrl!=='function')
    fail('PL-CORE-WASM-DEPENDENCY','Required verified WASM loader dependencies are missing.');
  const manifestUrl=new URL('pandoeditor-core.manifest.json',baseUrl);
  const manifest=await fetchWithRetry(manifestUrl.href,{cache:'no-store',signal},{fetchFn:fetchAsset,timeoutMs:30000,
    consume:response=>{
      if(!response.ok)fail('PL-CORE-WASM-UNAVAILABLE',`공통 C++ 엔진 목록을 읽지 못했습니다: ${manifestUrl.pathname} (HTTP ${response.status})`);
      return response.json();
    }});
  metrics.manifestMs=now()-started;
  if(manifest?.schema!=='pandoeditor-core-wasm'||manifest.abiVersion!==1
    ||manifest.compiler?.name!=='emscripten'||manifest.compiler.version!=='6.0.3'
    ||!digestSyntax(manifest.sourceSha256)||manifest.assets?.js?.file!=='pandoeditor-core.js'
    ||manifest.assets?.wasm?.file!=='pandoeditor-core.wasm'
    ||!digestSyntax(manifest.assets.js.sha256)||!digestSyntax(manifest.assets.wasm.sha256))
    fail('PL-CORE-WASM-MANIFEST','공통 C++ 엔진 manifest가 현재 계약과 일치하지 않습니다.');
  const prepared=sharedCore||await requestSharedCore(manifest,signal);
  let jsBytes,wasmBytes,compiledModule;
  const readStart=now();
  if(prepared){
    if(!sameIdentity(prepared.identity,identity(manifest))||!(prepared.module instanceof WebAssembly.Module)
      ||!(prepared.jsBytes instanceof ArrayBuffer))fail('PL-CORE-WASM-SHARED','Shared Core does not match the pinned Worker manifest.');
    if(await hashing.digest('SHA-256',prepared.jsBytes).then(hex)!==manifest.assets.js.sha256)
      fail('PL-CORE-WASM-INTEGRITY','Shared JavaScript bytes differ from the verified engine.');
    jsBytes=prepared.jsBytes;compiledModule=prepared.module;metrics.shared=true;
  }else{
    // The existing stored-byte owner verifies both cache hits and downloads.
    // No second WASM hash/copy or parallel persistent cache is necessary.
    const stored=createStoredAssetLoader({cachePolicy:'immutable',cacheStorage,subtle:hashing,resolveUrl:spec=>spec.url,
      fetchFn:(url,options)=>{metrics.assetRequests++;return fetchAsset(url,{...options,cache:'no-store'});}});
    const readAsset=async asset=>{
      const url=new URL(asset.file,baseUrl);url.searchParams.set('sha256',asset.sha256);
      try{return(await stored.loadStoredAsset({...asset,url:url.href},'core',asset.file,'공통 C++ 엔진',buffer=>buffer,signal)).value;}
      catch(cause){
        if(signal?.aborted||cause?.name==='AbortError')throw cause;
        throw Object.assign(Error(`공통 C++ 엔진 파일을 읽지 못했습니다: ${url.pathname}: ${cause.message}`,{cause}),
          {code:Number.isFinite(cause.httpStatus)?'PL-CORE-WASM-UNAVAILABLE':'PL-CORE-WASM-INTEGRITY'});
      }
    };
    [jsBytes,wasmBytes]=await Promise.all([readAsset(manifest.assets.js),readAsset(manifest.assets.wasm)]);
  }
  metrics.assetReadVerifyMs=now()-readStart;
  signal?.throwIfAborted();
  const verifiedModuleUrl=createModuleUrl(jsBytes);
  try{
    const {default:createCore}=await importModule(verifiedModuleUrl);
    let rejectInstantiation;
    const failure=new Promise((_,reject)=>{rejectInstantiation=reject;});
    const factoryStart=now();
    const instancePromise=createCore({...(wasmBytes?{wasmBinary:wasmBytes}:{}),locateFile:name=>new URL(name,baseUrl).href,
      instantiateWasm(imports,receive){
        const begin=now();
        Promise.resolve().then(()=>WebAssembly.instantiate(compiledModule||wasmBytes,imports)).then(result=>{
          const instance=compiledModule?result:result.instance;
          compiledModule ||= result.module;
          metrics.instantiateMs+=now()-begin;
          receive(instance,compiledModule);
        }).catch(rejectInstantiation);
        return {};
      }});
    const abort=()=>rejectInstantiation(signal.reason||Object.assign(Error('Core initialization cancelled'),{name:'AbortError'}));
    signal?.addEventListener('abort',abort,{once:true});
    let core;
    try{if(signal?.aborted)abort();core=await Promise.race([instancePromise,failure]);}
    finally{signal?.removeEventListener('abort',abort);}
    metrics.factoryMs=now()-factoryStart;
    signal?.throwIfAborted();
    if(core.coreAbiVersion!==manifest.abiVersion||core.coreSourceSha256!==manifest.sourceSha256
      ||core.coreCompilerVersion!==manifest.compiler.version)
      fail('PL-CORE-WASM-ABI','공통 C++ 엔진 ABI, compiler 또는 원본 digest가 manifest와 다릅니다.');
    if(compiledModule)verifiedPackage=Object.freeze({identity:Object.freeze(identity(manifest)),jsBytes:jsBytes.slice(0),module:compiledModule});
    const elapsed=now()-started;
    globalThis.__PANDOLAB_PERFORMANCE__?.record('core.ready',elapsed,metrics);
    if(metrics.shared&&typeof globalThis.document==='undefined'&&typeof globalThis.postMessage==='function')
      globalThis.postMessage({type:'pando-core-timing',identity:identity(manifest),milliseconds:elapsed,metrics});
    return core;
  }finally{revokeModuleUrl(verifiedModuleUrl);}
}
// @worker-transport dedicated: verified engine owner hands compiled code to child workers before their independent domain RPC sessions
