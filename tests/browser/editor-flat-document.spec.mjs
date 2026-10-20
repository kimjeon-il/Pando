import { test, expect } from '@playwright/test';
import { gotoEditor } from './helpers/editor-entry.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { readFile } from 'node:fs/promises';

test.use({ viewport: { width: 1440, height: 900 } });

test('flat editor creates and edits a label, undoes and redoes, then saves and reopens its GeoPackage', async ({ page }) => {
  test.setTimeout(120_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const project=staticAutosaveProject();
  await page.addInitScript(project=>{
    localStorage.setItem('pandolab-editor-project',JSON.stringify(project));
    Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
  },project);
  await page.route('**/modules/app-domain-assembly.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    await route.fulfill({response,body:source.replace('dependencies = ports;','dependencies = ports;window.__flatDocument=()=>projectDomain;')});
  });
  await gotoEditor(page,'/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness',/editable|enhanced/,{timeout:60_000});
  const count=await page.evaluate(()=>window.__flatDocument().snapshot().labels.length);
  await page.locator('#createMenuBtn').click();await page.locator('#addLabelBtn').click();
  const map=await page.locator('#map').boundingBox();
  page.once('dialog',dialog=>dialog.accept('평면 편집 시험'));
  await page.mouse.click(map.x+map.width*.55,map.y+map.height*.5);
  await expect(page.locator('#labelProperties')).toBeVisible();
  await page.locator('#labelNameInput').fill('수정한 지명');await page.locator('#labelNameInput').press('Tab');
  await expect.poll(()=>page.evaluate(()=>window.__flatDocument().snapshot().labels.at(-1)?.name)).toBe('수정한 지명');
  await page.locator('#undoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__flatDocument().snapshot().labels.at(-1)?.name)).toBe('평면 편집 시험');
  await page.locator('#redoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__flatDocument().snapshot().labels.at(-1)?.name)).toBe('수정한 지명');
  const before=await page.evaluate(()=>window.__flatDocument().snapshot());
  expect(before.labels.length).toBe(count+1);
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#mobileFileBtn').click();await page.locator('#saveProjectBtn').click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.gpkg$/);
  const path=await download.path();
  await page.evaluate(()=>{
    window.__flatProjectReopened=false;
    window.addEventListener('pandolab:project-changed',event=>{
      if(event.detail?.reason==='project-load')window.__flatProjectReopened=true;
    });
  });
  await page.locator('#projectFileInput').setInputFiles({name:download.suggestedFilename(),mimeType:'application/geopackage+sqlite3',buffer:await readFile(path)});
  await expect.poll(()=>page.evaluate(()=>window.__flatProjectReopened),{timeout:30_000}).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__flatDocument().state().dirty)).toBe(false);
  const after=await page.evaluate(()=>({project:window.__flatDocument().snapshot(),camera:window.__PANDOLAB_MAP_HOST__.getViewState()}));
  expect(after.project.documentId).toBe(before.documentId);
  expect(after.project.labels).toEqual(before.labels);
  expect(after.project.geometries).toEqual(before.geometries);
  expect(after.camera.projection).toBe('flat');
  expect(errors).toEqual([]);
});
