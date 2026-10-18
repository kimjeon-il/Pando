import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';

// CI screenshots document browser/viewport output, not physical GPU/mobile devices.
test.use({
  launchOptions: { args: [
    '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox'
  ] },
  trace: 'off',
  screenshot: 'only-on-failure',
});
for(const config of [
  {label:'desktop',width:1280,height:800,mobile:false,renderer:'webgl2'},
  {label:'mobile-emulation',width:390,height:844,mobile:true,renderer:'canvas'},
]) {
  test(config.label+' loads real map and captures screenshot',async({browser},testInfo)=>{
    test.setTimeout(150_000);
    const ctx=await browser.newContext({
      viewport:{width:config.width,height:config.height},
      deviceScaleFactor:config.mobile?2:1,
      isMobile:config.mobile,
      hasTouch:config.mobile,
    });
    const page=await ctx.newPage(),runtimeErrors=[];
    page.on('pageerror',err=>runtimeErrors.push(err.message));
    let ready=false;
    try {
      await gotoEditor(page, '/?renderer='+config.renderer+'&demTerrain=raster',
        {waitUntil:'domcontentloaded',timeout:30_000});
      const app=page.locator('#app');
      await expect(app).toHaveAttribute('data-readiness',/^(preview|editable|enhanced)$/,
        {timeout:110_000});
      if(process.env.PANDO_P9_ACCEPTANCE==='true') {
        await page.waitForFunction(()=>/^(enhanced|error)$/.test(document.getElementById('app')?.dataset.readiness||''),undefined,{timeout:110_000});
        await testInfo.attach('p9-startup-errors.json',{
          body:Buffer.from(JSON.stringify({runtimeErrors,readiness:await app.getAttribute('data-readiness')},null,2)),contentType:'application/json'});
        await expect(app).toHaveAttribute('data-readiness','enhanced',{timeout:1000});
      }
      await expect(page.locator('#map')).toBeVisible();
      const mapBounds=await page.locator('#map').boundingBox();
      expect(mapBounds.width).toBeGreaterThan(80);
      expect(mapBounds.height).toBeGreaterThan(80);
      ready=true;
      const diagnostic=await page.evaluate(()=>({
        readiness:document.getElementById('app')?.dataset.readiness,
        renderer:globalThis.__PANDOLAB_GPU_METRICS__?.renderer??null,
        previewMs:globalThis.__PANDOLAB_STARTUP_METRICS__?.previewDisplayMs??null,
        mapCanvasCount:document.querySelectorAll('#map canvas').length,
        documentTitle:document.title
      }));
      await testInfo.attach('p3-'+config.label+'-runtime.json',{
        body:Buffer.from(JSON.stringify({branch:process.env.PANDO_P3_BRANCH||'unknown',
          sha:process.env.GITHUB_SHA||'local',viewport:config,diagnostic,
          runtimeErrors},null,2)),contentType:'application/json'});
      expect(diagnostic.documentTitle).toBeTruthy();
      expect(runtimeErrors).toEqual([]);
    } finally {
      if(!page.isClosed()) {
        const file=testInfo.outputPath('p3-'+config.label+'-map.png');
        try{
          await page.screenshot({path:file,fullPage:false,animations:'disabled',timeout:20_000});
          await testInfo.attach('p3-'+config.label+'-screenshot',{
            path:file,contentType:'image/png'});
        }catch(e){
          // Never turn an earlier map failure into a false successful screenshot.
          if(ready)throw e;
        }
      }
      await ctx.close();
    }
  });
}
