import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
import {builtinProject} from '../helpers/builtin-world.mjs';
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { coreFileProjection, productionGeoPackage } from '../helpers/production-geopackage.mjs';
import { createInitialDocument } from "../../shared/frontend/js/modules/initial-document.js";
import { PROJECT_SCHEMA_VERSION } from "../../shared/frontend/js/modules/version-contract.js";

const fixturePath = kind => fileURLToPath(new URL(`../fixtures/timeline-exchange/${kind}.gpkg`, import.meta.url));
const fixtureJson = async kind => JSON.parse(await readFile(new URL(`../fixtures/timeline-exchange/${kind}.json`, import.meta.url),'utf8'));
test.use({ channel:'chromium', trace:'off', viewport:{width:1440,height:900} });
test.setTimeout(360000);
async function openApp(page) {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined}));
  await gotoEditor(page, '/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  await expect(page.locator('#actionStatus')).not.toHaveClass(/\bworking\b/,{timeout:90000});
  return errors;
}
async function openProject(page,path) {
  await page.locator('#mobileFileBtn').click();
  await page.evaluate(()=>{window.__testProjectOpened=false;window.addEventListener('pandolab:project-changed',event=>{if(event.detail.reason==='project-load')window.__testProjectOpened=true;},{once:true});});
  const chooser=page.waitForEvent('filechooser');
  await page.locator('#openProjectBtn').click();
  await (await chooser).setFiles({name:'project.gpkg',mimeType:'application/geopackage+sqlite3',buffer:await readFile(path)});
  await expect.poll(()=>page.evaluate(()=>window.__testProjectOpened),{timeout:90000}).toBe(true);
  await expect(page.locator('#actionStatus')).not.toHaveClass(/\bworking\b/,{timeout:90000});
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

test('current static UI file save/open and full autosave restore metadata, records and complete archive',async({page},info)=>{
  const {project:fixture,spatialState}=await coreFileProjection({
    ...createInitialDocument({appVersion:'0.36.0'}),...await fixtureJson('static'),
    projectSetup:{initialMonth:'2026-10',sourceMode:'empty',timelineRange:null,
      initialMapBounds:{west:-5,east:20,south:-5,north:20}},
  });
  const encoded=await productionGeoPackage('write',new ArrayBuffer(0),fixture,spatialState);
  const currentFixture=info.outputPath('current-static.gpkg');
  await writeFile(currentFixture,new Uint8Array(encoded.buffer));
  const errors=await openApp(page);
  await openProject(page,currentFixture);
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().length)).toBe(4);
  expect((await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.setName('A','저장 검증'))).ok).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('저장 검증');
  const hasNameEdit=project=>project?.territorialEntities?.some(row=>row.id==='A'&&row.properties.name==='저장 검증');
  await expect.poll(async()=>hasNameEdit(await readAutosave(page)),{timeout:120000}).toBe(true);
  const saved=await readAutosave(page);
  expect(saved.format).toBe('pandolab-autosave-full');
  expect(saved.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  expect(saved.territorialEntities.every(entity=>entity.geometry===null)).toBe(true);
  expect(saved.geometries).toEqual(fixture.geometries);
  await page.locator('#undoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('A 영토');
  await expect.poll(async()=>semantics(await readAutosave(page)),{timeout:30000}).toEqual(semantics(fixture));
  await page.locator('#redoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('A').properties.name)).toBe('저장 검증');
  await expect.poll(async()=>semantics(await readAutosave(page)),{timeout:30000}).toEqual(semantics(saved));
  const file=await downloadProject(page);
  expect(semantics(file.project)).toEqual(semantics(saved));
  await openProject(page,file.path);
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('B').properties.parentId)).toBe('A');
  await expect.poll(async()=>hasNameEdit(await readAutosave(page)),{timeout:30000}).toBe(true);
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
  await expect.poll(() => page.evaluate(() => window.__testEditorTimeline.month())).toBe('1916-01');
  const autosaveBefore = await readAutosave(page);
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('B').properties.parentId)).toBe('C');
  await setEditorMonth(page, '1914-07');
  await expect(page.locator('#editorTimelineContext')).toContainText('1914년 7월');
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('B').properties.parentId)).toBe('A');
  await setEditorMonth(page, '1914-06');
  await expect.poll(() => page.evaluate(() => window.__testEditorTimeline.month())).toBe('1914-06');
  expect(await readAutosave(page)).toEqual(autosaveBefore);
  expect(await page.locator('#undoBtn').isDisabled()).toBe(true);
  expect(errors).toEqual([]);
});

test('historical default full save and offline restore retain every identity and record',async({page})=>{
  const errors=await openApp(page);
  const before=await page.evaluate(()=>({count:window.PANDOLAB_TERRITORIAL.list().length,
    geometry:window.PANDOLAB_TERRITORIAL.get('IRL').geometry}));
  await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.setName('IRL','시간 저장 아일랜드'));
  await expect.poll(async()=> (await readAutosave(page))?.territorialEntities?.find(entity=>entity.id==='IRL')?.properties.name,{timeout:120000}).toBe('시간 저장 아일랜드');
  const saved=await readAutosave(page);
  expect(saved.format).toBe('pandolab-autosave-full');
  expect(saved.territorialEntities.length).toBe(builtinProject(new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')).territorialEntities.length);
  expect(saved.timelineRecords.lifetimes.length).toBeGreaterThan(before.count);
  expect(saved.geometries.length).toBeGreaterThanOrEqual(before.count);
  expect(saved.entityDelta).toBeUndefined();
  await page.locator('#undoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('IRL').properties.name)).not.toBe('시간 저장 아일랜드');
  await page.locator('#redoBtn').click();
  await expect.poll(async()=>semantics(await readAutosave(page)),{timeout:30000}).toEqual(semantics(saved));
  const file=await downloadProject(page);
  expect(semantics(file.project)).toEqual(semantics(saved));
  await openProject(page,file.path);
  await expect(page.locator('#gisImportModal')).toBeHidden({timeout:30000});
  await expect.poll(async()=>semantics(await readAutosave(page)),{timeout:30000}).toEqual(semantics(saved));
  await page.evaluate(async()=>{for(const key of await caches.keys())await caches.delete(key);});
  await page.route('**/historical-world/**',route=>route.abort());
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().length)).toBe(before.count);
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('IRL').geometry)).toEqual(before.geometry);
  expect(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.get('IRL').properties.name)).toBe('시간 저장 아일랜드');
  await setEditorMonth(page, '2012-10');
  expect(new Set(await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.list().map(row=>row.id)))).toEqual(new Set(['IDN','SDN','SDS','TLS','UKR','state:nagorno-karabakh']));
  expect(semantics(await readAutosave(page))).toEqual(semantics(saved));
  await expect(page.locator('#undoBtn')).toBeDisabled();
  expect(errors).toEqual([]);
});
