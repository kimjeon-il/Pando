import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gotoEditor } from './helpers/editor-entry.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { instrumentMapPlugin,verifyMapPluginFlow } from './helpers/map-plugin-flow.mjs';

test('plugin GeoJSON uses ordinary import, geometry editing, Undo/Redo and GeoPackage reopen',async({page})=>{
  test.setTimeout(120_000);
  const file=process.env.PANDOLAB_MAP_PLUGIN_GEOJSON || new URL('../fixtures/map-plugin/reviewed.geojson',import.meta.url);
  const inputBytes=await readFile(file),collection=JSON.parse(inputBytes);
  await instrumentMapPlugin(page);
  await page.addInitScript(saved=>{
    localStorage.setItem('pandolab-editor-project',JSON.stringify(saved));
    Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
  },staticAutosaveProject({genericFeatures:[]}));
  await gotoEditor(page,'/');
  const result=await verifyMapPluginFlow(page,collection,{
    openGis:async()=>{
      const chooser=page.waitForEvent('filechooser');await page.locator('#openGisBtn').click();
      await (await chooser).setFiles({name:'map-plugin.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(collection))});
    },
    saveReopen:async()=>{
      const download=page.waitForEvent('download');await page.locator('#mobileFileBtn').click();await page.locator('#saveProjectBtn').click();
      const saved=await download;
      const bytes=await readFile(await saved.path()),path=test.info().outputPath(saved.suggestedFilename());
      expect(bytes.subarray(0,16).toString()).toBe('SQLite format 3\u0000');
      await writeFile(path,bytes,{flag:'wx'});
      await page.locator('#projectFileInput').setInputFiles({name:saved.suggestedFilename(),mimeType:'application/geopackage+sqlite3',buffer:bytes});
      return {filename:saved.suggestedFilename(),path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    },
  });
  await writeFile(test.info().outputPath('map-plugin-flow.json'),JSON.stringify({inputSha256:createHash('sha256').update(inputBytes).digest('hex'),...result},null,2)+'\n',{flag:'wx'});
  await page.screenshot({path:test.info().outputPath('map-plugin-flow.png')});
});
