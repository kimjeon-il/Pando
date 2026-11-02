import {expect,test} from '@playwright/test';

test.use({viewport:{width:1440,height:900},trace:'off'});
test('public viewer opens the regenerated Korean timeline without errors',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?debug=1&demTerrain=raster');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  const lifetimes=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().timelineRecords.lifetimes
    .filter(row=>['KOR','PRK'].includes(row.entityId)).map(({entityId,validFrom,validTo})=>({entityId,validFrom,validTo})));
  expect(lifetimes).toEqual([{entityId:'KOR',validFrom:'1948-08-15',validTo:null},
    {entityId:'PRK',validFrom:'1948-09-09',validTo:null}]);
  expect(errors).toEqual([]);
});
