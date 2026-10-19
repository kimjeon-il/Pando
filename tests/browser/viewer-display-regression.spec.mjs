import {test,expect} from '@playwright/test';

test('labels paint above land and camera motion reuses geometry centroids',async({page})=>{
 page.setDefaultTimeout(15000);
 await page.goto('/');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 await expect(page.locator('#zoomInBtn,#zoomOutBtn,.map-view-toolbar')).toHaveCount(0);
 const labelDistance=async()=>{
  const points=await Promise.all(['알제리','이집트'].map(name=>page.locator('#map .country-label').filter({hasText:new RegExp('^'+name+'$')}).evaluate(element=>{
   const matrix=element.parentElement.transform.baseVal.consolidate().matrix;return [matrix.e,matrix.f];
  })));
  return Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1]);
 };
 const initialDistance=await labelDistance();
 const mapBounds=await page.locator('#map').boundingBox();
 await page.mouse.move(mapBounds.x+mapBounds.width/2,mapBounds.y+mapBounds.height/2);
 const order=await page.evaluate(()=>{
  const canvas=document.getElementById('viewerCanvas'),labels=document.querySelector('#map .map-interaction-svg');
  const box=canvas.getBoundingClientRect();
  const original=[canvas.style.pointerEvents,labels.style.pointerEvents];
  try{canvas.style.pointerEvents=labels.style.pointerEvents='auto';return document.elementsFromPoint(box.x+box.width/2,box.y+box.height/2).filter(node=>node===canvas||node===labels).map(node=>node===labels?'interaction':node.id);}
  finally{[canvas.style.pointerEvents,labels.style.pointerEvents]=original;}
 });
 expect(order).toEqual(['interaction','viewerCanvas']);
 await page.evaluate(()=>{const original=window.d3.geo.centroid;window.__centroidCalls=0;window.d3.geo.centroid=(...args)=>{window.__centroidCalls++;return original(...args);};});
 await page.mouse.wheel(0,-200);
 await expect.poll(labelDistance).toBeGreaterThan(initialDistance);
 await page.waitForTimeout(500);
 await page.evaluate(()=>{window.__centroidCalls=0;});
 const zoomedDistance=await labelDistance();
 await page.mouse.wheel(0,200);
 await expect.poll(labelDistance).toBeLessThan(zoomedDistance);
 await page.waitForTimeout(500);
 expect(await page.evaluate(()=>window.__centroidCalls)).toBe(0);
 await page.locator('#resetViewBtn').click();
 await expect.poll(async()=>Math.abs(await labelDistance()-initialDistance)).toBeLessThan(0.01);
 await page.setViewportSize({width:640,height:360});
 await expect(page.locator('#zoomInBtn,#zoomOutBtn,.map-view-toolbar')).toHaveCount(0);
 await expect(page.locator('#resetViewBtn')).toBeVisible();
});

test('viewing preferences preview, cancel and persist without document changes',async({page},testInfo)=>{
 page.setDefaultTimeout(15000);
 await page.goto('/');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 const before=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
 await page.getByRole('button',{name:'설정',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'환경설정'})).toBeVisible();
 await page.getByRole('button',{name:'어두운 테마',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.getByRole('button',{name:'취소',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByRole('button',{name:'설정',exact:true}).click();
 await page.getByRole('button',{name:'어두운 테마',exact:true}).click();
 await page.getByRole('button',{name:'보라',exact:true}).click();
 await page.getByLabel('경계선 부드럽게', {exact:true}).uncheck();
 await page.getByLabel('하단 상태표시줄 표시', {exact:true}).uncheck();
 await page.getByRole('button',{name:'적용',exact:true}).click();
 await expect(page.locator('#mapBottomStatus')).toBeHidden();
 await expect(page.locator('html')).toHaveAttribute('data-smooth-lines','false');
 const after=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
 expect(after.checkpoint).toBe(before.checkpoint);expect(after.presentationCheckpoint).toBe(before.presentationCheckpoint);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pandolab-user-preferences')));
 expect(stored.appearance).toEqual({theme:'dark',accentPreset:'purple',statusBarVisible:false,smoothLines:false});
 await page.reload();
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 await expect(page.getByRole('button',{name:'설정',exact:true})).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.setViewportSize({width:640,height:360});
 await page.locator('#mobileMenuBtn').click();
 await page.locator('#mobilePreferencesBtn').click();
 const bounds=await page.locator('.preferences-card').boundingBox();expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(360);
 await expect(page.getByRole('button',{name:'적용',exact:true})).toBeInViewport();
 await page.screenshot({path:testInfo.outputPath('preferences-mobile.png')});
 await page.keyboard.press('Escape');
 await expect(page.locator('#preferencesModal')).toBeHidden();
});
