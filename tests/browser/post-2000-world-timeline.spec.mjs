import {expect,test} from '@playwright/test';
import {gotoEditor} from './helpers/editor-entry.mjs';

test.use({trace:'retain-on-failure',viewport:{width:1440,height:900}});

const scenarios=[
 {month:'2000-12',yes:['state:yugoslavia','state:untaet-east-timor','state:unmik-kosovo'],no:['TLS','KOS','SDS']},
 {month:'2002-12',yes:['state:yugoslavia','TLS','state:unmik-kosovo'],no:['state:untaet-east-timor','KOS']},
 {month:'2003-12',yes:['state:yugoslavia','TLS','state:unmik-kosovo'],no:['state:untaet-east-timor','SRB','MNE'],name:{id:'state:yugoslavia',expected:'세르비아 몬테네그로'}},
 {month:'2006-12',yes:['SRB','MNE','state:unmik-kosovo'],no:['state:yugoslavia','KOS']},
 {month:'2008-12',yes:['SRB','MNE','KOS'],no:['state:unmik-kosovo']},
 {month:'2011-12',yes:['SDN','SDS','TLS'],no:['state:yugoslavia']}
];

// Each reference year starts from a fresh editor document and browser context.
// A previous New Project dialog must not affect historical-source acceptance.
for(const {month,yes,no,name} of scenarios){
 test('year-end '+month+' renders the actual saved political territories',async ({page})=>{
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
  await page.waitForFunction(()=>window.__testEditorTimeline
   && !window.__testEditorTimeline.state().projectReplacing
   && !window.__testEditorTimeline.state().modeProcessing,null,{timeout:90000});
  for(const id of yes){
   await expect.poll(()=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id)?.geometry?.type||null,id),
    {timeout:90000,message:month+' missing '+id}).toMatch(/^(Polygon|MultiPolygon)$/);
  }
  const available=await page.evaluate(()=>Object.fromEntries(window.PANDOLAB_TERRITORIAL.list()
   .map(e=>[e.id,{name:e.properties.name,geometry:e.geometry?.type||null}])));
  for(const id of no)expect(available[id],month+' unexpectedly contains '+id).toBeUndefined();
  if(name){
   const details=await page.evaluate(id=>({
    timelineMonth:window.__testEditorTimeline?.month(),
    rawName:window.PANDOLAB_TERRITORIAL.get(id)?.properties?.name,
    nameSource:window.PANDOLAB_TERRITORIAL.get(id)?.properties?.metadata?.nameSource,
    nameDetails:window.PANDOLAB_TERRITORIAL.get(id)?.properties?.metadata?.nameDetails,
   }),name.id);
   console.log('VERIFIED_EDITOR_NAME='+JSON.stringify({month,id:name.id,...details}));
   expect(available[name.id]?.name,month+' date-selected country name').toBe(name.expected);
  }
  console.log('VERIFIED_EDITOR_YEAR='+JSON.stringify({month,checked:yes,visibleCountries:Object.keys(available).length}));
  expect(errors).toEqual([]);
 });
}
