import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync} from 'node:fs';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');
const file=base+'/input-responsiveness.json';if(existsSync(file))throw Error('Preserve existing evidence');
const rows=[];
for(const [condition,port] of [['A',4211],['B',4212],['A2',4213]])for(let i=0;i<3;i++){
 const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});let row={condition,i,status:'pending'};
 try{
  const cdp=await browser.newBrowserCDPSession(),gpu=(await cdp.send('SystemInfo.getInfo')).gpu;
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,timezoneId:'Asia/Seoul',locale:'ko-KR'});
  await context.addInitScript(()=>{globalThis.__w4Input=[];addEventListener('pointerdown',e=>{if(e.clientX===700&&e.clientY===20)__w4Input.push({latency:performance.now()-e.timeStamp,at:performance.now()});},{capture:true});});
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${port}/?debug=1&renderer=webgl2`,{waitUntil:'domcontentloaded'});await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:150000});
  const identity=await page.evaluate(()=>{const gl=document.querySelector('#viewerCanvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL),build:PANDOLAB_BUILD_META};});
  if(browser.version()!=='151.0.7922.34'||gpu.featureStatus.gpu_compositing!=='enabled'||!gpu.devices.some(d=>d.deviceString==='NVIDIA GeForce GTX 1650'&&d.driverVersion==='32.0.16.1088')||!/NVIDIA.*Direct3D11/.test(identity.renderer)||identity.build.sourceCommit!=='fe8282ba32761ab9586348d1712e11cc1f4e7882'||identity.build.dataRevision!=='data-f50b7f480c812df6f5ea0c40f5461ab0')throw Error('GPU identity mismatch');
  await page.evaluate(()=>performance.clearMarks());await page.locator('#timelinePreviousYear').click();
  await page.waitForFunction(()=>performance.getEntriesByType('mark').some(e=>e.name.includes('"stage":"upload-step"')&&e.name.includes(':stroke-prepared"'))||document.querySelector('#viewerStatus').dataset.ready==='true',{timeout:120000});
  let forced=false;if(!await page.evaluate(()=>performance.getEntriesByType('mark').some(e=>e.name.includes('"stage":"upload-step"')&&e.name.includes(':stroke-prepared"')))){forced=true;await page.evaluate(()=>__W3_FORCE());}
  await expect.poll(()=>page.evaluate(()=>performance.getEntriesByType('mark').some(e=>e.name.includes('"stage":"upload-step"')&&e.name.includes(':stroke-prepared"'))),{timeout:120000}).toBe(true);
  for(let j=0;j<12;j++){await page.mouse.click(700,20);await page.waitForTimeout(25);}
  await expect.poll(()=>page.evaluate(()=>({month:__PANDOLAB_VIEWER__.builtinMonth().month,ready:document.querySelector('#viewerStatus').dataset.ready})),{timeout:120000}).toEqual({month:'2025-12',ready:'true'});
  row={condition,i,status:'passed',forced,browser:browser.version(),identity,events:await page.evaluate(()=>__w4Input)};
 }catch(e){row.status='failed';row.failure=String(e.stack||e);}finally{await browser.close();rows.push(row);console.log('W4_INPUT',condition,i,row.status);}
}
writeFileSync(file,JSON.stringify({rows},null,2),{flag:'wx'});if(rows.some(r=>r.status!=='passed'))process.exitCode=1;
