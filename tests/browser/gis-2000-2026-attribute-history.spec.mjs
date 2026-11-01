import {expect,test} from '@playwright/test';
import {gotoEditor} from './helpers/editor-entry.mjs';

test.use({trace:'retain-on-failure',viewport:{width:1440,height:900}});
const cases=[
 {month:'2000-12',names:[
  {id:'BHR',common:'바레인',formal:'바레인국'},
  {id:'MKD',common:'마케도니아',formal:undefined}],
  flag:{id:'RWA',needle:'<svg ',mode:'embedded'}},
 {month:'2010-12',names:[
  {id:'BOL',common:'볼리비아',formal:'볼리비아 다민족국'},
  {id:'MMR',common:'미얀마',formal:'미얀마 연방공화국'}]},
 {month:'2024-12',names:[
  {id:'MKD',common:'북마케도니아',formal:'북마케도니아 공화국'},
  {id:'TUR',common:'튀르키예',formal:'튀르키예 공화국'}],
  flag:{id:'SYR',needle:'#CE1126',mode:'embedded'}},
 {month:'2026-06',names:[{id:'NRU',common:'나오에로',formal:'나오에로 공화국'}],
  flag:{id:'SYR',needle:'#CE1126',mode:'embedded'}},
];
for(const {month,names,flag} of cases){
 test('GIS name and flag at '+month+' load into the actual editor',async({page})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await gotoEditor(page,'/?debug=1&renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:120000});
  await page.locator('#mobileFileBtn').click();
  await page.locator('#newProjectBtn').click();
  await expect(page.locator('#projectSetupDialog')).toBeVisible();
  await page.locator('#projectSetupMonth').fill(month);
  await page.locator('#projectSetupSubmit').click();
  if(await page.locator('#confirmModal').isVisible())await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('#projectSetupDialog')).not.toBeVisible({timeout:90000});
  // The dialog can close before the C++ document's dated snapshot replaces
  // the earlier default world. A stable common name is not a load barrier.
  await expect.poll(()=>page.evaluate(()=>window.__testEditorTimeline?.month()||''),
   {timeout:90000,message:'Project did not adopt requested historical month'}).toBe(month);
  await page.waitForFunction(()=>window.__testEditorTimeline
   && !window.__testEditorTimeline.state().projectReplacing
   && !window.__testEditorTimeline.state().modeProcessing,null,{timeout:90000});
  for(const {id,common,formal} of names){
   await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id)?.properties?.name||'',id),{timeout:90000})
    .toBe(common);
   const details=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id)?.properties.metadata?.nameDetails?.ko||{},id);
   if(formal!==undefined)await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id)?.properties?.metadata?.nameDetails?.ko?.formal||'',id),
    {timeout:30000,message:month+' wrong formal name: '+id}).toBe(formal);
   console.log('VERIFIED_NAME_EDITION='+JSON.stringify({month,id,common,formal:details.formal||null}));
  }
  if(flag){
   const url=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id)?.properties.metadata?.flagDataUrl||'',flag.id);
   expect(url,month+' missing dated flag: '+flag.id).toMatch(/^data:image\/svg\+xml;base64,/);
   const document=Buffer.from(url.split(',')[1],'base64').toString('utf8');
   expect(document).toContain(flag.needle);
   console.log('VERIFIED_FLAG_EDITION='+JSON.stringify({month,id:flag.id,mode:flag.mode,bytes:document.length}));
  }
  expect(errors).toEqual([]);
 });
}
