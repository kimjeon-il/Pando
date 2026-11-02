import {expect,test} from '@playwright/test';

test.use({viewport:{width:1440,height:900},trace:'off'});
test('public Viewer opens pinned Korean map data without invalid historical records',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?debug=1&demTerrain=raster');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  const snapshot=await page.evaluate(()=>{
    const viewer=window.__PANDOLAB_VIEWER__;
    const timeline=viewer.documentSnapshot().timelineRecords;
    return {month:viewer.builtinMonth().month, lifetimes:timeline.lifetimes
      .filter(row=>['KOR','PRK'].includes(row.entityId))
      .map(({entityId,validFrom,validTo})=>({entityId,validFrom,validTo}))};
  });
  expect(snapshot.month).toMatch(/^\d{4}-\d{2}$/);
  const expectedStarts={KOR:'1948-08-15',PRK:'1948-09-09'};
  for(const record of snapshot.lifetimes) {
    expect(record.validFrom).toBe(expectedStarts[record.entityId]);
    expect(record.validTo).toBeNull();
  }
  expect(errors).toEqual([]);
});
