import {expect,test} from '@playwright/test';

test.use({viewport:{width:1440,height:900},trace:'off'});
test('public Viewer opens pinned Korean map data without invalid historical records',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?debug=1&demTerrain=raster');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  const snapshot=await page.evaluate(async()=>{
    const viewer=window.__PANDOLAB_VIEWER__;
    const timeline=viewer.documentSnapshot().timelineRecords;
    const response=await fetch('assets/data/builtin-world/generated/v1/index.json');
    if(!response.ok)throw Error('Builtin country index is unavailable');
    const index=await response.json();
    return {month:viewer.builtinMonth().month, lifetimes:timeline.lifetimes
      .filter(row=>row.objectRef?.domain==='territorial'&&['KOR','PRK'].includes(row.objectRef.id))
      .map(({objectRef,validFrom,validTo})=>({entityId:objectRef.id,validFrom,validTo})),
    coverage:index.entities.filter(row=>['KOR','PRK'].includes(row.entityId))
      .map(({entityId,coverage})=>({entityId,coverage}))};
  });
  expect(snapshot.month).toMatch(/^\d{4}-\d{2}$/);
  expect(snapshot.lifetimes).toHaveLength(2);
  expect(snapshot.lifetimes).toEqual(expect.arrayContaining([
    {entityId:'KOR',validFrom:null,validTo:null},
    {entityId:'PRK',validFrom:null,validTo:null},
  ]));
  expect(snapshot.coverage).toHaveLength(2);
  expect(snapshot.coverage).toEqual(expect.arrayContaining([
    {entityId:'KOR',coverage:[{validFrom:'1948-08-15',validTo:null}]},
    {entityId:'PRK',coverage:[{validFrom:'1948-09-09',validTo:null}]},
  ]));
  expect(errors).toEqual([]);
});
