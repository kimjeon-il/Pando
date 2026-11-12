#!/usr/bin/env node
// Small real-CDN transfer/decode comparison; this is not a Viewer benchmark.
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';

const [cogDir,tileDir,out]=process.argv.slice(2);
if(!cogDir||!tileDir||!out)throw Error('Expected existing COG directory, WebP directory and new report path');
const cogManifest=JSON.parse(await readFile(`${cogDir}/manifest.json`));
const tileManifest=JSON.parse(await readFile(`${tileDir}/manifest.json`));
if(cogManifest.sourceSha256!==tileManifest.sourceSha256||cogManifest.region!=='southwest-china')throw Error('Sample identities differ');
const records=tileManifest.records.filter(r=>r.region==='southwest-china'&&r.tileSize===1024);
if(records.length!==4)throw Error('Expected four 1024 sample tiles');
const base='https://cdn.jsdelivr.net/gh/kimjeon-il/PandoLab-library-data@0fc425921e1fb431ef35d9af6f5ac762f2b3a269/reports/development/performance/terrain-architecture-2026-11-12/';
const cogUrl=base+'p3/centered-southwest-china-cog/regional-q1.tif',tileBase=base+'p2/fixtures-centered/webp/';
const bundle=await build({stdin:{contents:"export {openViewerCogTiles} from './scripts/terrain-experiment/viewer-cog-tiles.mjs';",
  resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'CogTransfer',write:false});
const server=createServer((_,response)=>response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Terrain transfer experiment</title>'));
const report={schema:'pando-terrain-external-transfer-v1',sourceSha256:cogManifest.sourceSha256,cogSha256:cogManifest.sha256,
  dataRevision:'0fc425921e1fb431ef35d9af6f5ac762f2b3a269',cogUrl,tileBase,startedAt:new Date().toISOString(),runs:[],status:'running',
  limitations:['Single 2x2 regional sample; localhost test page, external HTTPS CDN; not the Viewer or GPU rendering.',
    'Cold means a fresh browser context; CDN edge, DNS and shared network caches are not controlled.',
    'Warm means same-page reuse of an in-memory WebP blob or COG adapter PNG cache followed by image decoding.',
    'Range payload counts are logical adapter bytes; Resource Timing transferSize includes browser cache effects and HTTP overhead.',
    'COG uses a verified chunk cache and PNG conversion; WebP uses verified blobs; neither duplicates the Viewer GPU texture cache.']};
let browser;
try{
  await new Promise((yes,no)=>server.once('error',no).listen(0,'127.0.0.1',yes));
  browser=await chromium.launch({headless:true});report.browserVersion=browser.version();
  const sequence=['webp','cog','cog','webp','webp','cog'];
  for(const [index,candidate] of sequence.entries()){
    const context=await browser.newContext(),page=await context.newPage();
    try{
      await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.addScriptTag({content:bundle.outputFiles[0].text});
      const samples=await page.evaluate(async({candidate,cogManifest,tileManifest,records,cogUrl,tileBase})=>{
        const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
        const cache=new Map();let adapter=null;
        const results=[];
        for(const phase of ['cold','warm']){
          performance.clearResourceTimings();const started=performance.now();
          if(candidate==='cog'&&!adapter)adapter=await CogTransfer.openViewerCogTiles({url:cogUrl,cogManifest,tileManifest,tileSize:1024,region:'southwest-china'});
          const blobs=await Promise.all(records.map(async item=>{
            const key=`5/${(item.window[0]+item.offset[0])/1024}-${(item.window[1]+item.offset[1])/1024}.webp`;
            if(adapter)return adapter.readTile(key);
            if(cache.has(key))return cache.get(key);
            const response=await fetch(tileBase+item.file);if(!response.ok)throw Error(`WebP HTTP ${response.status}`);
            const blob=await response.blob(),bytes=await blob.arrayBuffer();
            if(bytes.byteLength!==item.webpBytes||await sha(bytes)!==item.webpSha256)throw Error('WebP identity mismatch');
            cache.set(key,blob);return blob;
          }));
          for(const blob of blobs){const image=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'});
            if(image.width!==1026||image.height!==1026)throw Error('Decoded tile dimensions differ');image.close();}
          const durationMs=performance.now()-started;
          const resources=performance.getEntriesByType('resource').filter(item=>item.name.startsWith('https://cdn.jsdelivr.net/'));
          results.push({phase,durationMs,resources:resources.length,transferBytes:resources.reduce((sum,item)=>sum+item.transferSize,0),
            encodedBodyBytes:resources.reduce((sum,item)=>sum+item.encodedBodySize,0),
            ...(adapter?{range:{...adapter.statistics},cache:{...adapter.counts}}:{blobCacheEntries:cache.size})});
        }
        return results;
      },{candidate,cogManifest,tileManifest,records,cogUrl,tileBase});
      report.runs.push({index:index+1,candidate,status:'passed',samples});
    }catch(error){report.runs.push({index:index+1,candidate,status:'failed',error:String(error?.stack||error)});}
    finally{await context.close();}
  }
  report.status=report.runs.length===6&&report.runs.every(run=>run.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error?.stack||error);}
finally{await browser?.close();await new Promise(done=>server.close(done));report.finishedAt=new Date().toISOString();
  await writeFile(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({status:report.status,runs:report.runs}));
if(report.status!=='passed')process.exitCode=1;
