import {expect,test} from '@playwright/test';
import {gotoEditor,setEditorMonth} from './helpers/editor-entry.mjs';

test.use({trace:'retain-on-failure',viewport:{width:1440,height:900}});
test('2000–2011 year-end map resolves the reused territorial geometry in the editor',async ({page})=>{
 test.setTimeout(240000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoEditor(page,'/?debug=1&renderer=canvas');
 await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:120000});
 for(const {month,yes,no} of [
  {month:'2000-12',yes:['state:yugoslavia','state:untaet-east-timor','state:unmik-kosovo'],no:['TLS','KOS','SDS']},
  {month:'2003-12',yes:['state:yugoslavia','TLS','state:unmik-kosovo'],no:['state:untaet-east-timor']},
  {month:'2006-12',yes:['SRB','MNE','state:unmik-kosovo'],no:['state:yugoslavia','KOS']},
  {month:'2008-12',yes:['SRB','MNE','KOS'],no:['state:unmik-kosovo']},
  {month:'2011-12',yes:['SDN','SDS','TLS'],no:['state:yugoslavia']}
 ]){
  await setEditorMonth(page,month);
  const available=await page.evaluate(()=>Object.fromEntries(window.PANDOLAB_TERRITORIAL.list()
   .map(e=>[e.id,{name:e.properties.name,geometry:e.geometry?.type||null}])));
  for(const id of yes){
   expect(available[id],month+' missing '+id).toBeTruthy();
   expect(['Polygon','MultiPolygon'],month+' wrong geometry for '+id).toContain(available[id].geometry);
  }
  for(const id of no)expect(available[id],month+' unexpected '+id).toBeUndefined();
  if(month==='2003-12')expect(available['state:yugoslavia'].name).toBe('세르비아 몬테네그로');
 }
 expect(errors).toEqual([]);
});
