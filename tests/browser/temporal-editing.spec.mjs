import {expect,test} from '@playwright/test';
test.use({viewport:{width:1440,height:900},trace:'off'});

async function month(page,value,{ afterMutation = false } = {}) {
  await page.locator('#timelineMonthButton').click();
  const input = page.locator('#timelineMonthInput');
  await input.fill(value);
  await input.press('Enter');
  if (afterMutation) {
    // A large dated metadata commit can leave the editor processing while the
    // month field is already visible. Retry only a still-open valid request;
    // never treat a rejected/stale selection as a successful transition.
    await expect.poll(async () => {
      if (await input.isHidden()) return true;
      if (await input.getAttribute('aria-invalid') === 'true')
        throw new Error(await page.locator('#timelineMonthError').textContent() || 'Invalid timeline date');
      await input.press('Enter');
      return input.isHidden();
    }, { timeout: 60_000, intervals: [800, 1_500, 2_000] }).toBe(true);
  } else await expect(input).toBeHidden({ timeout: 30_000 });
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
  test.setTimeout(240000);const errors=[],diagnostics=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
  page.on('console',message=>{
    if(message.type()==='error'||message.type()==='warning') {
      if(message.type()==='error'||/disposed|Autosave .*failed|Immediate autosave failed/u.test(message.text()))diagnostics.push(message.text());
      if(message.type()==='warning')console.log(message.text());
    }
  });
  const startupFailure=new Promise((_,reject)=>{
    page.once('pageerror',reject);
    page.on('console',message=>{if(message.type()==='error') {
      console.error(message.text());if(message.text().startsWith('[PL-BOOT-001]'))reject(new Error(message.text()));
    }});
  });
  await page.goto('/?debug=1');
  await Promise.race([expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000}),startupFailure]);
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
  await page.locator('#undoBtn').click();await expect(page.locator('#redoBtn')).toBeEnabled({timeout:30000});
  await expect.poll(()=>object(page,added.id)).toBeNull();
  await page.locator('#redoBtn').click();await expect(page.locator('#undoBtn')).toBeEnabled({timeout:30000});
  await expect.poll(()=>object(page,added.id),{timeout:30000}).not.toBeNull();
  await month(page,'2011-01');expect(await object(page,added.id)).toBeNull();
  const preservedPast={...before,properties:{...before.properties,validTo:'2011-12'}};
  expect(await object(page,'UKR')).toEqual(preservedPast);
  await month(page,'2013-01');expect((await object(page,added.id)).geometry).toEqual(added.geometry);
  const future=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.setName(id,'Future USSR'),added.id);
  expect(future.ok).toBe(true);
  await expect.poll(async()=>(await object(page,added.id))?.properties.name).toBe('Future USSR');
  await month(page,'2012-01',{ afterMutation: true });
  const inserted=await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.setName(id,'Inserted USSR'),added.id);
  expect(inserted.ok).toBe(true);
  await expect.poll(async()=>(await object(page,added.id))?.properties.name).toBe('Inserted USSR');
  await month(page,'2013-01',{ afterMutation: true });expect((await object(page,added.id)).properties.name).toBe('Future USSR');
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
  await month(page,'2011-01');expect(await object(page,added.id)).toBeNull();expect(await object(page,'UKR')).toEqual(preservedPast);
  await info.attach('temporal-model-evidence',{body:JSON.stringify({id:added.id,sourceDate:'1991-01-01',version,records:saved.timelineRecords}),contentType:'application/json'});
  await page.goto('about:blank');
  expect(errors).toEqual([]);
  expect(diagnostics).toEqual([]);
});
