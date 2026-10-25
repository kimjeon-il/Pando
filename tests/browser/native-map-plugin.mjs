// Native application integration: real WebViews, OS pickers, chunk transfer,
// C++ editing and GeoPackage persistence. No analysis execution in a browser.
import { chromium, expect } from '@playwright/test';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,join,basename } from 'node:path';
import { parseArgs,promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { instrumentMapPlugin,verifyMapPluginFlow,moduleSource,openFileMenu } from './helpers/map-plugin-flow.mjs';
const run=promisify(execFile);
const {values}=parseArgs({options:{platform:{type:'string'},port:{type:'string'},pid:{type:'string'},fixture:{type:'string'},output:{type:'string'},serial:{type:'string'},'windows-dialog-policy':{type:'string'},'reuse-session':{type:'boolean',default:false}}});
if(!['windows','android'].includes(values.platform)||!values.port||!values.fixture||!values.output)throw new Error('--platform windows|android --port --fixture --output required');
if(values['windows-dialog-policy'] && (values.platform!=='windows' || values['windows-dialog-policy']!=='RemoteSigned'))throw new Error('Only explicitly authorized Windows RemoteSigned process policy is supported');
const output=resolve(values.output);await mkdir(output,{recursive:true});
const fixture=resolve(values.fixture),collection=JSON.parse(await readFile(fixture,'utf8'));
if(values.platform==='android'&&!values.serial)throw new Error('--serial required for the test-owned Android device');
const adb=process.env.PANDOLAB_ADB||'adb',serial=values.serial;
const android=(...args)=>run(adb,['-s',serial,...args],{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});
const fileName='pando-map-plugin-'+values.platform+'-'+Date.now()+'.gpkg';
const saved=join(output,fileName),deviceSaved='/sdcard/Download/'+fileName,deviceInput='/sdcard/Download/pando-map-plugin-input.geojson';
const nativeDialog=async(path,mode)=>{
  if(!values.pid)throw new Error('--pid required for the test-owned Windows host');
  const policy=values['windows-dialog-policy']?['-ExecutionPolicy',values['windows-dialog-policy']]:[];
  const wait=mode==='Save'?120:10;
  const result=await run('powershell.exe',['-NoProfile',...policy,'-File',resolve('tests/helpers/native-file-dialog.ps1'),'-OwnerProcessId',values.pid,'-TargetPath',path,'-Mode',mode,'-WaitSeconds',String(wait)],{windowsHide:true,timeout:(wait+10)*1000});
  return JSON.parse(result.stdout.trim());
};
async function nodes() {
  const dumped=await android('shell','uiautomator','dump','/data/local/tmp/pando-map-plugin.xml').catch(error=>{
    // Samsung may kill the dumper after it has successfully written its XML.
    if(error.code===137&&error.stdout.includes('UI hierchary dumped to:'))return {stdout:error.stdout};
    throw error;
  });
  if(!dumped.stdout.includes('UI hierchary dumped to:'))return [];
  const {stdout}=await android('shell','cat','/data/local/tmp/pando-map-plugin.xml');
  return [...stdout.matchAll(/<node\b([^>]+)>/gu)].map(match=>Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/gu)].map(row=>[row[1],row[2].replaceAll('&amp;','&').replaceAll('&quot;','"')])));
}
async function tap(node) {
  const m=node?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if(!m)throw new Error('Android picker target has no bounded rectangle');
  await android('shell','input','tap',String(Math.round((+m[1]+ +m[3])/2)),String(Math.round((+m[2]+ +m[4])/2)));
}
async function waitAndroidPicker() {
  const deadline=Date.now()+120000;
  while(Date.now()<deadline) {
    const rows=await nodes();
    if(rows.some(row=>row.package==='com.google.android.documentsui'))return rows;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('The Android document picker did not appear');
}
async function openAndroidFile(name) {
  await waitAndroidPicker();
  for(let attempt=0;attempt<12;attempt++) {
    const rows=await nodes(),file=rows.find(n=>n.text===name&&n['resource-id']==='android:id/title');
    if(file){
      await tap(file);
      await new Promise(resolve=>setTimeout(resolve,500));
      if(!(await nodes()).some(row=>row.package==='com.google.android.documentsui'))return;
      continue;
    }
    const search=rows.find(n=>n.package==='com.google.android.documentsui'&&/^(Search|\uac80\uc0c9)$/.test(n['content-desc']||''));
    if(search){
      await tap(search);const field=(await nodes()).find(n=>n.package==='com.google.android.documentsui'&&n['resource-id']==='com.google.android.documentsui:id/search_src_text');
      if(!field)throw new Error('Document search field did not appear');
      await tap(field);await android('shell','input','text',name);await android('shell','input','keyevent','66');continue;
    }
    const downloads=rows.find(n=>['Downloads','Download','다운로드'].includes(n.text) && n.class==='android.widget.TextView');
    if(downloads){await tap(downloads);continue;}
    const roots=rows.find(n=>/Show roots|탐색.*열기|루트 표시|탐색 메뉴 열기/.test(n['content-desc'] || ''));
    if(roots){await tap(roots);continue;}
    throw new Error('Android document picker has no test file or Downloads navigation: '+JSON.stringify(rows.filter(n=>n.class?.includes('Button')).map(n=>({id:n['resource-id'],text:n.text,description:n['content-desc']}))));
  }
  throw new Error('Android test file was not found in Downloads');
}
async function saveAndroidFile(name) {
  const rows=await waitAndroidPicker(),edit=rows.find(n=>n.class==='android.widget.EditText');
  await tap(edit);await android('shell','input','keyevent','123',...Array(80).fill('67'));await android('shell','input','text',name);
  // Landscape Samsung IME uses an extract screen covering the provider's Save button.
  const ime=await android('shell','dumpsys','input_method');
  if(/mInputShown=true/.test(ime.stdout))await android('shell','input','keyevent','4');
  const refreshed=await nodes(),button=refreshed.find(n=>['SAVE','Save','저장'].includes(n.text) && /Button/.test(n.class));
  await tap(button);
}
const progress=phase=>process.stderr.write(JSON.stringify({platform:values.platform,phase})+'\n');
progress('connect-native');
const browser=await chromium.connectOverCDP('http://127.0.0.1:'+values.port,{noDefaults:true});
const context=browser.contexts()[0],page=context.pages()[0];page.setDefaultTimeout(values.platform==='android'?30000:15000);
const events=[];page.on('console',message=>{if(message.type()==='error')events.push(message.text());});
const readyTimeout=values.platform==='android'?180000:90000;
try {
  if(values['reuse-session']) {
    await page.evaluate(()=>{
      if(typeof window.__pluginDocument!=='function'||!Array.isArray(window.__nativeCommands)
        ||!window.__PANDOLAB_SHELL_PLATFORM__?.storageNamespace?.startsWith('pando-map-plugin-validation-'))throw new Error('Reuse requires this test\'s isolated instrumented session');
      const snapshot=window.__pluginDocument().snapshot();
      if(snapshot.genericFeatures.length||snapshot.hydroEdits.length)throw new Error('Reuse requires an empty test document; rerun without --reuse-session');
    });
    if(await page.locator('#gisImportModal').isVisible())await page.locator('[data-gis-cancel="true"]').click();
  } else {
  await instrumentMapPlugin(page);
  // Keep one loaded application revision while another chat updates the shared
  // checkout. Only the development reloader is paused, never application I/O.
  await page.route('**/__frontend/reload.js*',route=>route.fulfill({contentType:'application/javascript',body:'export {};'}));
  await page.route('**/shell/native-storage.js*',async route=>{
    const source=await moduleSource(route);
    const call='return globalThis.__TAURI_INTERNALS__.invoke(command, payload);';
    if(!source.includes(call))throw new Error('Native transport observation point changed');
    const observed="(window.__nativeCommands ||= []).push(command); const pending=globalThis.__TAURI_INTERNALS__.invoke(command,payload); return command==='finish_document_write'?pending.then(result=>{window.__nativeWriteResult=result;return result;}):pending;";
    await route.fulfill({contentType:'application/javascript',body:source.replace(call,observed)});
  });
  await page.route('**/shell/runtime-profile.js*',async route=>{
    const source=await moduleSource(route);
    await route.fulfill({contentType:'application/javascript',body:source.replace('pandoeditor-web-shell-world-v1','pando-map-plugin-validation-'+Date.now())});
  });
  await page.reload({waitUntil:'domcontentloaded',timeout:readyTimeout});await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:readyTimeout});
  }
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:readyTimeout});
  await expect(page.locator('#referenceImageBtn')).toHaveCount(0);
  progress('isolated-ready');
  const platform=await page.evaluate(()=>{
    if(typeof globalThis.__TAURI_INTERNALS__?.invoke!=='function')throw new Error('Actual native bridge required');
    window.__nativeCommands ||= [];
    return {url:location.href,userAgent:navigator.userAgent,width:window.innerWidth,height:window.innerHeight,appVersion:document.getElementById('app').dataset.appVersion};
  });
  platform.reusedSession=values['reuse-session'];
  if(values.platform==='android'){
    expect(platform.width).toBeGreaterThan(platform.height);
    const memory=await android('shell','cat','/proc/meminfo');platform.deviceMemoryKiB=Number(memory.stdout.match(/MemTotal:\s+(\d+)/)?.[1]);
    await android('push',fixture,deviceInput);
  }
  const result=await verifyMapPluginFlow(page,collection,{
    touch:values.platform==='android',
    touchInput:async gesture=>{
      const screen=await android('shell','wm','size'),dimensions=screen.stdout.match(/Physical size:\s*(\d+)x(\d+)/);
      if(!dimensions)throw new Error('Android physical display size unavailable');
      const width=Math.max(+dimensions[1],+dimensions[2]),height=Math.min(+dimensions[1],+dimensions[2]);
      const viewport=await page.evaluate(()=>({width:window.innerWidth,height:window.innerHeight}));
      expect(viewport.width).toBeGreaterThan(viewport.height);
      const point=value=>[String(Math.round(value[0]*width/viewport.width)),String(Math.round(value[1]*height/viewport.height))];
      if(gesture.type==='tap')await android('shell','input','tap',...point(gesture.point));
      else if(gesture.type==='drag')await android('shell','input','swipe',...point(gesture.from),...point(gesture.to),'350');
      else throw new Error('Unsupported test touch gesture');
    },
    onStep:progress,
    openGis:async()=>{
      if(values.platform==='windows'){await page.locator('#openGisBtn').click();await nativeDialog(fixture,'Open');}
      else await Promise.all([page.locator('#openGisBtn').click({timeout:120000}),openAndroidFile(basename(deviceInput))]);
    },
    saveReopen:async()=>{
      await openFileMenu(page);
      // A native modal can block WebView/CDP callbacks. Start the owned picker
      // helper while encoding/transfer runs; it waits for the actual dialog.
      if(values.platform==='windows'){await page.locator('#saveProjectBtn').click();await nativeDialog(saved,'Save');}
      else await Promise.all([page.locator('#saveProjectBtn').click({timeout:120000}),saveAndroidFile(fileName)]);
      await expect.poll(()=>page.evaluate(()=>window.__pluginDocument().state().dirty),{timeout:30000}).toBe(false);
      const writeResult=await page.evaluate(()=>window.__nativeWriteResult);
      expect(writeResult.cancelled).toBe(false);
      if(values.platform==='windows')expect(resolve(writeResult.path)).toBe(saved);
      await page.evaluate(()=>{window.__nativeReopened=false;window.addEventListener('pandolab:project-changed',event=>{if(event.detail?.reason==='project-load')window.__nativeReopened=true;});});
      await openFileMenu(page);
      if(values.platform==='windows'){await page.locator('#openProjectBtn').click();await nativeDialog(saved,'Open');}
      else await Promise.all([page.locator('#openProjectBtn').click({timeout:120000}),openAndroidFile(fileName)]);
      await expect.poll(()=>page.evaluate(()=>window.__nativeReopened),{timeout:30000}).toBe(true);
      if(values.platform==='android')await android('pull',deviceSaved,saved);
      const bytes=await readFile(saved);
      expect(bytes.subarray(0,16).toString()).toBe('SQLite format 3\u0000');
      return {path:saved,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    },
  });
  const commands=await page.evaluate(()=>window.__nativeCommands);
  for(const required of ['begin_document_read','read_document_chunk','begin_document_write','append_document_chunk','finish_document_write'])expect(commands).toContain(required);
  await writeFile(join(output,'native-'+values.platform+'.json'),JSON.stringify({platform,...result,nativeCommands:commands,consoleErrors:events},null,2));
  await page.screenshot({path:join(output,'native-'+values.platform+'.png'),timeout:15000});
  console.log(JSON.stringify({platform:values.platform,...result}));
} catch(error) {
  await writeFile(join(output,'native-'+values.platform+'-failed.json'),JSON.stringify({message:error.message,stack:error.stack,events},null,2));
  await page.screenshot({path:join(output,'native-'+values.platform+'-failed.png'),timeout:5000}).catch(()=>{});throw error;
} finally {await browser.close();}
