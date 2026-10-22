import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.use({trace:'off',viewport:{width:1440,height:900}});
test('diagnose Soviet 1991 library import in a 2012-01 source project', async({page},info)=>{
  test.setTimeout(300000);
  const errors=[];
  let patched=0;
  const workerIntercepts={batch:0,planner:0,validator:0};
  const modern=process.env.PANDO_SOVIET_PROFILE_MODE==='modern';
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
            if(data?.type==='USSR_WORKER_PROFILE')mark(data.stage,{workerMs:data.workerMs,...data.info});
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
  // Profile the actual immutable Worker module without modifying published code.
  await page.context().route('**/map-edit-library-calculation.js*',async route=>{
    if(!route.request().url().includes('/worker-runtime/'))return route.continue();
    let code=await(await route.fetch()).text();
    const start='export async function calculateLibraryBatch(payload, originals, existingUnits, clipper, checkpoint) {';
    const probe="  const __batchProbe=(stage,info={})=>self.postMessage({type:'USSR_WORKER_PROFILE',stage,workerMs:performance.now(),info});";
    if(code.split(start).length!==2)throw Error('Missing worker batch');
    code=code.replace(start,start+"\n"+probe+"\n  __batchProbe('worker:batch:begin',{countries:originals.length,units:existingUnits.length,imports:payload.countries.length});");
    const entry="    const plan = await planner(draft, { type: 'FeatureCollection', features: [feature] }, 'territory-replacement');";
    if(code.split(entry).length!==2)throw Error('Missing worker planner');
    code=code.replace(entry,"    __batchProbe('worker:planner:begin',{id:feature.id,countries:draft.features.length});\n"+entry+
      "\n    __batchProbe('worker:planner:end',{affected:plan.affectedIds.length,donors:plan.donorIds.length});");
    const donor='    for (const id of plan.donorIds) {';
    if(code.split(donor).length!==2)throw Error('Missing donor loop');
    code=code.replace(donor,"    __batchProbe('worker:donors:begin',{count:plan.donorIds.length});\n"+donor);
    const donorDone='    deleted += plan.counts.deleted;';
    if(code.split(donorDone).length!==2)throw Error('Missing donor completion');
    code=code.replace(donorDone,"    __batchProbe('worker:donors:end');\n"+donorDone);
    const checkpoint='    await checkpoint();';
    if(code.split(checkpoint).length!==2)throw Error('Missing batch checkpoint');
    code=code.replace(checkpoint,"    __batchProbe('worker:checkpoint:begin');\n"+checkpoint+"\n    __batchProbe('worker:checkpoint:end');");
    const validation="  if (validateCollection(draft, [...affected]).overlapAreaKm2 > 0.001) throw new Error('영토 변경 후 국가 간 중첩이 남아 추가할 수 없습니다.');";
    if(code.split(validation).length!==2)throw Error('Missing batch validation');
    code=code.replace(validation,"  __batchProbe('worker:validate:begin',{countries:draft.features.length,affected:affected.size});\n"+validation+"\n  __batchProbe('worker:validate:end');");
    workerIntercepts.batch++;
    await route.fulfill({contentType:'text/javascript',body:code});
  });
  await page.context().route('**/import-service.js*',async route=>{
    if(!route.request().url().includes('/worker-runtime/'))return route.continue();
    let code=await(await route.fetch()).text();
    const point='  function mergeImportedCountryProperties(existing, imported, geometry) {';
    const tracer="  const __clipProbe=(stage,info={})=>self.postMessage({type:'USSR_WORKER_PROFILE',stage,workerMs:performance.now(),info});";
    if(code.split(point).length!==2)throw Error('Missing clipper planner');
    code=code.replace(point,tracer+"\n"+point);
    for(const [target,op,info] of [
      ['    const importedRawUnion = normalizeGeometry(clipper.union(...imported.map(feature => feature.geometry.coordinates)));','union','{}'],
      ['      const overlap = normalizeGeometry(clipper.intersection(existing.geometry.coordinates, importedRawUnion.coordinates));','intersection','{id}'],
      ['      const remainder = normalizeGeometry(clipper.difference(existing.geometry.coordinates, importedRawUnion.coordinates));','difference','{id}']]){
      if(code.split(target).length!==2)throw Error('Missing clipper operation '+op);
      const indent=target.match(/^ */)[0];
      code=code.replace(target,indent+"__clipProbe('clip:"+op+":begin',"+info+");\n"+target+"\n"+indent+"__clipProbe('clip:"+op+":end',"+info+");");
    }
    workerIntercepts.planner++;
    await route.fulfill({contentType:'text/javascript',body:code});
  });
  await page.context().route('**/gis-geometry-validation.js*',async route=>{
    if(!route.request().url().includes('/worker-runtime/'))return route.continue();
    let code=await(await route.fetch()).text();
    const start='export function validateCollection(collection, affectedIds = null) {';
    const tracer="  const __validateProbe=(stage,info={})=>self.postMessage({type:'USSR_WORKER_PROFILE',stage,workerMs:performance.now(),info});";
    if(code.split(start).length!==2)throw Error('Missing country validation');
    code=code.replace(start,start+"\n"+tracer+"\n  __validateProbe('validate:enter',{count:collection.features?.length,affected:affectedIds?.length});");
    const geometry='    if ((!affected || affected.has(ids[index])) && !validGeometry(features[index].geometry)) {';
    if(code.split(geometry).length!==2)throw Error('Missing geometry validation');
    code=code.replace(geometry,"    if(!affected||affected.has(ids[index]))__validateProbe('validate:geometry:begin',{id:ids[index]});\n"+geometry+
      "\n    if(!affected||affected.has(ids[index]))__validateProbe('validate:geometry:end',{id:ids[index]});");
    const pairs='  for (let i = 0; i < features.length; i += 1) {';
    if(code.split(pairs).length!==2)throw Error('Missing pair validation');
    code=code.replace(pairs,"  __validateProbe('validate:pairs:begin',{count:features.length});\n"+pairs);
    workerIntercepts.validator++;
    await route.fulfill({contentType:'text/javascript',body:code});
  });
  let result,outcome='setup';
  try{
    await gotoEditor(page,'/?debug=1&renderer=canvas');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});
    if(modern){await setEditorMonth(page,'2012-01');}
    else {
    await page.locator('#mobileFileBtn').click();
    await page.locator('#newProjectBtn').click();
    await page.locator('#projectSetupMonth').fill('2012-01');
    await page.locator('#projectSetupSubmit').click();
    if(await page.locator('#confirmModal').isVisible())await page.locator('#confirmModalOkBtn').click();
    await expect(page.locator('#projectSetupDialog')).toBeHidden({timeout:90000});
    }
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
    result={outcome,mode:modern?'modern-cursor':'2012-baseline',initial,patched,workerIntercepts,state,errors};
  }catch(error){
    outcome='setup-failure';result={outcome,mode:modern?'modern-cursor':'2012-baseline',error:String(error.stack||error),patched,workerIntercepts,errors};
  }finally{
    await mkdir('test-results/soviet-1991-import-profile',{recursive:true});
    await writeFile('test-results/soviet-1991-import-profile/report.json',JSON.stringify(result,null,2));
    console.log('SOVIET_1991_IMPORT_PROFILE',JSON.stringify(result));
  }
  expect(patched).toBe(1);
  expect(outcome).not.toBe('setup-failure');
});
