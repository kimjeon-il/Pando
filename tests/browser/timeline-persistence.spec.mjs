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

test('static v9 UI file save/open and full autosave restore metadata, records and complete archive',async({page})=>{
  const errors=await openApp(page);
  await openProject(page,fixturePath('static'));
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().length)).toBe(4);
  await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.setName('A','저장 검증'));
  await expect.poll(async()=> (await readAutosave(page))?.territorialEntities?.find(entity=>entity.id==='A')?.properties.name,{timeout:30000}).toBe('저장 검증');
  const saved=await readAutosave(page);
  expect(saved.format).toBe('pandolab-autosave-full');
  expect(saved.schemaVersion).toBe(9);
  expect(saved.territorialEntities.every(entity=>entity.geometry===null)).toBe(true);
  expect(saved.geometries).toEqual((await fixtureJson('static')).geometries);
  await page.locator('#undoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('A 영토');
  await page.locator('#redoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('저장 검증');
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

test('complex timeline file roundtrip preserves temporal meaning and UI rejection keeps session unchanged',async({page})=>{
  const errors=await openApp(page);
  await openProject(page,fixturePath('static'));
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A')?.properties.name)).toBe('A 영토');
  expect(await page.evaluate(()=>{
    const result=window.PANDOLAB_TERRITORIAL.setName('A','선택 유지');
    window.PANDOLAB_TERRITORIAL.select('A');
    return result.changed;
  })).toBe(true);
  await expect.poll(async()=> (await readAutosave(page))?.territorialEntities?.[0]?.properties.name,{timeout:30000}).toBe('선택 유지');
  const before=await readAutosave(page);
  const selection=await page.evaluate(()=>window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection);
  const undoDisabled=await page.locator('#undoBtn').isDisabled();
  const redoDisabled=await page.locator('#redoBtn').isDisabled();
  const status=await page.locator('#projectSaveStatus').getAttribute('data-tooltip');
  const complex=await fixtureJson('complex');
  const bytes=await page.evaluate(async project=>{
    const blob=await window.PandoLabGIS.exportGeoPackage(project);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  },complex);
  const read=await productionGeoPackage('read',new Uint8Array(bytes).buffer);
  expect(semantics(read.metadata.projectState)).toEqual(semantics(complex));
  await openProject(page,fixturePath('complex'));
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  await expect(page.locator('#actionStatus')).toContainText(/시간|정적|TIMELINE/,{timeout:30000});
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('선택 유지');
  expect(semantics(await readAutosave(page))).toEqual(semantics(before));
  expect(await page.evaluate(()=>window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.primaryKey)).toBe(selection.primaryKey);
  expect(await page.locator('#undoBtn').isDisabled()).toBe(undoDisabled);
  expect(await page.locator('#redoBtn').isDisabled()).toBe(redoDisabled);
  expect(await page.locator('#projectSaveStatus').getAttribute('data-tooltip')).toBe(status);
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('A 영토');
  expect(errors).toEqual([]);
});

test('builtin delta autosave includes archive and fingerprint and restores omitted identities',async({page})=>{
  const errors=await openApp(page);
  const before=await page.evaluate(()=>({count:window.PANDOLAB_TERRITORIAL.list().length,geometry:window.PANDOLAB_TERRITORIAL.get('IRL').geometry}));
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
  expect(errors).toEqual([]);
});
