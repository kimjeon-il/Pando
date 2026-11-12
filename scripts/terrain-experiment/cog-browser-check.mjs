#!/usr/bin/env node
// Browser COG range/decode experiment, independent of the Viewer backend.
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';

const [cogPath,reportRoot,outArg]=process.argv.slice(2);
if(!cogPath||!reportRoot||!outArg)throw Error('Expected COG file, report root and new output directory');
const out=resolve(outArg),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const cog=await readFile(cogPath),chunkBytes=65536,chunks=[];
for(let at=0;at<cog.length;at+=chunkBytes)chunks.push(sha(cog.subarray(at,at+chunkBytes)));
const manifest={bytes:cog.length,chunkBytes,sha256:sha(cog),chunks};
const windows=[
  {dir:'tile-size-inputs',name:'southwest-china-lod5-Q1.rgba.gz',size:1024},
  {dir:'cog-lod4-inputs',name:'southwest-china-lod4-Q1.rgba.gz',size:512},
  {dir:'cog-lod3-inputs',name:'southwest-china-lod3-Q1.rgba.gz',size:256},
];
for(const item of windows){
  const rgba=gunzipSync(await readFile(join(reportRoot,item.dir,item.name))),rgb=Buffer.alloc(100*100*3);
  if(rgba.length!==item.size*item.size*4)throw Error('Expected regional RGBA dimensions');
  let offset=0;for(let y=64;y<164;y++)for(let x=64;x<164;x++){
    const at=(y*item.size+x)*4;rgba.copy(rgb,offset,at,at+3);offset+=3;
  }
  item.expectedSha256=sha(rgb);
}
const output=await build({stdin:{contents:"export {openVerifiedCog,createVerifiedRangeClient} from './scripts/terrain-experiment/verified-cog-reader.mjs';",
  resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'CogExperiment',write:false});
await mkdir(out,{recursive:false});
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>COG range experiment</title>');return;}
  if(!['/cog.tif','/status.tif','/bad-range.tif','/corrupt.tif'].includes(path)){res.writeHead(404).end();return;}
  const match=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');
  if(!match){res.writeHead(416).end();return;}
  const start=Number(match[1]),end=Math.min(Number(match[2]),cog.length-1);
  if(start>=cog.length||end<start){res.writeHead(416).end();return;}
  const bytes=Buffer.from(cog.subarray(start,end+1));if(path==='/corrupt.tif')bytes[0]^=1;
  const header=path==='/bad-range.tif'?'bytes 0-0/1':`bytes ${start}-${end}/${cog.length}`;
  res.writeHead(path==='/status.tif'?200:206,{'Content-Type':'image/tiff','Content-Range':header,'Content-Length':bytes.length}).end(bytes);
});
let browser;const report={schema:'pando-terrain-browser-cog-check-v1',manifest,windows,status:'running'};
try{
  await new Promise((yes,no)=>server.once('error',no).listen(0,'127.0.0.1',yes));
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  const origin=`http://127.0.0.1:${server.address().port}`;await page.goto(origin);
  await page.addScriptTag({content:output.outputFiles[0].text});
  const result=await page.evaluate(async({manifest,origin})=>{
    const {tiff,statistics}=await globalThis.CogExperiment.openVerifiedCog({url:origin+'/cog.tif',manifest});
    const levels=[];
    for(let index=0;index<3;index++){
      const image=await tiff.getImage(index),pixels=await image.readRasters({window:[64,64,164,164],interleave:true});
      const hash=await crypto.subtle.digest('SHA-256',pixels);
      levels.push({index,width:image.getWidth(),height:image.getHeight(),bytes:pixels.byteLength,
        sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')});
    }
    const failures=[];
    for(const path of ['/status.tif','/bad-range.tif','/corrupt.tif']){
      const client=globalThis.CogExperiment.createVerifiedRangeClient({url:origin+path,manifest});
      try{await client.request({headers:{Range:'bytes=0-63'}});failures.push({path,rejected:false});}
      catch(error){failures.push({path,rejected:true,error:String(error)});}
    }
    return {levels,statistics,failures};
  },{manifest,origin});
  report.browserVersion=browser.version();report.result=result;
  if(result.levels.length!==3||result.levels.some((level,i)=>level.sha256!==windows[i].expectedSha256))throw Error('Browser COG pixels differ from original Q1 input');
  if(result.failures.some(failure=>!failure.rejected))throw Error('A broken HTTP range was accepted');
  report.status='passed';
}catch(error){report.status='failed';report.error=String(error?.stack||error);}
finally{await browser?.close();await new Promise(done=>server.close(done));
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({status:report.status,result:report.result,error:report.error?.slice(0,300)}));
if(report.status!=='passed')process.exitCode=1;
