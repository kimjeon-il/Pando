/* global Worker, TextEncoder, crypto, document */
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {prepareLibraryData} from "./data/library-runtime.mjs";

const PIN='fe8282ba32761ab9586348d1712e11cc1f4e7882';
const DATA='5eb7be55208efaafe39bd5a65ec2f111d70b9053';
const RUNTIME='data-f50b7f480c812df6f5ea0c40f5461ab0';
const root=resolve(process.cwd());
const sourceRoot=resolve(root,process.env.PANDOLAB_P6_PINNED_SOURCE||'.w2-p6-fixed');
const output=resolve(root,process.env.PANDOLAB_P6_OUTPUT||'test-results/w2-p6-1');
const port=Number(process.env.PANDOLAB_P6_PORT||4251);
const git=(dir,...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
const assert=(yes,message)=>{if(!yes)throw Error(message);};
assert(git(sourceRoot,'rev-parse','HEAD')===PIN,'Unexpected P6-0 pinned source');
const config=JSON.parse(readFileSync(join(root,'config/library-data.json')));
const pinnedConfig=JSON.parse(readFileSync(join(sourceRoot,'config/library-data.json')));
assert(config.revision===DATA&&pinnedConfig.revision===DATA,'Library revision must remain identical');
assert(Number.isInteger(port)&&port>1024&&port<65536,'Invalid port');
mkdirSync(output,{recursive:true});
const prepared=prepareLibraryData({root});
assert(prepared.revision===DATA,'Materialized data revision mismatch');
const fixedImport=async path=>import(pathToFileURL(join(sourceRoot,path)).href);
const {buildFrontendSnapshot}=await fixedImport('scripts/lib/frontend-build.mjs');
const snapshot=await buildFrontendSnapshot({
  root:sourceRoot,sourceCommit:PIN,
  readPinnedData:path=>readFileSync(resolve(prepared.materialized,path)),
  dataPaths:Object.keys(prepared.files).filter(path=>path.startsWith('assets/data/')),
  readSourceBytes:path=>readFileSync(resolve(sourceRoot,path)),
});
assert(snapshot.sourceCommit===PIN&&snapshot.dataRevision===RUNTIME,
  'Built snapshot source/data identity changed');
const {developmentAssets}=await fixedImport('scripts/frontend-dev-server.mjs');
const {createP3PreviewServer}=await fixedImport('scripts/p3-preview-server.mjs');
const {assets}=await developmentAssets({repository:sourceRoot,product:'viewer',prepared,snapshot});
for(const [name,asset] of snapshot.assets)if(snapshot.viewerPaths.has(name))assets.set(name,{bytes:asset.bytes});
const server=createP3PreviewServer(sourceRoot,{assets:()=>assets,reports:false});
await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});
let browser,context,page;
const report={
 schema:'pando-w2-p6-1-payload-census-v1',
 kind:'off-critical-path-browser-census-not-gpu-benchmark',
 pins:{source:PIN,library:DATA,runtime:RUNTIME,sourceInputsSha256:snapshot.sourceSha256},
 condition:{requestedMonth:'2026-11',targetMonth:'2025-12',viewport:[1280,800],dpr:1},
 status:'pending',
};
try{
 browser=await chromium.launch({headless:true,args:process.platform==='linux'
   ?['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']
   :['--use-angle=d3d11']});
 report.browserVersion=browser.version();
 context=await browser.newContext({
   viewport:{width:1280,height:800},deviceScaleFactor:1,
   locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce',
 });
 await context.addInitScript(()=>{
   const native=Worker.prototype.postMessage;
   globalThis.__P6CountryRequests=[];
   Worker.prototype.postMessage=function(data,...rest){
     if(data && ['replace','patch'].includes(data.type) &&
       Object.hasOwn(data,'includeOutlines') && Array.isArray(data.features)){
       // Reference-only capture; DO NOT clone/serialize in the transition.
       const rows=globalThis.__P6CountryRequests;
       if(rows.length<8)rows.push({data,at:performance.now()});
     }
     return native.call(this,data,...rest);
   };
 });
 page=await context.newPage();
 const errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 await page.clock.setFixedTime(new Date(2026,10,2,12,0,0));
 await page.goto('http://127.0.0.1:'+port+'/?debug=1&renderer=webgl2',
   {waitUntil:'domcontentloaded',timeout:120000});
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:180000});
 await expect.poll(()=>page.evaluate(()=>globalThis.__P6CountryRequests.some(
   row=>row.data.features?.length===254)),{timeout:180000}).toBe(true);
 report.viewer=await page.evaluate(()=>({
   month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
   cursor:globalThis.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor,
   renderer:globalThis.__PANDOLAB_VIEWER__?.rendererStats()?.renderer,
   build:globalThis.PANDOLAB_BUILD_META,
   inputCount:globalThis.__P6CountryRequests.length,
 }));
 assert(report.viewer.build?.sourceCommit===PIN && report.viewer.build?.dataRevision===RUNTIME,
   'Page build metadata source/data mismatch');
 assert(report.viewer.month==='2026-11'&&report.viewer.cursor==='2026-11',
   'Page initial month identity mismatch');
 // An isolated census intentionally serializes the captured input only
 // AFTER startup and the canonical map have finished; it never participates
 // in any first-year-switch latency measurement.
 report.census=await page.evaluate(async()=>{
   const record=globalThis.__P6CountryRequests.find(row=>row.data.features?.length===254);
   if(!record)throw Error('Complete 254-feature Worker input unavailable');
   const message=record.data,features=message.features;
   const encoder=new TextEncoder();
   const bytes=value=>encoder.encode(JSON.stringify(value)).byteLength;
   const countGeometry=geometry=>{
     let polygons=0,rings=0,vertices=0,positionComponents=0,holes=0;
     const multi=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
     for(const polygon of multi||[]){
       polygons++;
       for(let i=0;i<(polygon||[]).length;i++){
         const ring=polygon[i];rings++;if(i>0)holes++;
         for(const coord of ring||[]){vertices++;positionComponents+=(coord||[]).length;}
       }
     }
     return{polygons,rings,holes,vertices,positionComponents};
   };
   const totals={features:0,geometry:0,coordinates:0,properties:0,root:0,id:0,other:0,
     polygons:0,rings:0,holes:0,vertices:0,positionComponents:0};
   const propertyKeys={},outerKeys={},geometryTypes={},perCountry=[];
   for(const feature of features){
     const size=bytes(feature);
     const geometry=feature.geometry??null;
     const props=feature.properties??{};
     const geoBytes=bytes(geometry),coordinateBytes=geometry?.coordinates?bytes(geometry.coordinates):0;
     const propBytes=bytes(props);
     const fields=Object.keys(feature);
     const extraFields=fields.filter(key=>!['id','type','geometry','properties','boundaryRootId','boundaryGeometryRevision'].includes(key));
     const extraBytes=extraFields.reduce((sum,key)=>sum+bytes({[key]:feature[key]}),0);
     const sizes={feature:size,geometry:geoBytes,coordinates:coordinateBytes,
       properties:propBytes,other:extraBytes};
     const shape=countGeometry(geometry);
     for(const [key,value] of Object.entries(shape))totals[key]+=value;
     totals.features+=size;totals.geometry+=geoBytes;
     totals.coordinates+=coordinateBytes;totals.properties+=propBytes;
     totals.root+=bytes(feature.boundaryRootId??null);
     totals.id+=bytes(feature.id);
     totals.other+=extraBytes;
     const type=geometry?.type||'null';geometryTypes[type]=(geometryTypes[type]||0)+1;
     for(const key of fields)outerKeys[key]=(outerKeys[key]||0)+1;
     for(const [key,value] of Object.entries(props)){
       const row=propertyKeys[key]??={count:0,bytesAsSingleKeyObject:0};
       row.count++;row.bytesAsSingleKeyObject+=bytes({[key]:value});
     }
     perCountry.push({id:String(feature.id),type,rootId:String(feature.boundaryRootId??''),
       parentId:String(props.parentId??''),fieldNames:fields,
       propertyKeys:Object.keys(props),sizes,...shape});
   }
   const digest=async payload=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(payload)))]
     .map(v=>v.toString(16).padStart(2,'0')).join('');
   const originalJson=JSON.stringify(message);
   return{
     meta:{type:message.type,requestId:message.requestId,
       projectGeneration:message.projectGeneration,
       geometryRevision:message.geometryRevision,quality:message.quality,
       includeOutlines:message.includeOutlines,skipCacheReconcile:message.skipCacheReconcile,
       cacheUrlPresent:!!message.cacheUrl,
       removedIds:message.removedIds?.length||0,
       fields:Object.keys(message)},
     featureCount:features.length,
     bytes:{fullMessageJsonUtf8:encoder.encode(originalJson).byteLength,
       featuresArrayJsonUtf8:bytes(features),sumIndividualFeatureJsonUtf8:totals.features,
       sumGeometryJsonUtf8:totals.geometry,
       sumCoordinateArraysJsonUtf8:totals.coordinates,
       sumPropertiesJsonUtf8:totals.properties,
       sumRootIdJsonUtf8:totals.root,sumIdJsonUtf8:totals.id,
       sumOtherFieldsObjectJsonUtf8:totals.other},
     originalMessageSha256:await digest(originalJson),
     counts:{polygons:totals.polygons,rings:totals.rings,
       holes:totals.holes,vertices:totals.vertices,
       positionComponents:totals.positionComponents},
     geometryTypes,outerKeys,propertyKeys,
     perCountry:perCountry.sort((a,b)=>b.sizes.feature-a.sizes.feature),
     capturedBeforeTransition:globalThis.__P6CountryRequests.length,
   };
 });
 assert(report.census.featureCount===254,'Required 254-feature input missing');
 assert(report.census.perCountry.length===254,'Country census rows incomplete');
 await page.locator('#timelinePreviousYear').click({timeout:45000});
 await expect.poll(()=>page.evaluate(()=>({
   month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
   cursor:globalThis.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor,
   ready:document.querySelector('#viewerStatus')?.dataset.ready,
 })),{timeout:180000}).toEqual({month:'2025-12',cursor:'2025-12',ready:'true'});
 report.transition=await page.evaluate(()=>({
   month:globalThis.__PANDOLAB_VIEWER__.builtinMonth().month,
   inputRequests:globalThis.__P6CountryRequests.map(row=>({
     type:row.data.type,requestId:row.data.requestId,
     generation:row.data.projectGeneration,quality:row.data.quality,
     featureCount:row.data.features?.length,removedCount:row.data.removedIds?.length||0,
   })),
   workerReused:globalThis.__PANDOLAB_VIEWER__.rendererStats().countryBoundaryReuseCount??0,
 }));
 if(errors.length)throw Error('Page errors: '+errors.join(' | '));
 report.status='passed';
} catch(error){
 report.status='failed';report.failure=String(error?.stack||error);
} finally{
 try{await context?.close();await browser?.close();}finally{
   await new Promise(done=>server.close(done));
   const pathname=join(output,'w2-p6-1-country-payload-census.json');
   writeFileSync(pathname,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
   console.log('W2P6_CENSUS '+JSON.stringify({
     status:report.status,source:PIN,data:DATA,
     featureCount:report.census?.featureCount??null,
     bytes:report.census?.bytes??null,
     counts:report.census?.counts??null,
     propertyKeyCount:Object.keys(report.census?.propertyKeys||{}).length,
     capture:report.transition?.inputRequests||null,
     failure:report.failure||null,
   }));
 }
}
if(report.status!=='passed')process.exitCode=1;
