import {test,expect} from '@playwright/test';

test.use({viewport:{width:1280,height:800},trace:'off',
  launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
for(const renderer of ['webgl2','webgl1']){
 test('P3-3 restart never binds canonical mesh buffers from a retired '+renderer+' context',async({page},info)=>{
  test.setTimeout(150000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026,9,31,12));
  await page.route('**/modules/gpu-map-renderer.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const anchor='    async function initialize({ allowPreview = true, preview = null } = {}) {';
    if(source.split(anchor).length!==2)throw Error('P3-3 GPU source owner anchor changed');
    const observation=[
      '      globalThis.__p33Owner=Object.freeze({',
      '        restart:()=>initialize({allowPreview:false}),',
      '        snapshot:()=>{',
      "          const entry=meshVariants.get('canonical'), resources=entry?.resources;",
      '          const sameContext=entry?.dependencies?.context?.[0]===gl;',
      '          const current=!!gl&&!gl.isContextLost()&&isWebGlRenderer();',
      '          const valid=!!current&&!!resources&&sameContext',
      '            &&gl.isBuffer(resources.positionBuffer)',
      '            &&gl.isBuffer(resources.countryBuffer)',
      '            &&gl.isBuffer(resources.fillIndexBuffer)',
      '            &&(glVersion!==2||gl.isVertexArray(resources.fillVao));',
      '          const active=!!current&&positionBuffer===resources?.positionBuffer',
      '            &&countryBuffer===resources?.countryBuffer&&fillIndexBuffer===resources?.fillIndexBuffer;',
      '          return {rendererMode,projectGeneration,renderDeviceContextRevision,canonicalMeshReady,',
      '            variantCount:meshVariants.size,countryIds:entry?.countryIds.length||0,valid,active,',
      '            sameContext,projectRenderBlocked,',
      '            rebuilds:performanceMetrics.countryMeshRebuildCount||0,',
      '            reuses:performanceMetrics.countryMeshReuseCount||0,',
      '            resourcesBytes:resources?.byteLength||0};',
      '        }',
      '      });'
    ].join('\n');
    await route.fulfill({response,body:source.replace(anchor,anchor+'\n'+observation)});
  });
  await page.goto('/?debug=1&renderer='+renderer);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount()),{timeout:80000}).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>window.__p33Owner?.snapshot().valid),{timeout:30000}).toBe(true);
  const before=await page.evaluate(()=>window.__p33Owner.snapshot());
  expect(before.rendererMode).toBe(renderer);
  expect(before.active).toBe(true);
  const restarted=await page.evaluate(async()=>{
    const ok=await window.__p33Owner.restart();
    return {ok,after:window.__p33Owner.snapshot()};
  });
  console.log('P3_3_CONTEXT_RESTART '+JSON.stringify({renderer,before,restarted}));
  expect(restarted.ok).toBe(true);
  expect(restarted.after.renderDeviceContextRevision).toBeGreaterThan(before.renderDeviceContextRevision);
  expect(restarted.after.projectGeneration).toBe(before.projectGeneration);
  expect(restarted.after.sameContext).toBe(true);
  expect(restarted.after.valid,'Retired-context GL buffers cannot be rebound after renderer initialization').toBe(true);
  expect(restarted.after.active).toBe(true);
  expect(restarted.after.rebuilds).toBe(before.rebuilds);
  expect(restarted.after.variantCount).toBeLessThanOrEqual(2);
  expect(restarted.after.resourcesBytes).toBe(before.resourcesBytes);
  await page.screenshot({path:info.outputPath('reinitialized-'+renderer+'.png')});
  expect(errors).toEqual([]);
 });
}
