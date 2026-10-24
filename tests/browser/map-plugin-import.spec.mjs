import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { gotoEditor } from './helpers/editor-entry.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { instrumentMapPlugin,verifyMapPluginFlow } from './helpers/map-plugin-flow.mjs';

test('plugin GeoJSON uses ordinary import, geometry editing, Undo/Redo and GeoPackage reopen',async({page})=>{
  test.setTimeout(120_000);
  const file=process.env.PANDOLAB_MAP_PLUGIN_GEOJSON || new URL('../fixtures/map-plugin/reviewed.geojson',import.meta.url);
  const collection=JSON.parse(await readFile(file,'utf8'));
  await instrumentMapPlugin(page);
  await page.addInitScript(saved=>{
    localStorage.setItem('pandolab-editor-project',JSON.stringify(saved));
    Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
  },staticAutosaveProject({genericFeatures:[]}));
  await gotoEditor(page,'/');
  await verifyMapPluginFlow(page,collection,{
    openGis:async()=>{
      const chooser=page.waitForEvent('filechooser');await page.locator('#openGisBtn').click();
      await (await chooser).setFiles({name:'map-plugin.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(collection))});
    },
    saveReopen:async()=>{
      const download=page.waitForEvent('download');await page.locator('#mobileFileBtn').click();await page.locator('#saveProjectBtn').click();
      const saved=await download;
      await page.locator('#projectFileInput').setInputFiles({name:saved.suggestedFilename(),mimeType:'application/geopackage+sqlite3',buffer:await readFile(await saved.path())});
      return {filename:saved.suggestedFilename()};
    },
  });
});
