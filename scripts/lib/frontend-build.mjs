import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {transform} from 'esbuild';
import {buildFrontendIndex,emitFrontendModule} from './frontend-layout.mjs';
import {renderProductHtml} from './product-html.mjs';
import {buildUiBundles} from '../build-ui-bundle.mjs';
import {buildWorkerAsset} from './worker-assets.mjs';
import {collectViewerAssets} from './product-assets.mjs';
import {decodeArchiveEntry,libraryCheckout,libraryConfig} from '../../tools/library-data.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function selectFrontendProduct(snapshot,product,{readRuntimeAsset}={}){
 if(product!=='viewer')throw Error('Unknown distributable frontend product');
 const assets=new Map();
 for(const path of [...snapshot.viewerPaths].sort()){
  const entry=snapshot.assets.get(path);
  if(entry){if(entry.product==='editor')throw Error('Editor source entered the viewer output');assets.set(path,entry);}
  else{if(!path.startsWith('assets/data/'))throw Error('Unowned runtime resource');assets.set(path,{publicPath:path,sourcePath:path,product:'shared',bytes:readRuntimeAsset(path)});}
 }
 const sourceSha256=hash(JSON.stringify({input:snapshot.sourceSha256,product,files:[...assets].map(([path,entry])=>[path,hash(entry.bytes)])}));
 return {...snapshot,product,sourceSha256,assets};
}
export function readFrontendInput(snapshot,path,encoding){
 if(isAbsolute(path))path=relative(snapshot.root,path).replaceAll('\\','/');
 const bytes=path==='__editor/index.html'?Buffer.from(snapshot.html.editor):snapshot.assets.has(path)?snapshot.assets.get(path).bytes:readFileSync(resolve(snapshot.root,path));
 return encoding?bytes.toString(encoding):bytes;
}
export function hasFrontendInput(snapshot,path){
 if(isAbsolute(path))path=relative(snapshot.root,path).replaceAll('\\','/');
 return path==='__editor/index.html'||snapshot.assets.has(path)||existsSync(resolve(snapshot.root,path));
}
const metadataPaths=Object.freeze(['assets/data/world/current.json','assets/data/terrain-preview/v0.13.3-p2/manifest.json','assets/data/physical-land/v1/manifest.json','assets/data/hydro/v0.13.2/manifest.json','assets/data/places/manifest.json','assets/data/territorial-entities/generated/v2/index.json','assets/data/builtin-world/generated/v1/index.json','assets/data/prepared-polygons/generated/v2/manifest.json']);
const pinnedContexts=new Map();
function pinnedContext(root){
 const configuration=libraryConfig(root),checkout=libraryCheckout(root),key=checkout+'|'+configuration.revision;
 if(!pinnedContexts.has(key)){
  const index=JSON.parse(execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','show',configuration.revision+':archive/index.json'],{cwd:checkout,maxBuffer:16*1024*1024}));
  const bytes=new Map();pinnedContexts.set(key,{revision:configuration.revision,dataPaths:Object.keys(index.files).filter(p=>p.startsWith('assets/data/')),read:path=>{assert.ok(index.files[path],'Missing pinned input: '+path);if(!bytes.has(path))bytes.set(path,decodeArchiveEntry(checkout,index.files[path],configuration.revision));return bytes.get(path);}});
 }
 return pinnedContexts.get(key);
}
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);

