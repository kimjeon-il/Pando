import {test,expect} from '@playwright/test';

test('labels paint above land and camera motion reuses geometry centroids',async({page})=>{
 page.setDefaultTimeout(15000);
 await page.goto('/');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 const order=await page.evaluate(()=>{
  const canvas=document.getElementById('viewerCanvas'),labels=document.getElementById('viewerLabels');
  const box=canvas.getBoundingClientRect();
  const original=[canvas.style.pointerEvents,labels.style.pointerEvents];
  try{canvas.style.pointerEvents=labels.style.pointerEvents='auto';return document.elementsFromPoint(box.x+box.width/2,box.y+box.height/2).filter(node=>node===canvas||node===labels).map(node=>node.id);}
  finally{[canvas.style.pointerEvents,labels.style.pointerEvents]=original;}
 });
 expect(order).toEqual(['viewerLabels','viewerCanvas']);
 await page.evaluate(()=>{const original=d3.geo.centroid;window.__centroidCalls=0;d3.geo.centroid=(...args)=>{window.__centroidCalls++;return original(...args);};});
 await page.locator('#viewerZoomIn').click();
 await page.waitForTimeout(500);
 await page.evaluate(()=>{window.__centroidCalls=0;});
 await page.locator('#viewerZoomOut').click();
 await page.waitForTimeout(500);
 expect(await page.evaluate(()=>window.__centroidCalls)).toBe(0);
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
