import {test,expect} from '@playwright/test';
import {staticAutosaveProject} from '../helpers/timeline-project.mjs';
import {createTerritorialFeature} from '../../shared/frontend/js/modules/territorial-units.js';
import {setEditorMonth} from './helpers/editor-entry.mjs';

const appShell=process.env.PANDOLAB_NAMES_APP_SHELL==='1';
test(`temporal country names edit, undo, save and reopen in ${appShell?'app shell':'web editor'}`,async({page},info)=>{
  test.setTimeout(120000);await page.setViewportSize({width:1440,height:900});
  const shape={type:'Polygon',coordinates:[[[0,0],[6,0],[6,6],[0,6],[0,0]]]};
  const seed=structuredClone(staticAutosaveProject({},[createTerritorialFeature({id:'name-test',entityKind:'general',name:'기본 이름',geometry:shape})]));
  const details=common=>({ko:{common,formal:common+' 정식명',aliases:['검색 별칭']},native:[{language:'hy',common:'Արցախ'},{language:'ru',common:'Арцах'}]});
  seed.timelineRecords.propertyBindings=[['old',null,'1999','옛 이름'],['new','2000',null,'새 이름']].map(([id,validFrom,validTo,name])=>({
    id,objectRef:{domain:'territorial',id:'name-test'},validFrom,validTo,property:'name',value:{name,nameExplicit:true,names:details(name)}}));
  await page.addInitScript(({seed,appShell})=>{
    localStorage.setItem('pandoeditor-web-shell-prototype-v1-project',JSON.stringify(seed));
    localStorage.setItem('pandoeditor-web-shell-world-v1-project',JSON.stringify(seed));
    localStorage.setItem('pandolab-editor-project',JSON.stringify(seed));
    Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
    if(appShell){
      globalThis.PANDOLAB_SHELL_VERIFICATION=false;let chunks=[],readAt=0;
      globalThis.__namesSaved=null;
      globalThis.__TAURI_INTERNALS__={invoke:async(command,payload)=>{
        if(command==='begin_document_write'){chunks=[];return {token:1};}
        if(command==='append_document_chunk'){chunks.push(payload.contents);return {};}
        if(command==='finish_document_write'){globalThis.__namesSaved=chunks;return {path:'names.gpkg'};}
        if(command==='begin_document_read'){readAt=0;return {files:[{token:2,path:'names.gpkg',bytes:chunks.reduce((sum,c)=>sum+atob(c).length,0)}]};}
        if(command==='read_document_chunk'){const contents=chunks[readAt++];return {contents,done:readAt===chunks.length};}
        if(command==='abort_document_transfer')return {};
        throw Error('Unexpected test native command: '+command);
      }};
    }
  },{seed,appShell});
  await page.route('**/modules/app-composition.js*',async route=>{
    const response=await route.fetch(),source=await response.text(),anchor='if (onComposed) await onComposed(';
    if(!source.includes(anchor))throw Error('Timeline probe boundary missing');
    await route.fulfill({response,body:source.replace(anchor,'window.__testEditorTimeline={month:()=>domainAssembly.timelineMonth,setMonth:month=>domainAssembly.setTimelineMonth(month),state:()=>projectSession.state};'+anchor)});
  });
  await page.route('**/modules/app-domain-assembly.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    await route.fulfill({response,body:source.replace('dependencies = ports;','dependencies = ports;window.__namesDocument=()=>projectDomain;')});
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const unexpectedWorldReads=[];
  await page.route('**/assets/data/builtin-world/generated/v1/transport/**',async route=>{
    unexpectedWorldReads.push(route.request().url());await route.abort('blockedbyclient');
  });
  await page.goto(appShell?'/?renderer=canvas':'/__editor/index.html?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness',/editable|enhanced/,{timeout:60000});
  expect(unexpectedWorldReads).toEqual([]);
  expect(await page.evaluate(()=>window.__namesDocument().snapshot().territorialEntities.map(row=>row.id))).toEqual(['name-test']);
  const select=async()=>{
    await expect.poll(()=>page.evaluate(()=>window.PANDOLAB_TERRITORIAL.select('name-test')),{timeout:15000}).toBe(true);
    await expect(page.locator('#entityNameInput')).toBeVisible();
  };
  const geometries=await page.evaluate(()=>window.__namesDocument().snapshot().geometries);
  await setEditorMonth(page,'1999-12');await select();
  await expect(page.locator('#entityNameInput')).toHaveValue('옛 이름');
  await expect(page.locator('#entityNameDetails')).toContainText('옛 이름 정식명');
  await setEditorMonth(page,'2000-01');await select();
  await expect(page.locator('#entityNameInput')).toHaveValue('새 이름');
  await expect(page.locator('#entityNameDetails')).toContainText('새 이름 정식명');
  await expect(page.locator('#entityNameDetails')).toContainText('Արցախ');
  expect(await page.evaluate(()=>window.__namesDocument().state().dirty)).toBe(false);
  await page.locator('#entityNameInput').fill('수정 이름');await page.locator('#entityNameInput').press('Tab');
  await expect(page.locator('#entityNameDetails')).toContainText('수정 이름');
  await page.locator('#undoBtn').click();
  // Accepted history closes the property presenter; select the retained object
  // again rather than reading the hidden form's previous input value.
  await select();
  await expect(page.locator('#entityNameInput')).toHaveValue('새 이름');
  await page.locator('#redoBtn').click();await select();await expect(page.locator('#entityNameInput')).toHaveValue('수정 이름');
  await expect(page.locator('#entityNameDetails')).toContainText('새 이름 정식명');
  let file;
  await page.locator('#mobileFileBtn').click();
  if(appShell){await page.locator('#saveProjectBtn').click();await expect.poll(()=>page.evaluate(()=>window.__namesSaved?.length||0)).toBeGreaterThan(0);}
  else{const download=page.waitForEvent('download');await page.locator('#saveProjectBtn').click();file=info.outputPath('names.gpkg');await(await download).saveAs(file);}
  await page.evaluate(()=>{window.__namesReopened=false;window.addEventListener('pandolab:project-changed',event=>{if(event.detail?.reason==='project-load')window.__namesReopened=true;});});
  await page.locator('#mobileFileBtn').click();
  if(appShell)await page.locator('#openProjectBtn').click();
  else{const chooser=page.waitForEvent('filechooser');await page.locator('#openProjectBtn').click();await(await chooser).setFiles(file);}
  await expect.poll(()=>page.evaluate(()=>window.__namesReopened),{timeout:30000}).toBe(true);
  await setEditorMonth(page,'2000-01');await select();
  await expect(page.locator('#entityNameInput')).toHaveValue('수정 이름');
  await expect(page.locator('#entityNameDetails')).toContainText('새 이름 정식명');
  await setEditorMonth(page,'1999-12');await select();await expect(page.locator('#entityNameInput')).toHaveValue('옛 이름');
  expect(await page.evaluate(()=>window.__namesDocument().snapshot().geometries)).toEqual(geometries);
  expect(errors).toEqual([]);
  expect(unexpectedWorldReads).toEqual([]);
});
