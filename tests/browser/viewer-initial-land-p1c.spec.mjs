import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';

for(const profile of [
 {name:'desktop-light',width:1280,height:800,theme:'light'},
 {name:'narrow-dark',width:390,height:844,theme:'dark'}
]){
 test('P1-4c simplified coast matches pinned source pixels: '+profile.name,async({page},info)=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:profile.width,height:profile.height});
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  await page.addInitScript(theme=>{
   localStorage.setItem('pandolab-user-preferences',JSON.stringify({version:2,appearance:{theme}}));
   window.__p1cHold=true;
  },profile.theme);
  await page.route('**/modules/viewer-map.js*',async route=>{
   const response=await route.fetch(),source=await response.text();
   const anchor='prepareBuiltinProject:async(month,options)=>{';
   if(source.split(anchor).length!==2)throw Error('P1-4c candidate hold anchor changed');
   await route.fulfill({response,body:source.replace(anchor,
     anchor+'if(window.__p1cHold)await new Promise(resolve=>window.__p1cRelease=resolve);')});
  });
  await page.route('**/modules/viewer-initial-preview.js*',async route=>{
   const response=await route.fetch(),source=await response.text(),anchor='geometry = result.geometry;';
   if(source.split(anchor).length!==2)throw Error('P1-4c preview module anchor changed');
   await route.fulfill({response,body:source.replace(anchor,anchor+
    'window.__p1cFrame=()=>lastFrame;window.__p1cGeometry=()=>geometry;')});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerInitialPreview')).toBeVisible({timeout:95000});
  await expect.poll(()=>page.evaluate(()=>typeof window.__p1cFrame)).toBe('function');
  const proof=await page.evaluate(async()=>{
   const meta=window.PANDOLAB_BUILD_META,frame=window.__p1cFrame(),preview=window.__p1cGeometry();
   const land=document.querySelector('.viewer-initial-preview-land');
   const response=await fetch('/'+meta.physicalLand.url);
   if(!response.ok)throw Error('Canonical land fetch failed: '+response.status);
   const bytes=await response.arrayBuffer();
   const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
   const original=JSON.parse(new TextDecoder().decode(raw));
   const [width,height]=frame.cssViewport;
   const rasterize=pathString=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#000';ctx.fill(new Path2D(pathString));
    const pixels=ctx.getImageData(0,0,width,height).data;
    const mask=new Uint8Array(width*height);
    for(let i=0;i<mask.length;i++)mask[i]=pixels[i*4+3]>64?1:0;
    canvas.width=0;canvas.height=0;
    return mask;
   };
   const ref=rasterize(frame.projectPath(original)),candidate=rasterize(land.getAttribute('d'));
   let overlap=0,refPixels=0,changed=0,union=0;
   for(let i=0;i<ref.length;i++){
    if(ref[i])refPixels++;
    if(ref[i]&&candidate[i])overlap++;
    if(ref[i]!==candidate[i])changed++;
    if(ref[i]||candidate[i])union++;
   }
   return{sourceSha:meta.physicalLand.sha256,derivativeSourceSha:meta.initialLandPreview.sourceSha256,
    compressedOriginalBytes:meta.physicalLand.compressedBytes,compressedPreviewBytes:meta.initialLandPreview.compressedBytes,
    originalPoints:meta.initialLandPreview.sourceCoordinateCount,previewPoints:meta.initialLandPreview.coordinateCount,
    previewPathLength:land.getAttribute('d').length,polygonCount:original.coordinates.length,
    previewPolygonCount:preview.coordinates.length,
    sameHoleCounts:original.coordinates.every((p,i)=>p.length===preview.coordinates[i]?.length),
    screen:{width,height,referenceLandPixels:refPixels,overlapPixels:overlap,
      differingPixels:changed,unionPixels:union,changedOverLand:changed/Math.max(1,refPixels),
      intersectionOverUnion:overlap/Math.max(1,union)}};
  });
  expect(proof.sourceSha).toBe(proof.derivativeSourceSha);
  expect(proof.previewPolygonCount).toBe(proof.polygonCount);
  expect(proof.sameHoleCounts).toBe(true);
  expect(proof.previewPoints/proof.originalPoints).toBeLessThan(0.18);
  expect(proof.compressedPreviewBytes/proof.compressedOriginalBytes).toBeLessThan(0.3);
  expect(proof.previewPathLength).toBeLessThan(2800000);
  expect(proof.screen.referenceLandPixels).toBeGreaterThan(10000);
  expect(proof.screen.changedOverLand).toBeLessThan(0.055);
  await page.screenshot({path:info.outputPath('initial-lightweight.png')});
  await page.evaluate(()=>{window.__p1cHold=false;window.__p1cRelease();});
  await expect(page.locator('#viewerInitialPreview')).toBeHidden({timeout:100000});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  console.log('P1_4C_SCREEN '+JSON.stringify({profile:profile.name,...proof}));
  writeFileSync(info.outputPath('coast-pixel-comparison.json'),JSON.stringify({profile,proof,errors},null,2));
  expect(errors).toEqual([]);
 });
}
