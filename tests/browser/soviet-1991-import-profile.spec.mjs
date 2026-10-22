import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.use({trace:'off',viewport:{width:1440,height:900}});
test('diagnose Soviet 1991 library import in a 2012-01 source project', async({page},info)=>{
  test.setTimeout(300000);
  const errors=[];
  let patched=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text().slice(0,400));});
  await page.addInitScript(()=>{
    const records=[];
    const mark=(name,extra={})=>records.push({name,at:Math.round(performance.now()),...extra});
    window.__SOVIET_IMPORT_PROFILE__={records,mark};
    const Native=window.Worker;
    window.Worker=class extends Native {
      constructor(url,options) {
        super(url,options);
        if(String(url).includes('map-edit-worker')) {
          mark('worker:created');
          this.addEventListener('message',event=>{
            const data=event.data;
            if(data?.rpc==='pandolab-worker-rpc'&&data.type==='result')
              mark('worker:response',{requestId:data.requestId});
          });
        }
      }
      postMessage(data,...transfer) {
        if(data?.operation==='territorial-library-batch')
          mark('worker:request',{requestId:data.requestId});
        return super.postMessage(data,...transfer);
      }
    };
  });
  await page.route('**/modules/app-library-assembly.js*',async route=>{
    let code=await(await route.fetch()).text();
    const mark="globalThis.__SOVIET_IMPORT_PROFILE__?.mark";
    const inject=(needle,name,after=false)=>{
      if(code.split(needle).length!==2)throw Error('Probe anchor: '+name);
      const space=needle.match(/^ */)[0];
      code=code.replace(needle,after?needle+"\n"+space+mark+"('"+name+"');":space+mark+"('"+name+"');\n"+needle);
    };
    inject('        const descriptors = await territorialLibraryService.instantiateDescriptors(rootIds, referenceDate, childDepth);','descriptor:begin');
    inject('        const descriptors = await territorialLibraryService.instantiateDescriptors(rootIds, referenceDate, childDepth);','descriptor:end',true);
    inject('        if (!prepared.length) return { prepared };','ownership:complete');
    inject("        const response = await dependencies.spatialQuery.mapEditClient.execute('territorial-library-batch', { payload: { countries: countryFeatures, units } });",'worker:begin');
    inject("        const response = await dependencies.spatialQuery.mapEditClient.execute('territorial-library-batch', { payload: { countries: countryFeatures, units } });",'worker:end',true);
    inject('    const result = await committer.commitGisMerge({','commit:begin');
    patched++;
    await route.fulfill({contentType:'text/javascript',body:code});
  });
  let result,outcome='setup';
  try{
    await gotoEditor(page,'/?debug=1&renderer=canvas');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
    await page.locator('#mobileFileBtn').click();
    await page.locator('#newProjectBtn').click();
    await page.locator('#projectSetupMonth').fill('2012-01');
    await page.locator('#projectSetupSubmit').click();
    if(await page.locator('#confirmModal').isVisible())await page.locator('#confirmModalOkBtn').click();
    await expect(page.locator('#projectSetupDialog')).toBeHidden({timeout:90000});
    await expect.poll(()=>page.evaluate(()=>window.__testEditorTimeline.month())).toBe('2012-01');
    const initial=await page.evaluate(()=>({month:window.__testEditorTimeline.month(),
      entities:window.PANDOLAB_TERRITORIAL.list().length,
      ukraine:!!window.PANDOLAB_TERRITORIAL.get('UKR')}));
    await page.locator('#createMenuBtn').click();
    await page.locator('#addFromLibraryBtn').click();
    await expect(page.locator('#territorialLibraryModal')).toBeVisible();
    await page.locator('#territorialLibraryReferenceDateInput').fill('1991-01-01');
    await page.locator('#territorialLibrarySearchInput').fill('USSR');
    await page.locator('[data-library-entity-id="state:soviet-union"]').click();
    await expect(page.locator('#territorialLibraryAddBtn')).toBeEnabled({timeout:30000});
    await page.evaluate(()=>window.__SOVIET_IMPORT_PROFILE__.mark('submit'));
    await page.locator('#territorialLibraryAddBtn').click();
    try{
      await page.waitForFunction(()=>{
        const m=document.querySelector('#territorialLibraryModal');
        const b=document.querySelector('#territorialLibraryAddBtn');
        return !!document.querySelector('[data-library-impact]')||m?.classList.contains('hidden')||(b&&!b.disabled);
      },null,{timeout:80000});
    }catch{outcome='timed-out';}
    const state=await page.evaluate(()=>({
      records:window.__SOVIET_IMPORT_PROFILE__.records,
      hidden:document.querySelector('#territorialLibraryModal')?.classList.contains('hidden'),
      impact:!!document.querySelector('[data-library-impact]'),
      addEnabled:!document.querySelector('#territorialLibraryAddBtn')?.disabled,
      status:document.querySelector('#actionStatus')?.textContent?.slice(0,250)
    }));
    if(outcome!=='timed-out')outcome=state.impact?'confirmation':state.hidden?'imported':'error-or-unblocked';
    result={outcome,initial,patched,state,errors};
  }catch(error){
    outcome='setup-failure';result={outcome,error:String(error.stack||error),patched,errors};
  }finally{
    await mkdir('test-results/soviet-1991-import-profile',{recursive:true});
    await writeFile('test-results/soviet-1991-import-profile/report.json',JSON.stringify(result,null,2));
    console.log('SOVIET_1991_IMPORT_PROFILE',JSON.stringify(result));
  }
  expect(patched).toBe(1);
  expect(outcome).not.toBe('setup-failure');
});
