import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {buildFrontendIndex,frontendAsset} from '../../scripts/lib/frontend-layout.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));

// Supply the browser URL namespace to an unchanged Worker. Module imports still
// execute their canonical source files; no calculations or Worker handlers are replaced.
export function sourceWorkerTransport(entry,{buildMeta}={}){
 const index=buildFrontendIndex(root),owner=index.get(entry);
 if(!owner||!/^assets\/js\/workers\/[\w-]+\.js$/.test(entry))throw Error('Unknown Worker entry: '+entry);
 const location=new URL(entry,'https://worker.test/');
 if(buildMeta){location.searchParams.set('v',buildMeta.assetRevision);location.searchParams.set('dataRevision',buildMeta.dataRevision);}
 const publicPath=specifier=>{
  const url=new URL(specifier,location);
  if(url.origin!==location.origin)throw Error('Worker fixture transport must use its public origin');
  return url.pathname.slice(1);
 };
 const asset=specifier=>frontendAsset(root,publicPath(specifier),{index,product:owner.product==='editor'?'editor':'viewer'});
 return{
  location,
  sourceUrl:specifier=>pathToFileURL(resolve(root,asset(specifier).sourcePath)).href,
  read:specifier=>publicPath(specifier)==='assets/js/build-meta.js'&&buildMeta
   ?'globalThis.PANDOLAB_BUILD_META = Object.freeze('+JSON.stringify(buildMeta)+');'
   :asset(specifier).bytes.toString('utf8'),
 };
}
