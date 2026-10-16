import {expect,test} from '@playwright/test';

async function month(page,value) {
  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill(value);
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden();
}
const object=(page,id)=>page.evaluate(id=>window.PANDOLAB_TERRITORIAL.get(id),id);
async function autosave(page) {
  return page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('pandolab-editor',2);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{return await new Promise((resolve,reject)=>{const request=db.transaction('projects','readonly').objectStore('projects').get('active-project');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
    finally{db.close();}
  });
}
test('1991 library geometry is inserted into 2012 and preserves temporal edits, history and reopen month',async({page},info)=>{
  test.setTimeout(180000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  await month(page,'2011-01');const before=await object(page,'UKR');
  await month(page,'2012-01');
  await page.locator('#createMenuBtn').click();await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#territorialLibraryModal')).toBeVisible();
  await page.locator('#territorialLibraryReferenceDateInput').fill('1991-01-01');
  await page.locator('#territorialLibrarySearchInput').fill('USSR');
  await page.locator('[data-library-entity-id="state:soviet-union"]').click();
  await expect(page.locator('#territorialLibraryAddBtn')).toBeEnabled();
  const version=await page.locator('#territorialLibraryPreview [data-geometry-version-id]').getAttribute('data-geometry-version-id');
  await page.locator('#territorialLibraryAddBtn').click();
  await expect.poll(async()=>await page.locator('[data-library-impact]').count()||await page.locator('#territorialLibraryModal.hidden').count(),{timeout:60000}).toBeGreaterThan(0);
  if(await page.locator('[data-library-impact]').count())await page.locator('#territorialLibraryAddBtn').click();
  await expect(page.locator('#territorialLibraryModal')).toBeHidden({timeout:60000});
  const added=await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().find(row=>row.properties.sourceEntityId==='state:soviet-union'));
  expect(added.properties.validFrom).toBe('2012-01');expect(added.properties.sourceGeometryVersion).toBe(version);
  expect(added.properties.metadata.sourceReferenceDate).toBe('1991-01-01');
  await page.locator('#undoBtn').click();await expect.poll(()=>object(page,added.id)).toBeNull();
  await page.locator('#redoBtn').click();await expect.poll(()=>object(page,added.id)).not.toBeNull();
  await month(page,'2011-01');expect(await object(page,added.id)).toBeNull();expect(await object(page,'UKR')).toEqual(before);
  await month(page,'2013-01');expect((await object(page,added.id)).geometry).toEqual(added.geometry);
  await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.setName(id,'Future USSR'),added.id);
  await month(page,'2012-01');await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.setName(id,'Inserted USSR'),added.id);
  expect((await object(page,added.id)).properties.name).toBe('Inserted USSR');
  await month(page,'2013-01');expect((await object(page,added.id)).properties.name).toBe('Future USSR');
  await month(page,'2012-06');
  await expect.poll(async()=>{
    const saved=await autosave(page);
    return saved?.editorState?.lastViewedMonth==='2012-06'&&saved.timelineRecords.propertyBindings.some(row=>row.entityId===added.id&&row.value.name==='Inserted USSR');
  },{timeout:30000}).toBe(true);
  const saved=await autosave(page);
  await page.reload();await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  await expect(page.locator('#timelineMonthInput')).toHaveValue('2012-06');
  expect((await object(page,added.id)).properties.name).toBe('Inserted USSR');
  await month(page,'2013-01');expect((await object(page,added.id)).properties.name).toBe('Future USSR');
  await month(page,'2011-01');expect(await object(page,added.id)).toBeNull();expect(await object(page,'UKR')).toEqual(before);
  await info.attach('temporal-model-evidence',{body:JSON.stringify({id:added.id,sourceDate:'1991-01-01',version,records:saved.timelineRecords}),contentType:'application/json'});
  expect(errors).toEqual([]);
});
