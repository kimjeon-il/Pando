// Native application integration: real WebViews, OS pickers, chunk transfer,
// C++ editing and GeoPackage persistence. No analysis execution in a browser.
import { chromium, expect } from '@playwright/test';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,join,basename } from 'node:path';
import { parseArgs,promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { instrumentMapPlugin,verifyMapPluginFlow } from './helpers/map-plugin-flow.mjs';
const run=promisify(execFile);
const {values}=parseArgs({options:{platform:{type:'string'},port:{type:'string'},pid:{type:'string'},fixture:{type:'string'},output:{type:'string'},serial:{type:'string',default:'emulator-5554'}}});
if(!['windows','android'].includes(values.platform)||!values.port||!values.fixture||!values.output)throw new Error('--platform windows|android --port --fixture --output required');
const output=resolve(values.output);await mkdir(output,{recursive:true});
const fixture=resolve(values.fixture),collection=JSON.parse(await readFile(fixture,'utf8'));
const adb='D:/Android/Sdk/platform-tools/adb.exe',serial=values.serial;
const android=(...args)=>run(adb,['-s',serial,...args],{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});
const fileName='pando-map-plugin-'+values.platform+'-'+Date.now()+'.gpkg';
const saved=join(output,fileName),deviceSaved='/sdcard/Download/'+fileName,deviceInput='/sdcard/Download/pando-map-plugin-input.geojson';
const nativeDialog=async(path,mode)=>{
  if(!values.pid)throw new Error('--pid required for the test-owned Windows host');
  const result=await run('powershell.exe',['-NoProfile','-File',resolve('tests/helpers/native-file-dialog.ps1'),'-OwnerProcessId',values.pid,'-TargetPath',path,'-Mode',mode],{windowsHide:true,timeout:20000});
  return JSON.parse(result.stdout.trim());
};
async function nodes() {
  await android('shell','uiautomator','dump','/data/local/tmp/pando-map-plugin.xml');
  const {stdout}=await android('shell','cat','/data/local/tmp/pando-map-plugin.xml');
  return [...stdout.matchAll(/<node\b([^>]+)>/gu)].map(match=>Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/gu)].map(row=>[row[1],row[2].replaceAll('&amp;','&').replaceAll('&quot;','"')])));
}
async function tap(node) {
  const m=node?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if(!m)throw new Error('Android picker target has no bounded rectangle');
  await android('shell','input','tap',String(Math.round((+m[1]+ +m[3])/2)),String(Math.round((+m[2]+ +m[4])/2)));
}
async function openAndroidFile(name) {
  for(let attempt=0;attempt<5;attempt++) {
    const rows=await nodes(),file=rows.find(n=>n.text===name);
    if(file){await tap(file);return;}
    const downloads=rows.find(n=>['Downloads','Download','다운로드'].includes(n.text) && n.class==='android.widget.TextView');
    if(downloads){await tap(downloads);continue;}
    const roots=rows.find(n=>/Show roots|탐색.*열기|루트 표시|탐색 메뉴 열기/.test(n['content-desc'] || ''));
    if(roots){await tap(roots);continue;}
    throw new Error('Android document picker has no test file or Downloads navigation: '+JSON.stringify(rows.filter(n=>n.class?.includes('Button')).map(n=>({id:n['resource-id'],text:n.text,description:n['content-desc']}))));
  }
  throw new Error('Android test file was not found in Downloads');
}
async function saveAndroidFile(name) {
  const rows=await nodes(),edit=rows.find(n=>n.class==='android.widget.EditText');
  await tap(edit);await android('shell','input','keyevent','123',...Array(80).fill('67'));await android('shell','input','text',name);
  const refreshed=await nodes(),button=refreshed.find(n=>['SAVE','Save','저장'].includes(n.text) && /Button/.test(n.class));
  await tap(button);
}
const browser=await chromium.connectOverCDP('http://127.0.0.1:'+values.port,{noDefaults:true});
const context=browser.contexts()[0],page=context.pages()[0];page.setDefaultTimeout(15000);
const events=[];page.on('console',message=>{if(message.type()==='error')events.push(message.text());});
try {
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  // Preserve the current reference collection through its existing export API
  // before switching the test to an isolated autosave namespace.
  const preserved=await page.evaluate(async()=>{
    const {referenceImageProjectAssets}=await import(new URL('assets/js/modules/reference-image-store.js',location.href).href);
    return referenceImageProjectAssets.exportPackage();
  });
  if(preserved.records?.length || preserved.images?.length || preserved.sources?.length) {
    const privateRoot='D:/dev/PandoLab-library-data/.pando-private/reference-image-preservation';await mkdir(privateRoot,{recursive:true});
    await writeFile(join(privateRoot,values.platform+'-'+Date.now()+'.json'),JSON.stringify(preserved),{flag:'wx'});
  }
  const preservation={sourceCount:preserved.sources?.length || 0,recordCount:preserved.records?.length || preserved.images?.length || 0};
  await instrumentMapPlugin(page);
  await page.route('**/shell/runtime-profile.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    await route.fulfill({response,body:source.replace('pandoeditor-web-shell-world-v1','pando-map-plugin-validation-'+Date.now())});
  });
  await page.reload();await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  const platform=await page.evaluate(()=>{
    if(typeof globalThis.__TAURI_INTERNALS__?.invoke!=='function')throw new Error('Actual native bridge required');
    const invoke=globalThis.__TAURI_INTERNALS__.invoke;window.__nativeCommands=[];
    globalThis.__TAURI_INTERNALS__.invoke=(command,...args)=>{window.__nativeCommands.push(command);return invoke(command,...args);};
    return {url:location.href,userAgent:navigator.userAgent,width:window.innerWidth,height:window.innerHeight};
  });
  if(values.platform==='android'){expect(platform.width).toBeGreaterThan(platform.height);await android('push',fixture,deviceInput);}
  const result=await verifyMapPluginFlow(page,collection,{
    touch:values.platform==='android',
    openGis:async()=>{
      await page.locator('#openGisBtn').click();
      if(values.platform==='windows')await nativeDialog(fixture,'Open');else await openAndroidFile(basename(deviceInput));
    },
    saveReopen:async()=>{
      await page.locator('#mobileFileBtn').click();await page.locator('#saveProjectBtn').click();
      if(values.platform==='windows')await nativeDialog(saved,'Save');else await saveAndroidFile(fileName);
      await expect.poll(()=>page.evaluate(()=>window.__pluginDocument().state().dirty),{timeout:30000}).toBe(false);
      await page.evaluate(()=>{window.__nativeReopened=false;window.addEventListener('pandolab:project-changed',event=>{if(event.detail?.reason==='project-load')window.__nativeReopened=true;});});
      await page.locator('#mobileFileBtn').click();await page.locator('#openProjectBtn').click();
      if(values.platform==='windows')await nativeDialog(saved,'Open');else await openAndroidFile(fileName);
      await expect.poll(()=>page.evaluate(()=>window.__nativeReopened),{timeout:30000}).toBe(true);
      if(values.platform==='android')await android('pull',deviceSaved,saved);
      const bytes=await readFile(saved);
      expect(bytes.subarray(0,16).toString()).toBe('SQLite format 3\u0000');
      return {path:saved,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    },
  });
  const commands=await page.evaluate(()=>window.__nativeCommands);
  for(const required of ['begin_document_read','read_document_chunk','begin_document_write','append_document_chunk','finish_document_write'])expect(commands).toContain(required);
  await writeFile(join(output,'native-'+values.platform+'.json'),JSON.stringify({platform,preservation,...result,nativeCommands:commands,consoleErrors:events},null,2));
  await page.screenshot({path:join(output,'native-'+values.platform+'.png')});
  console.log(JSON.stringify({platform:values.platform,...result}));
} catch(error) {
  await page.screenshot({path:join(output,'native-'+values.platform+'-failed.png')}).catch(()=>{});
  await writeFile(join(output,'native-'+values.platform+'-failed.json'),JSON.stringify({message:error.message,stack:error.stack,events},null,2));throw error;
} finally {await browser.close();}
