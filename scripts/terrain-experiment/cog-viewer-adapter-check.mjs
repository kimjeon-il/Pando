#!/usr/bin/env node
// Verify COG windows reproduce the exact A1/B guttered pixels in a browser.
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const [cogDir,tileDir,outArg]=process.argv.slice(2);
if(!cogDir||!tileDir||!outArg)throw Error('Expected COG directory, WebP fixture directory and new output');
const cogManifest=JSON.parse(await readFile(join(cogDir,'manifest.json'))),tileManifest=JSON.parse(await readFile(join(tileDir,'manifest.json')));
const bytes=await readFile(join(cogDir,cogManifest.filename));
if(bytes.length!==cogManifest.bytes)throw Error('COG length mismatch');
const bundle=await build({stdin:{contents:"export {openViewerCogTiles} from './scripts/terrain-experiment/viewer-cog-tiles.mjs';",
  resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'CogTileExperiment',write:false});
const out=resolve(outArg);await mkdir(out,{recursive:false});
const server=createServer((request,response)=>{
  if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>COG Viewer adapter check</title>');return;}
  if(request.url!=='/regional-q1.tif'){response.writeHead(404).end();return;}
  const m=/^bytes=(\d+)-(\d+)$/.exec(request.headers.range||'');
  if(!m){response.writeHead(416).end();return;}
  const start=Number(m[1]),end=Math.min(Number(m[2]),bytes.length-1);
  if(start>=bytes.length||end<start){response.writeHead(416).end();return;}
  response.writeHead(206,{'Content-Type':'image/tiff','Content-Range':`bytes ${start}-${end}/${bytes.length}`,
    'Content-Length':end-start+1}).end(bytes.subarray(start,end+1));
});
let browser;const report={schema:'pando-cog-viewer-adapter-check-v1',cogSha256:cogManifest.sha256,
  sourceSha256:cogManifest.sourceSha256,status:'running'};
try{
  await new Promise((yes,no)=>server.once('error',no).listen(0,'127.0.0.1',yes));
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),origin=`http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);await page.addScriptTag({content:bundle.outputFiles[0].text});
  report.browserVersion=browser.version();
  report.region=cogManifest.region||'southwest-china';
  report.runs=await page.evaluate(async({origin,cogManifest,tileManifest,region})=>{
    const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const results=[];
    for(const size of [1024,512]){
      const adapter=await globalThis.CogTileExperiment.openViewerCogTiles({url:origin+'/regional-q1.tif',cogManifest,tileManifest,tileSize:size,region});
      const tiles=[];
      const selected=tileManifest.records.filter(r=>r.tileSize===size&&r.region===region);
      const blobs=await Promise.all(selected.map(record=>{
        const x=(record.window[0]+record.offset[0])/size,y=(record.window[1]+record.offset[1])/size;
        return adapter.readTile(`5/${x}-${y}.webp`);
      }));
      for(const [index,record] of selected.entries()){
        const x=(record.window[0]+record.offset[0])/size,y=(record.window[1]+record.offset[1])/size,key=`5/${x}-${y}.webp`;
        const blob=blobs[index],bitmap=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'});
        const surface=new OffscreenCanvas(record.width,record.height),ctx=surface.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
        const actual=await sha(ctx.getImageData(0,0,record.width,record.height).data);
        if(actual!==record.rawSha256)throw Error('PNG round-trip differs: '+key);
        tiles.push({key,pngBytes:blob.size,rawSha256:actual});
      }
      await adapter.readTile(tiles[0].key);
      let outsideRejected=false;try{await adapter.readTile('5/0-0.webp');}catch{outsideRejected=true;}
      if(!outsideRejected)throw Error('Out-of-fixture tile was accepted');
      results.push({tileSize:size,tiles,counts:{...adapter.counts},range:{...adapter.statistics},outsideRejected});
    }
    return results;
  },{origin,cogManifest,tileManifest,region:report.region});
  report.status='passed';
}catch(error){report.status='failed';report.error=String(error?.stack||error);}
finally{await browser?.close();await new Promise(done=>server.close(done));
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({status:report.status,runs:report.runs?.map(r=>({tileSize:r.tileSize,tiles:r.tiles.length,range:r.range,counts:r.counts})),error:report.error?.slice(0,300)}));
if(report.status!=='passed')process.exitCode=1;
