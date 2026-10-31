import {expect,test} from '@playwright/test';
import {gotoEditor} from './helpers/editor-entry.mjs';

test.use({trace:'retain-on-failure',viewport:{width:1440,height:900}});
const cases=[
 {month:'2000-12',names:[{id:'CZE',ko:'체코',en:'Czech Republic',formal:'체코 공화국'}],
  flag:{id:'LSO',mode:'embedded'}},
 {month:'2011-12',names:[],flag:{id:'MWI',mode:'embedded'}},
 {month:'2013-12',names:[
  {id:'SOM',ko:'소말리아',formal:'소말리아 연방공화국'},
  {id:'CPV',ko:'카보베르데',en:'Cabo Verde',formal:'카보베르데 공화국'}]},
 {month:'2024-12',names:[{id:'CZE',ko:'체코',en:'Czechia',formal:'체코 공화국'}],
  flag:{id:'KGZ',mode:'default'}},
];
for(const {month,names,flag} of cases){
 test('additional name and flag history at '+month+' is reflected in the real editor',async({page})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await gotoEditor(page,'/?debug=1&renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:120000});
  await page.locator('#mobileFileBtn').click();await page.locator('#newProjectBtn').click();
  await expect(page.locator('#projectSetupDialog')).toBeVisible();
  await page.locator('#projectSetupMonth').fill(month);
  await page.locator('#projectSetupSubmit').click();
  if(await page.locator('#confirmModal').isVisible())await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('#projectSetupDialog')).not.toBeVisible({timeout:90000});
  await expect.poll(()=>page.evaluate(()=>window.__testEditorTimeline?.month()||''),{timeout:90000}).toBe(month);
  await page.waitForFunction(()=>window.__testEditorTimeline
   && !window.__testEditorTimeline.state().projectReplacing
   && !window.__testEditorTimeline.state().modeProcessing,null,{timeout:90000});
  for(const n of names){
   const row=await page.evaluate(id=>{
    const x=window.PANDOLAB_TERRITORIAL.get(id);
    return {name:x?.properties?.name,details:x?.properties?.metadata?.nameDetails};
   },n.id);
   expect(row.name,month+' common '+n.id).toBe(n.ko);
   expect(row.details?.ko?.formal,month+' formal '+n.id).toBe(n.formal);
   if(n.en)expect(row.details?.en?.common,month+' English short '+n.id).toBe(n.en);
   console.log('VERIFIED_ADDITIONAL_NAME='+JSON.stringify({month,...n}));
  }
  if(flag){
   const value=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id)?.properties?.metadata?.flagDataUrl||'',flag.id);
   if(flag.mode==='embedded')expect(value,month+' old flag '+flag.id).toMatch(/^data:image\/svg\+xml;base64,/);
   else expect(value,month+' restored/current flag '+flag.id).not.toMatch(/^data:image\/svg\+xml;base64,/);
   console.log('VERIFIED_ADDITIONAL_FLAG='+JSON.stringify({month,id:flag.id,mode:flag.mode,length:value.length}));
  }
  expect(errors).toEqual([]);
 });
}
