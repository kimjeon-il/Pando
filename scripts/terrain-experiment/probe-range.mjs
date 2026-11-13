#!/usr/bin/env node
// Check what both a non-browser client and browser JavaScript can see.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const url='https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/0866eb0aebb35d1355892b808de331b30c5fe52b/terrain/v0.14.0/5/0-0.webp';
if(!process.argv[2])throw Error('Explicit output path required');
const response=await fetch(url,{headers:{Origin:'https://example.org',Range:'bytes=0-31'}});
const server={status:response.status,contentRange:response.headers.get('content-range'),
  allowOrigin:response.headers.get('access-control-allow-origin'),
  exposeHeaders:response.headers.get('access-control-expose-headers'),
  bodyBytes:(await response.arrayBuffer()).byteLength};
const browser=await chromium.launch({headless:true});
let client;
try{
  const page=await browser.newPage();
  client=await page.evaluate(async address=>{
    const r=await fetch(address,{headers:{Range:'bytes=0-31'}});
    return {status:r.status,type:r.type,contentRange:r.headers.get('content-range'),
      contentLength:r.headers.get('content-length'),bodyBytes:(await r.arrayBuffer()).byteLength};
  },url);
  const output={schema:'pando-terrain-range-probe-v1',url,at:new Date().toISOString(),
    browserVersion:browser.version(),server,client,
    interpretation:'This tests the current GitHub raw host and tile, not a future COG deployment or CDN.'};
  await writeFile(process.argv[2],JSON.stringify(output,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(output));
}finally{await browser.close();}
