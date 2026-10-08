import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { productionGeoPackage } from '../helpers/production-geopackage.mjs';

const fixturePath = kind => fileURLToPath(new URL(`../fixtures/timeline-exchange/${kind}.gpkg`, import.meta.url));
const fixtureJson = async kind => JSON.parse(await readFile(new URL(`../fixtures/timeline-exchange/${kind}.json`, import.meta.url),'utf8'));
test.use({ channel:'chromium', trace:'off', viewport:{width:1440,height:900} });
test.setTimeout(360000);
async function openApp(page) {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined}));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  return errors;
}
async function openProject(page,path) {
  await page.locator('#mobileFileBtn').click();
  const chooser=page.waitForEvent('filechooser');
  await page.locator('#openProjectBtn').click();
  await (await chooser).setFiles({name:'project.gpkg',mimeType:'application/geopackage+sqlite3',buffer:await readFile(path)});
  await expect(page.locator('#gisImportTitle')).toHaveText('프로젝트 불러오기',{timeout:30000});
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/,{timeout:30000});
  await expect(page.locator('#gisImportError')).toBeEmpty();
  await expect(page.locator('#gisImportConfirmBtn')).toBeVisible({timeout:15000});
  await page.locator('#gisImportConfirmBtn').click();
}
async function readAutosave(page) {
  return page.evaluate(async()=>{
    const database=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('pandolab-editor',2); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
    });
    try { return await new Promise((resolve,reject)=>{
      const request=database.transaction('projects','readonly').objectStore('projects').get('active-project');
      request.onsuccess=()=>resolve(request.result||null); request.onerror=()=>reject(request.error);
    }); } finally { database.close(); }
  });
}
async function downloadProject(page) {
  await page.locator('#mobileFileBtn').click();
  const download=page.waitForEvent('download',{timeout:120000});
  await page.locator('#saveProjectBtn').click();
  const path=await (await download).path();
  const buffer=await readFile(path);
  const read=await productionGeoPackage('read',buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
  return {path, project:read.metadata.projectState};
}
const semantics = project => ({entities:project.territorialEntities,records:project.timelineRecords,geometries:project.geometries});

test('static v10 UI file save/open and full autosave restore metadata, records and complete archive',async({page})=>{
  const errors=await openApp(page);
  await openProject(page,fixturePath('static'));
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().length)).toBe(4);
  await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.setName('A','저장 검증'));
  await expect.poll(async()=> (await readAutosave(page))?.territorialEntities?.find(entity=>entity.id==='A')?.properties.name,{timeout:30000}).toBe('저장 검증');
  const saved=await readAutosave(page);
  expect(saved.format).toBe('pandolab-autosave-full');
  expect(saved.schemaVersion).toBe(10);
  expect(saved.territorialEntities.every(entity=>entity.geometry===null)).toBe(true);
  expect(saved.geometries).toEqual((await fixtureJson('static')).geometries);
  await page.locator('#undoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('A 영토');
  await expect.poll(async()=>semantics(await readAutosave(page)),{timeout:30000}).toEqual(semantics(await fixtureJson('static')));
  await page.locator('#redoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('저장 검증');
  await expect.poll(async()=>semantics(await readAutosave(page)),{timeout:30000}).toEqual(semantics(saved));
  const file=await downloadProject(page);
  expect(semantics(file.project)).toEqual(semantics(saved));
  await openProject(page,file.path);
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('B').properties.parentId)).toBe('A');
  await expect.poll(async()=> (await readAutosave(page))?.territorialEntities?.find(entity=>entity.id==='A')?.properties.name,{timeout:30000}).toBe('저장 검증');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.metadata.capital)).toBe('서울');
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('저장 검증');
  expect(errors).toEqual([]);
});

test('complex timeline file opens and month controls resolve its historical world',async({page})=>{
  const errors=await openApp(page);
  await openProject(page,fixturePath('static'));
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  await openProject(page,fixturePath('complex'));
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  await expect(page.locator('#timelineMonthInput')).toHaveValue('1916-01');
  const autosaveBefore = await readAutosave(page);
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('B').properties.parentId)).toBe('C');
  await page.locator('#timelineMonthInput').fill('1914-07');
  await page.locator('#timelineMonthInput').dispatchEvent('change');
  await expect(page.locator('#timelineMonthLabel')).toHaveText('1914년 7월');
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('B').properties.parentId)).toBe('A');
  await page.locator('#timelinePreviousMonth').click();
  await expect(page.locator('#timelineMonthInput')).toHaveValue('1914-06');
  expect(await readAutosave(page)).toEqual(autosaveBefore);
  expect(await page.locator('#undoBtn').isDisabled()).toBe(true);
  expect(errors).toEqual([]);
});

test('builtin delta autosave includes archive and fingerprint and restores omitted identities',async({page})=>{
  const errors=await openApp(page);
  const before=await page.evaluate(()=>({count:window.PANDOLAB_TERRITORIAL.list().length,
    name:window.PANDOLAB_TERRITORIAL.get('IRL').properties.name,geometry:window.PANDOLAB_TERRITORIAL.get('IRL').geometry}));
  await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.setName('IRL','시간 저장 아일랜드'));
  await expect.poll(async()=> (await readAutosave(page))?.entityDelta?.changed?.find(entity=>entity.id==='IRL')?.properties.name,{timeout:30000}).toBe('시간 저장 아일랜드');
  const saved=await readAutosave(page);
  expect(saved.format).toBe('pandolab-autosave-delta');
  expect(saved.baseDatasetFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(saved.timelineRecords.lifetimes.length).toBe(before.count);
  expect(saved.geometries.length).toBeGreaterThanOrEqual(before.count);
  expect(saved.entityDelta.changed.length).toBeLessThan(before.count);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().length)).toBe(before.count);
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('IRL').geometry)).toEqual(before.geometry);
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('IRL').properties.name)).toBe('시간 저장 아일랜드');
  await expect(page.locator('#projectSaveStatus')).not.toHaveAttribute('data-save-state','saving',{timeout:30000});
  // Seed after leaving the editor: its beforeunload flush legitimately rewrites a live save.
  await page.goto('/assets/css/app.css');
  await page.evaluate(async()=>{
    const database=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('pandolab-editor',2);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    try { await new Promise((resolve,reject)=>{
      const transaction=database.transaction('projects','readwrite'),store=transaction.objectStore('projects');
      const request=store.get('active-project');
      request.onsuccess=()=>{const project=request.result;project.baseDatasetFingerprint='0'.repeat(64);store.put(project,'active-project');};
      transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
    }); } finally {database.close();}
  });
  const invalidSave=await readAutosave(page);
  expect(invalidSave.baseDatasetFingerprint).toBe('0'.repeat(64));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('IRL').properties.name)).toBe(before.name);
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('IRL').geometry)).toEqual(before.geometry);
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().length)).toBe(before.count);
  expect(await readAutosave(page)).toEqual(invalidSave);
  expect(await page.locator('#undoBtn').isDisabled()).toBe(true);
  expect(await page.locator('#redoBtn').isDisabled()).toBe(true);
  expect(errors).toEqual([]);
});
