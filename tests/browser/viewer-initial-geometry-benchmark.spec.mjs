import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
for(const profile of [{name:'desktop',width:1280,height:800,theme:'light'},{name:'narrow',width:390,height:844,theme:'dark'}]){
 test('P1-4b geometry comparison '+profile.name,async({page},info)=>{
  test.setTimeout(170000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setViewportSize({width:profile.width,height:profile.height});
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  await page.addInitScript(theme=>{localStorage.setItem('pandolab-user-preferences',JSON.stringify({version:2,appearance:{theme}}));window.__p1Hold=true;},profile.theme);
  await page.route('**/modules/viewer-map.js*',async route=>{
   const response=await route.fetch(),source=await response.text(),anchor='prepareBuiltinProject:async(month,options)=>{';
   if(source.split(anchor).length!==2)throw Error('P1 map candidate anchor changed');
   await route.fulfill({response,body:source.replace(anchor,anchor+'if(window.__p1Hold)await new Promise(resolve=>window.__p1Release=resolve);')});
  });
  await page.route('**/modules/viewer-initial-preview.js*',async route=>{
   const response=await route.fetch(),source=await response.text();
   const anchor="const ocean = frame.projectPath({type: 'Sphere'}), land = frame.projectPath(geometry);";
   if(source.split(anchor).length!==2)throw Error('P1 svg path anchor changed');
   const probe=[
    'const p1Start=performance.now();',anchor,'window.__p1SvgMs=performance.now()-p1Start;',
    'window.__p1Count=()=>{let polygons=0,rings=0,vertices=0;for(const poly of geometry.coordinates){polygons++;for(const ring of poly){rings++;vertices+=ring.length;}}return {polygons,rings,vertices};};',
    'window.__p1Canvas=()=>{',
    'if(typeof frame.createCanvasPath!=="function")throw Error("missing current Canvas projector");',
    'const ms=[],coverage=[];for(let k=0;k<3;k++){',
    'const t=performance.now(),canvas=document.createElement("canvas");',
    'canvas.width=frame.cssViewport[0];canvas.height=frame.cssViewport[1];',
    'const ctx=canvas.getContext("2d",{alpha:true}),path=frame.createCanvasPath(ctx);',
    'const zoom=Number(frame.globeZoom),scale=frame.projection==="globe"&&zoom>0?Math.max(1,1.25/zoom):1;',
    'const [x,y]=frame.cssTranslate;ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.translate(-x,-y);',
    'ctx.beginPath();path({type:"Sphere"});ctx.fillStyle=theme.ocean;ctx.fill();',
    'ctx.beginPath();path(geometry);ctx.globalAlpha=.45;ctx.fillStyle=theme.defaultLand;ctx.fill();ctx.restore();',
    'ms.push(performance.now()-t);',
    'const row=ctx.getImageData(0,Math.floor(canvas.height/2),canvas.width,1).data;',
    'let occupied=0;for(let j=3;j<row.length;j+=4)if(row[j]>0)occupied++;',
    'coverage.push(occupied);canvas.width=0;canvas.height=0;',
    '}return {ms,coverage,canvasDpr:1};};'
   ].join('\n');
   await route.fulfill({response,body:source.replace(anchor,probe)});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerInitialPreview')).toBeVisible({timeout:90000});
  await expect.poll(()=>page.evaluate(()=>typeof window.__p1Release)).toBe('function');
  await expect.poll(()=>page.evaluate(()=>typeof window.__p1Canvas)).toBe('function');
  const result=await page.evaluate(()=>{
   const svg=document.getElementById('viewerInitialPreview');
   return {geometry:window.__p1Count(),svg:{ms:window.__p1SvgMs,landPathChars:svg.querySelector('.viewer-initial-preview-land').getAttribute('d').length,
    sphereChars:svg.querySelector('.viewer-initial-preview-ocean').getAttribute('d').length},
    canvas:window.__p1Canvas()};
  });
  expect(result.svg.landPathChars).toBeGreaterThan(100000);
  expect(result.geometry.vertices).toBeGreaterThan(10000);
  expect(result.canvas.coverage.every(v=>v>0)).toBe(true);
  await page.evaluate(()=>{window.__p1Hold=false;window.__p1Release();});
  await expect(page.locator('#viewerInitialPreview')).toBeHidden({timeout:110000});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  const report={profile,...result,errors,limitations:['SVG measures projection and string creation, not compositor paint',
   'Canvas measures 3 detached Canvas2D draws at DPR 1, not verified pixel equivalence',
   'Main-thread CPU timing in headless Chromium only; source polygon retained unchanged']};
  writeFileSync(info.outputPath('p1-4b-report.json'),JSON.stringify(report,null,2));
  console.log('P1_4B '+JSON.stringify(report));
  expect(errors).toEqual([]);
 });
}
