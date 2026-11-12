#!/usr/bin/env node
// B-archive regional comparison on one actual CDN; not a Viewer benchmark.
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {platform,release,arch,cpus,totalmem} from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';

const [archivePath,archiveReportPath,tileDir,pmtilesJsPath,out,...options]=process.argv.slice(2);
if(!archivePath||!archiveReportPath||!tileDir||!pmtilesJsPath||!out||options.length>3||options.some(value=>!value.startsWith('--chunk=')&&!value.startsWith('--tiles=')&&!value.startsWith('--coalesce=')))
  throw Error('Expected archive, report, WebP directory, official JS bundle, new output and optional --chunk/--tiles/--coalesce');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const archive=await readFile(archivePath),meta=JSON.parse(await readFile(archiveReportPath));
const tileManifest=JSON.parse(await readFile(`${tileDir}/manifest.json`)),bundleBytes=await readFile(pmtilesJsPath);
if(hash(bundleBytes)!=='caf981bc46f6327ee7e65d5dc964d89d38a69f60edca2bd4c5c890c21b554c6c')throw Error('Unexpected PMTiles JS bundle');
const reference=meta.results.find(row=>row.tileSize===1024);
if(!reference||hash(archive)!==reference.sha256||archive.length!==reference.archiveBytes||meta.sourceSha256!==tileManifest.sourceSha256)
  throw Error('Archive or source identity mismatch');
const allRecords=tileManifest.records.filter(row=>row.region==='southwest-china'&&row.tileSize===1024);
if(allRecords.length!==4)throw Error('Expected four sample tiles');
const tileCount=Number(options.find(value=>value.startsWith('--tiles='))?.slice('--tiles='.length)||4);
if(![1,4].includes(tileCount))throw Error('Unsupported sample tile count');
const records=allRecords.slice(0,tileCount);
const chunkBytes=Number(options.find(value=>value.startsWith('--chunk='))?.slice('--chunk='.length)||65536);
if(![65536,524288].includes(chunkBytes))throw Error('Unsupported verified chunk size');
const maxCoalescedChunks=Number(options.find(value=>value.startsWith('--coalesce='))?.slice('--coalesce='.length)||1);
if(![1,8].includes(maxCoalescedChunks))throw Error('Unsupported coalescing');
const chunks=[];for(let i=0;i<archive.length;i+=chunkBytes)chunks.push(hash(archive.subarray(i,i+chunkBytes)));
const manifest={bytes:archive.length,sha256:hash(archive),chunkBytes,chunks};
const base='https://fastly.jsdelivr.net/gh/kimjeon-il/PandoLab-library-data@';
const tileBase=base+'0fc425921e1fb431ef35d9af6f5ac762f2b3a269/reports/development/performance/terrain-architecture-2026-11-12/p2/fixtures-centered/webp/';
const archiveUrl=base+'0ec9535b4210338d437ef428be1dce2e852b6a3e/reports/development/performance/terrain-architecture-2026-11-12/p4/pmtiles-regional-sample/china-1024.pmtiles';
const helper=await build({stdin:{contents:"export {createVerifiedRangeClient} from './scripts/terrain-experiment/verified-cog-reader.mjs';",
  resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'VerifiedArchive',write:false});
const server=createServer((_,response)=>response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>PMTiles transfer experiment</title>'));
const report={schema:'pando-pmtiles-external-comparison-v1',sourceSha256:meta.sourceSha256,archiveSha256:manifest.sha256,chunkBytes,tileCount,maxCoalescedChunks,
  host:{platform:platform(),release:release(),arch:arch(),cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem()},
  pmtilesJsSha256:hash(bundleBytes),archiveUrl,tileBase,startedAt:new Date().toISOString(),runs:[],status:'running',
  limitations:['Single regional LOD5 sample; local test page, external Fastly CDN; not the Viewer or GPU rendering.',
    'PMTiles addresses use a custom EPSG:4326 grid, not standard Web Mercator XYZ.',
    'Cold means fresh browser context; DNS, CDN edge and shared network caches are not controlled.',
    'Warm means same-page reuse of verified WebP blobs followed by image decode, not Viewer GPU texture reuse.',
    'Both sources use the same CDN host; immutable archive and tile paths are from different verified data commits.']};
let browser;
try{
  await new Promise((yes,no)=>server.once('error',no).listen(0,'127.0.0.1',yes));
  browser=await chromium.launch({headless:true});report.browserVersion=browser.version();
  for(const [index,candidate] of ['webp','pmtiles','pmtiles','webp','webp','pmtiles'].entries()){
    const context=await browser.newContext(),page=await context.newPage();
    try{
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.addScriptTag({content:bundleBytes.toString('utf8')});await page.addScriptTag({content:helper.outputFiles[0].text});
      const samples=await page.evaluate(async({candidate,manifest,archiveUrl,tileBase,records,zoom,maxCoalescedChunks})=>{
        const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
        const cache=new Map();let client=null,reader=null;const results=[];
        for(const phase of ['cold','warm']){
          performance.clearResourceTimings();const started=performance.now();
          if(candidate==='pmtiles'&&!reader){
            client=VerifiedArchive.createVerifiedRangeClient({url:archiveUrl,manifest,maxCoalescedChunks});
            reader=new pmtiles.PMTiles({getKey:()=>archiveUrl,async getBytes(offset,length,signal){
              const response=await client.request({headers:{Range:`bytes=${offset}-${offset+length-1}`},signal});return {data:await response.getData()};}});
          }
          const blobs=await Promise.all(records.map(async item=>{
            const x=(item.window[0]+item.offset[0])/1024,y=(item.window[1]+item.offset[1])/1024,key=`${zoom}/${x}/${y}`;
            if(cache.has(key))return cache.get(key);
            let bytes;
            if(reader){const result=await reader.getZxy(zoom,x,y);if(!result)throw Error('PMTiles tile absent');bytes=result.data;}
            else{const response=await fetch(tileBase+item.file);if(!response.ok)throw Error(`WebP HTTP ${response.status}`);bytes=await response.arrayBuffer();}
            if(bytes.byteLength!==item.webpBytes||await sha(bytes)!==item.webpSha256)throw Error('Tile identity mismatch');
            const blob=new Blob([bytes],{type:'image/webp'});cache.set(key,blob);return blob;
          }));
          for(const blob of blobs){const image=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'});
            if(image.width!==1026||image.height!==1026)throw Error('Tile dimensions differ');image.close();}
          const durationMs=performance.now()-started,resources=performance.getEntriesByType('resource').filter(item=>item.name.startsWith('https://fastly.jsdelivr.net/'));
          results.push({phase,durationMs,resources:resources.length,transferBytes:resources.reduce((sum,item)=>sum+item.transferSize,0),
            encodedBodyBytes:resources.reduce((sum,item)=>sum+item.encodedBodySize,0),blobCacheEntries:cache.size,...(client?{range:{...client.statistics}}:{})});
        }
        return results;
      },{candidate,manifest,archiveUrl,tileBase,records,zoom:reference.archiveZoom,maxCoalescedChunks});
      report.runs.push({index:index+1,candidate,status:'passed',samples});
    }catch(error){report.runs.push({index:index+1,candidate,status:'failed',error:String(error?.stack||error)});}
    finally{await context.close();}
  }
  report.status=report.runs.length===6&&report.runs.every(run=>run.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error?.stack||error);}
finally{await browser?.close();await new Promise(done=>server.close(done));report.finishedAt=new Date().toISOString();
  await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({status:report.status,runs:report.runs}));if(report.status!=='passed')process.exitCode=1;
