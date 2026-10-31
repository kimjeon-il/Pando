import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const profiles=[
  {name:'desktop-light',viewport:{width:1280,height:800},theme:'light',reduced:false,reload:true},
  {name:'narrow-dark-reduced',viewport:{width:390,height:844},theme:'dark',reduced:true,reload:false},
];
async function gated(page){
  await page.addInitScript(()=>{window.__p1Hold=true;});
  await page.route('**/modules/viewer-map.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const anchor='prepareBuiltinProject:async(month,options)=>{';
    if(source.split(anchor).length!==2)throw Error('P1 candidate gate source changed');
    await route.fulfill({response,body:source.replace(anchor,anchor+
      'if(window.__p1Hold)await new Promise(resolve=>{window.__p1Release=resolve;});')});
  });
}
async function observe(page,profile,info,label){
  const preview=page.locator('#viewerInitialPreview'),status=page.locator('#viewerStatus');
  await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','true',{timeout:40000});
  await expect(preview).toBeVisible({timeout:90000});
  await expect(status).toHaveClass('ui-visually-hidden');
  await expect(status).toHaveAttribute('aria-live','polite');
  await expect.poll(()=>page.evaluate(()=>typeof window.__p1Release)).toBe('function');
  const state=await page.evaluate(()=>{
    const map=document.getElementById('map'),svg=document.getElementById('viewerInitialPreview');
    const land=svg.querySelector('.viewer-initial-preview-land'),ocean=svg.querySelector('.viewer-initial-preview-ocean');
    const a=map.getBoundingClientRect(),b=svg.getBoundingClientRect();
    return {ready:document.getElementById('viewerStatus').dataset.ready,
      landLength:land.getAttribute('d')?.length||0,oceanLength:ocean.getAttribute('d')?.length||0,
      color:land.getAttribute('fill'),theme:document.documentElement.dataset.theme,
      reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      animation:getComputedStyle(svg).animationName,
      pointerEvents:getComputedStyle(svg).pointerEvents,ariaHidden:svg.getAttribute('aria-hidden'),
      map:[a.x,a.y,a.width,a.height],preview:[b.x,b.y,b.width,b.height]};
  });
  expect(state.ready).toBe('false');expect(state.landLength).toBeGreaterThan(100);
  expect(state.oceanLength).toBeGreaterThan(0);expect(state.theme).toBe(profile.theme);
  expect(state.color).toBe(profile.theme==='light'?'#cccccc':'#63758a');
  expect(state.reduced).toBe(profile.reduced);expect(state.animation).toBe('none');
  expect(state.pointerEvents).toBe('none');expect(state.ariaHidden).toBe('true');
  for(let i=0;i<4;i++)expect(Math.abs(state.map[i]-state.preview[i])).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath(label+'-preview.png')});
  return state;
}
async function finish(page){
  await page.evaluate(()=>{window.__p1Hold=false;window.__p1Release();});
  await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','false',{timeout:100000});
  await expect(page.locator('#viewerInitialPreview')).toBeHidden();
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.initialMapPresented())).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount())).toBeGreaterThan(0);
}
for(const profile of profiles){
  test('P1-4 startup/reload and tab: '+profile.name,async({page},info)=>{
    test.setTimeout(240000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(profile.viewport);
    await page.emulateMedia({reducedMotion:profile.reduced?'reduce':'no-preference'});
    await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
    await page.addInitScript(theme=>localStorage.setItem('pandolab-user-preferences',
      JSON.stringify({version:2,appearance:{theme}})),profile.theme);
    await gated(page);
    await page.goto('/?debug=1');
    const first=await observe(page,profile,info,'initial');
    await finish(page);
    await page.screenshot({path:info.outputPath('complete.png')});
    await page.locator('#timelinePreviousYear').click();
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.builtinMonth().month),
      {timeout:95000}).toBe('2025-12');
    await expect(page.locator('#viewerInitialPreview')).toBeHidden();
    await page.evaluate(()=>{
      window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','false');
    await expect(page.locator('#viewerInitialPreview')).toBeHidden();
    if(profile.reload){
      await page.reload();
      const afterReload=await observe(page,profile,info,'reload');
      expect(afterReload.color).toBe(first.color);
      await finish(page);
    }
    writeFileSync(info.outputPath('p1-4.json'),JSON.stringify({profile,first,errors},null,2));
    expect(errors).toEqual([]);
  });
}
test('P1-4 ungated startup has no forced preview duration',async({page})=>{
  test.setTimeout(125000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.initialMapPresented())).toBe(true);
  await expect(page.locator('#viewerInitialPreview')).toBeHidden();
  await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','false');
  expect(errors).toEqual([]);
});
