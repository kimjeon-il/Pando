import {chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {verifyKoreanBoundaryWorkflow} from './korean-boundary-workflow.mjs';

const endpoint=process.env.PANDOLAB_WEBVIEW_CDP || 'http://127.0.0.1:9237';
const output=path.resolve(process.env.PANDOLAB_WEBVIEW_EVIDENCE || 'build-native/korea-webview.json');
const deadline=Date.now()+30000;
while(true){
  try{const response=await fetch(`${endpoint}/json/version`);if(response.ok)break;}
  catch(error){if(Date.now()>=deadline)throw error;}
  if(Date.now()>=deadline)throw new Error('Packaged WebView CDP endpoint unavailable');
  await new Promise(resolve=>setTimeout(resolve,500));
}
const browser=await chromium.connectOverCDP(endpoint);
try{
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));
  if(!page)throw new Error('Packaged Tauri page not found');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=new URL(page.url());url.searchParams.set('debug','1');
  await page.goto(url.href);
  const result=await verifyKoreanBoundaryWorkflow(page,{screenshotPath:output.replace(/\.json$/,'.png')});
  const manifest=await page.evaluate(async()=>{
    const response=await fetch('/assets/data/historical-world/generated/v1/manifest.json');
    if(!response.ok)throw new Error(`Historical manifest unavailable: ${response.status}`);
    return response.json();
  });
  const expected=JSON.parse(fs.readFileSync(new URL('../../../assets/data/historical-world/generated/v1/manifest.json',import.meta.url)));
  if(manifest.project.sha256!==expected.project.sha256)throw new Error('Packaged historical timeline differs from source');
  if(errors.length)throw new Error(`WebView page errors: ${errors.join('; ')}`);
  fs.writeFileSync(output,JSON.stringify({...result,errors,historicalProjectSha256:manifest.project.sha256},null,2)+'\n');
  console.log(`Packaged Korean boundary workflow verified: ${result.versions.length} dated selections; history ${manifest.project.sha256}`);
}finally{await browser.close();}
