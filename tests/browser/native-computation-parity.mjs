// Compare the actual shared C++/WASM and renderer preparation in two native WebViews.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{windows:{type:'string'},android:{type:'string'},output:{type:'string'}}});
if(!values.windows||!values.android||!values.output)throw Error('--windows PORT --android PORT --output FILE required');
const wrapping=JSON.parse(await readFile(new URL('../fixtures/p6/wrapping-baseline.json',import.meta.url),'utf8')).cases;
const results={};
for(const platform of ['windows','android']){
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+values[platform],{noDefaults:true});
 try{const page=browser.contexts()[0].pages()[0];await page.waitForSelector('#app[data-readiness=enhanced]',{timeout:180000});
 results[platform]=await page.evaluate(async wrapping=>{
  const {loadVerifiedCore}=await import('/assets/js/modules/core-wasm-loader.js');
  const core=await loadVerifiedCore({baseUrl:new URL('/assets/wasm/',location.href)});
  const box=(x,y,w,h)=>[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]];
  const a=box(0,0,2,2),b=box(1,0,2,2),geometry={type:'Polygon',coordinates:box(0,0,3,2)};
  const calculations={union:core.polygonOperation('union',[a,b],false),difference:core.polygonOperation('difference',[box(0,0,5,5),box(1,1,1,1)],false),intersection:core.polygonOperation('intersection',[a,box(10,10,1,1)],false),normalized:core.normalizePolygonGeometry(geometry,true),wrapping:wrapping.filter(row=>row.operation==='wrap').map(row=>({id:row.id,result:JSON.parse(core.wrapPolygonGeometry(JSON.stringify(row.input)))}))};
  const {resolveMapSurfacePresentation}=await import('/assets/js/modules/country-mesh-zoom-policy.js');
  const {buildPolygonGeometryPacket,buildStrokeGeometryPacket}=await import('/assets/js/modules/render-scene.js');
  const packet=buildPolygonGeometryPacket(geometry),stroke=buildStrokeGeometryPacket(geometry);
  const plain=value=>ArrayBuffer.isView(value)?Array.from(value):value;
  const renderer={polygon:Object.fromEntries(Object.entries(packet).map(([k,v])=>[k,plain(v)])),stroke:Object.fromEntries(Object.entries(stroke).map(([k,v])=>[k,plain(v)])),quality:[141,504,550,642,900].map(cssScale=>resolveMapSurfacePresentation({cssScale,canonicalReady:true,previewReady:true,previewVerified:true}))};
  const bytes=await fetch('/assets/wasm/pandoeditor-core.wasm',{cache:'no-store'}).then(r=>r.arrayBuffer());
  const wasmSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  return{wasmSha256,sourceSha256:core.coreSourceSha256,abi:core.coreAbiVersion,calculations,renderer};
 },wrapping);
 }finally{await browser.close();}
}
assert.deepEqual(results.android,results.windows,'Native platforms must use the same verified bytes and produce the same calculations and renderer packets');
await writeFile(values.output,JSON.stringify({equal:true,...results},null,2));
console.log(JSON.stringify({equal:true,wasmSha256:results.windows.wasmSha256,wrappingCases:results.windows.calculations.wrapping.length,rendererPackets:true}));
