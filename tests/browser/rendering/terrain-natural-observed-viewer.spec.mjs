import {test,expect} from '@playwright/test';

// Focused observed-mask acceptance. The source is opt-in and never replaces the
// operational DEM or the PandoLab-library-data pin.
test.use({viewport:{width:1100,height:760},launchOptions:{args:process.platform==='win32'
  ? ['--use-angle=d3d11']
  : ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']}});
const IMMUTABLE_SOURCE='4c84e22ccdfa8549ed42f3c8080c3914aa9d05f8';
const IMMUTABLE_CATALOG='f7d6b6402f3a89fb8738bf6169aa7d7e553992f9';
const regions=[
  // 8x requests native LOD4 without unnecessarily selecting LOD5 over the
  // already-verified Himalayan sample. Greenland's 16x must admit LOD4
  // under the actual 64 MiB RGBA8 GPU footprint (the focused regression).
  {name:'himalaya',rotation:[-86,-28,0],zoom:8,tile:'4/15-3.webp',mask:'rgi7GlacierCount'},
  {name:'greenland',rotation:[44,-76,0],zoom:16,tile:'4/7-0.webp',mask:'polar'}
];
const selectedRegions=process.env.PANDO_GREENLAND_ONLY==='1'
  ? regions.filter(region=>region.name==='greenland') : regions;

async function changedPixels(page,before,after){
  return page.evaluate(async ({before,after})=>{
    const decode=async bytes=>{
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
      const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      return ctx.getImageData(0,0,c.width,c.height).data;
    };
    const a=await decode(before),b=await decode(after);
    if(a.length!==b.length)throw Error('Screenshot dimensions changed');
    let n=0;
    for(let i=0;i<a.length;i+=4){
      if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>8)n++;
    }
    return {pixels:n,compared:a.length/4};
  },{before:[...before],after:[...after]});
}

test('immutable observed WorldCover, mountain glacier and polar ice preview reaches actual WebGL Viewer',async({page},info)=>{
  test.setTimeout(400_000);
  const errors=[],records=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('pandolab-user-preferences',
    JSON.stringify({version:2,appearance:{mapStyle:'standard',theme:'light'}})));
  for(const region of selectedRegions){
    let release=()=>{},held=0;
    const gate=new Promise(resolve=>{release=resolve;});
    const urls=[];
    const handler=async route=>{
      urls.push(route.request().url());held++;
      await gate;
      if(!page.isClosed())await route.continue().catch(()=>{});
    };
    await page.route('**/terrain/natural/v0.1.0-preview.2/*/*.webp*',handler);
    try{
      // Test the actual globe tile admission; do not relax the required
      // native LOD4 or bypass the 64 MiB DEM + natural texture budget.
      await page.goto('/?debug=1&renderer=webgl2&naturalTerrain=observed',{waitUntil:'domcontentloaded'});
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:110000});
      await page.evaluate(region=>{
        const host=window.__PANDOLAB_MAP_HOST__,view=host.getViewState();
        host.setViewState({projection:'globe',view:{...view,globeRotation:region.rotation,
          globeZoom:region.zoom}});
        host.requestRepaint('observed-natural-region');
      },region);
      const stats=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats());
      const initial=await stats();
      console.log('OBSERVED_TARGET_INITIAL='+JSON.stringify({region:region.name,zoom:region.zoom,
        target:initial?.terrainTargetLevel,ready:initial?.terrainReady,
        admissionBytes:initial?.terrainAdmissionBytes,
        admissionReservedBytes:initial?.terrainAdmissionReserveBytes,
        admissionTotalBytes:initial?.terrainAdmissionTotalBytes,
        memoryBudgetBytes:initial?.terrainMemoryBudgetBytes,
        resolutionLimited:initial?.terrainResolutionLimited}));
      await expect.poll(async()=>{
        const s=await stats();return s?.terrainReady&&s?.terrainTargetLevel===4;
      },{timeout:120000}).toBe(true);
      await expect.poll(()=>held,{timeout:30000}).toBeGreaterThan(0);
      const beforeStats=await stats();
      expect(beforeStats.terrainReady).toBe(true);
      const before=await page.locator('canvas.gpu-map-canvas').first()
        .screenshot({path:info.outputPath(region.name+'-before-observed.png')});
      release();
      await expect.poll(async()=>Number((await stats())?.terrainNaturalTilesLoaded||0),
        {timeout:100000}).toBeGreaterThan(0);
      await page.waitForTimeout(400);
      const after=await page.locator('canvas.gpu-map-canvas').first()
        .screenshot({path:info.outputPath(region.name+'-after-observed.png')});
      const diff=await changedPixels(page,before,after);
      const final=await stats();
      expect(final.terrainNaturalSourceRevision).toBe(IMMUTABLE_SOURCE);
      expect(final.renderer).toBe('webgl2');
      expect(final.terrainReady).toBe(true);
      expect(final.terrainNaturalFailures).toBe(0);
      expect(final.terrainAdmissionBytesPerPixel).toBe(4);
      expect(final.terrainAdmissionTotalBytes).toBeLessThanOrEqual(final.terrainMemoryBudgetBytes);
      expect(final.terrainCacheBytes+final.terrainPendingDecodedBytes+final.terrainNaturalPendingBytes)
        .toBeLessThanOrEqual(final.terrainMemoryBudgetBytes);
      expect(urls.some(u=>u.includes('/'+IMMUTABLE_SOURCE+'/')&&u.endsWith('/'+region.tile))).toBe(true);
      expect(diff.pixels,'Natural tile must change the retained frame').toBeGreaterThan(100);
      records.push({region:region.name,sourceRevision:IMMUTABLE_SOURCE,requiredTile:region.tile,
        fetched:urls.length,changedPixels:diff.pixels,comparedPixels:diff.compared,
        targetLevel:final.terrainTargetLevel,admissionBytesPerPixel:final.terrainAdmissionBytesPerPixel,
        admissionTotalBytes:final.terrainAdmissionTotalBytes,
        memoryBudgetBytes:final.terrainMemoryBudgetBytes,terrainCacheBytes:final.terrainCacheBytes,
        naturalUploadedTiles:final.terrainNaturalTilesLoaded,sourceMask:region.mask});
      console.log('OBSERVED_NATURAL_VIEWER='+JSON.stringify(records.at(-1)));
    }finally{
      release();await page.unroute('**/terrain/natural/v0.1.0-preview.2/*/*.webp*',handler);
    }
  }
  expect(errors).toEqual([]);
  await info.attach('observed-source-and-pixels',{body:JSON.stringify({
    candidate:IMMUTABLE_CATALOG,source:IMMUTABLE_SOURCE,regions:records,
    screenshotComparison:'natural HTTP blocked until already-ready DEM; Chromium SwiftShader not physical GPU'},null,2),contentType:'application/json'});
});
