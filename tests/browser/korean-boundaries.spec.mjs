import {expect,test} from '@playwright/test';
import {verifyKoreanBoundaryWorkflow} from './helpers/korean-boundary-workflow.mjs';
import {writeFile} from 'node:fs/promises';

test.use({viewport:{width:1440,height:900},trace:'off'});
test('Korean lifetimes and exact historical library dates use the published geometry',async({page},info)=>{
  test.setTimeout(240000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/__editor/index.html?debug=1&demTerrain=raster');
  const result=await verifyKoreanBoundaryWorkflow(page,{screenshotPath:info.outputPath('korean-library.png')});
  expect(errors).toEqual([]);
  await writeFile(info.outputPath('korean-library.json'),JSON.stringify({...result,errors},null,2));
});

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
