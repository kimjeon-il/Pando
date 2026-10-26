import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {gotoEditor} from './helpers/editor-entry.mjs';

test.use({viewport:{width:1440,height:900},trace:'off'});
const ids=['RUS','state:soviet-union-russian-sfsr','state:soviet-union'];
function record(snapshot){return snapshot.territorialEntities.filter(row=>ids.includes(row.id)).map(row=>({id:row.id,lifetime:row.properties.metadata.historicalTimeline.lifetime,version:row.properties.sourceGeometryVersion}));}

test('Web viewer changes Russia and its Soviet phase by their dates',async({page},info)=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date(1991,11,31,12));
 await page.goto('/?debug=1&demTerrain=raster');
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 const december=record(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot()));
 expect(december.some(row=>row.id==='RUS')).toBe(true);
 expect(december.some(row=>row.id==='state:soviet-union-russian-sfsr')).toBe(false);
 expect(december.find(row=>row.id==='RUS').lifetime.validFrom).toBe('1991-12-25');
 await page.locator('#timelineDateButton').click();await page.locator('#timelineViewUnit').selectOption('month');
 await page.locator('#timelineYearInput').fill('1991');await page.locator('#timelineMonthInput').selectOption('11');await page.locator('#timelineGoBtn').click();
 await expect(page.locator('#timelineDateButtonText')).toHaveText('1991년 11월',{timeout:45000});
 await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
 const november=record(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot()));
 expect(november.some(row=>row.id==='RUS')).toBe(false);
 expect(november.find(row=>row.id==='state:soviet-union-russian-sfsr').lifetime.validTo).toBe('1991-12-24');
 expect(november.some(row=>row.id==='state:soviet-union')).toBe(true);expect(errors).toEqual([]);
 writeFileSync(info.outputPath('period-proof.json'),JSON.stringify({december,november,errors},null,2));
 await page.screenshot({path:info.outputPath('soviet-november.png')});
});

test('App web shell loads the December1991 independent phase',async({page},info)=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date(1991,11,31,12));
 await gotoEditor(page,'/?debug=1&renderer=webgl2');
 await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:120000});
 const proof=await page.evaluate(()=>['RUS','state:soviet-union-russian-sfsr'].map(id=>{const row=window.PANDOLAB_TERRITORIAL.get(id);return {id,exists:Boolean(row),lifetime:row?.properties.metadata.historicalTimeline.lifetime,parentId:row?.properties.parentId,hasGeometry:Boolean(row?.geometry?.coordinates.length)};}));
 expect(proof[0].exists).toBe(true);expect(proof[0].lifetime.validFrom).toBe('1991-12-25');
 expect(proof[0].parentId).toBe('');expect(proof[0].hasGeometry).toBe(true);expect(proof[1].exists).toBe(false);expect(errors).toEqual([]);
 writeFileSync(info.outputPath('period-proof.json'),JSON.stringify({proof,errors},null,2));
 await page.screenshot({path:info.outputPath('independent-december.png')});
});