/** Build both frontend products from source, without writing into a checkout. */
export async function buildFrontendSnapshot({root=process.cwd(),sourceCommit,readPinnedData,dataPaths,readSourceBytes,resourceProfile,workerSourceTransform=(_path,source)=>source}={}){
 if(resourceProfile!==undefined&&!['map-data','test-fixture'].includes(resourceProfile))throw Error('Invalid frontend resource profile');
 root=resolve(root);const pinned=readPinnedData?null:pinnedContext(root);
 readPinnedData??=pinned.read;dataPaths??=pinned.dataPaths;
 sourceCommit??=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const readBytes=readSourceBytes??(path=>readFileSync(resolve(root,path)));
 readSourceBytes=path=>{
  const bytes=readBytes(path);
  return /\.(?:[cm]?js|json|css|html|svg|txt|md)$|\/(?:LICENSE|NOTICE)$/i.test(path)
   ?Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n')):bytes;
 };
 const appVersion=String(JSON.parse(readSourceBytes('package.json')).version||'');
 if(!/^\d+\.\d+\.\d+$/.test(appVersion))throw Error('Invalid frontend version');
 const buildId=appVersion+'-build-'+(process.env.PANDOLAB_BUILD_ID||sourceCommit.slice(0,12)).replace(/[^A-Za-z0-9._-]/g,'-'),assetRevision=buildId;
 const index=buildFrontendIndex(root),assets=new Map(),sourceInputs=[];
 const sourceText=path=>{const bytes=readSourceBytes(path);sourceInputs.push({sourcePath:path,sha256:hash(bytes)});return bytes.toString('utf8');};
 for(const entry of index.values()){
  const original=readSourceBytes(entry.sourcePath);sourceInputs.push({sourcePath:entry.sourcePath,sha256:hash(original)});
  let bytes=entry.publicPath.endsWith('.js')&&!/\/vendor\/|\/wasm\//.test(entry.publicPath)?Buffer.from(emitFrontendModule(original.toString('utf8'),entry.sourcePath,index)):original;
  if(entry.publicPath.startsWith('assets/js/workers/')&&entry.publicPath.endsWith('.js'))bytes=Buffer.from(workerSourceTransform(entry.publicPath,bytes.toString('utf8')));
  assets.set(entry.publicPath,{...entry,bytes});
 }
 const generated=(path,bytes,product='shared')=>assets.set(path,{publicPath:path,sourcePath:null,product,bytes:Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes)});
 const read=path=>{
  if(assets.has(path))return assets.get(path).bytes.toString('utf8');
  if(path.startsWith('assets/data/'))return readPinnedData(path).toString('utf8');
  throw Error('Missing product input: '+path);
 };
 const bundles=buildUiBundles(root,{readSource:read});
 generated('assets/css/ui.bundle.css',bundles.main);generated('assets/css/ui-viewer.bundle.css',bundles.viewer,'viewer');generated('assets/css/ui-modal.bundle.css',bundles.modal,'editor');
 const policy=await transform(read('assets/js/modules/resource-update-policy.js'),{format:'iife',globalName:'PandoLabResourceUpdatePolicy',target:'es2022',legalComments:'none'});
 generated('assets/js/workers/resource-update-policy-core.js','// Generated from the canonical resource policy.\n'+policy.code+'\nself.PandoLabResourceUpdatePolicy = PandoLabResourceUpdatePolicy;\n');
 const workerAssets={};
 for(const entry of [...assets.keys()].filter(p=>/^assets\/js\/workers\/.*-worker\.js$/.test(p)).sort()){
  const built=await buildWorkerAsset({root,entry,readSource:read});
  const files=[...built.files].sort(([a],[b])=>a<b?-1:a>b?1:0);
  workerAssets[entry]={url:built.url,files:files.map(([path])=>path),sha256:Object.fromEntries(files.map(([p,bytes])=>[p,hash(bytes)]))};
  const product=index.get(entry).product;for(const [path,bytes]of files)generated(path,bytes,product);
 }
 const metadata=Object.fromEntries(metadataPaths.map(path=>[path,JSON.parse(readPinnedData(path))]));
 const land=metadata[metadataPaths[2]],terrain=metadata[metadataPaths[1]];
 assert.equal(land.sourceSha256,terrain.sourceDem.landMaskSha256,'Land derivative must match pinned terrain');
 const dataRevision='data-'+hash(metadataPaths.map(path=>path+'\0'+stable(metadata[path])+'\0').join('')).slice(0,32);
 const dataIdentity=path=>{const bytes=readPinnedData(path);return{encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length,sha256:hash(bytes)};};
 const builtinPath=metadataPaths[6],preparedPath=metadataPaths[7];
 const buildMeta={appVersion,buildId,assetRevision,dataRevision,sourceCommit,dataCommit:pinned?.revision||null,...resourceProfile?{resourceProfile}:{},worldBundle:{url:metadataPaths[0],...dataIdentity(metadataPaths[0])},territorialIndex:dataIdentity(metadataPaths[5]),builtinWorld:{url:builtinPath,...dataIdentity(builtinPath)},preparedPolygonMeshes:{url:preparedPath,...dataIdentity(preparedPath),algorithmSourceSha256:metadata[preparedPath].algorithmSourceSha256},workerAssets,physicalLand:land.asset,physicalWaterHistory:land.historicalWaterbodies||[]};
 generated('assets/js/build-meta.js','// Generated product identity.\nglobalThis.PANDOLAB_BUILD_META = Object.freeze('+JSON.stringify(buildMeta,null,2)+');\n');
 const templates=renderProductHtml(sourceText),moduleImports=Object.fromEntries([...assets.keys()].filter(p=>p.startsWith('assets/js/')&&p.endsWith('.js')).map(p=>['./'+p,'./'+p+'?v='+encodeURIComponent(assetRevision)]));
 const render=(template,imports)=>{
  let html=template.replaceAll('{{assetRevision}}',assetRevision).replace(/(\bdata-app-version=")[^"]+(")/,'$1'+appVersion+'$2');
  html=html.replace(/(\b(?:href|src)="[^"]*assets\/[^"?]+)(?:\?v=[^"]*)?(")/g,(_,start,end)=>/\.woff2$/.test(start)?start+end:start+'?v='+assetRevision+end);
  const importMap='<script id="pandolab-module-import-map" type="importmap">\n'+JSON.stringify({imports},null,2)+'\n</script>';
  return /<script\b[^>]*id="pandolab-module-import-map"[^>]*>[\s\S]*?<\/script>/.test(html)?html.replace(/<script\b[^>]*id="pandolab-module-import-map"[^>]*>[\s\S]*?<\/script>/,()=>importMap):html.replace(/(?=<script\b)/,importMap+'\n');
 };
 generated('index.html',render(templates.web,moduleImports),'viewer');generated('.nojekyll','', 'viewer');
 const viewerPaths=await collectViewerAssets({root,availablePaths:[...assets.keys(),...dataPaths],readSource:read,workerAssets});
 const viewerImports=Object.fromEntries(Object.entries(moduleImports).filter(([path])=>viewerPaths.has(path.slice(2))));
 const html={viewer:render(templates.web,viewerImports),editor:render(templates.editor,moduleImports)};
 generated('index.html',html.viewer,'viewer');
 const sourceSha256=hash(JSON.stringify({sourceCommit,appVersion,dataRevision,sources:sourceInputs.sort((a,b)=>a.sourcePath.localeCompare(b.sourcePath)),outputs:[...assets].map(([path,entry])=>[path,hash(entry.bytes)])}));
 return{root,sourceCommit,sourceSha256,dataRevision,dataCommit:pinned?.revision||null,assets,index,viewerPaths,html,buildMeta,sourceInputs};
}
