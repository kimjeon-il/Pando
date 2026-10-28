import {test,expect} from '@playwright/test';
import {gotoEditor,setEditorMonth} from './helpers/editor-entry.mjs';
import {openFileMenu} from './helpers/map-plugin-flow.mjs';
import {createViewerProjectPackage} from '../fixtures/viewer-project-package.mjs';
import {createTerritorialFeature,TERRITORIAL_IDENTITY_FIELDS} from '../../shared/frontend/js/modules/territorial-units.js';

let fixture;
test.beforeAll(async()=>{
  const square=(min,max)=>({type:'Polygon',coordinates:[[[min,min],[min,max],[max,max],[max,min],[min,min]]]});
  const features=[
    createTerritorialFeature({id:'A',name:'공통 A',entityKind:'general',geometry:square(0,12)}),
    createTerritorialFeature({id:'B',name:'공통 B',entityKind:'general',geometry:square(4,16)}),
  ];
  fixture=await createViewerProjectPackage('공통 A',{
    territorialEntities:features.map(feature=>({...feature,geometry:null,properties:Object.fromEntries(TERRITORIAL_IDENTITY_FIELDS.filter(key=>Object.hasOwn(feature.properties,key)).map(key=>[key,feature.properties[key]]))})),
    geometries:features.map(feature=>({id:'shape:'+feature.id,version:1,geojson:feature.geometry})),
    labels:[],genericFeatures:[],distributionLayers:[],distributionEntries:[],hydroEdits:[],
    timelineRecords:{schemaVersion:3,propertyBindings:[],
      lifetimes:features.map(feature=>({id:'life:'+feature.id,objectRef:{domain:'territorial',id:feature.id},validFrom:null,validTo:null})),
      geometryBindings:features.map(feature=>({id:'geometry:'+feature.id,objectRef:{domain:'territorial',id:feature.id},validFrom:null,validTo:null,geometryRef:{id:'shape:'+feature.id,version:1}})),
      parentRelations:features.map(feature=>({id:'parent:'+feature.id,objectRef:{domain:'territorial',id:feature.id},validFrom:null,validTo:null,parentId:'',coverageMode:'explicit'})),
    },
  });
});

async function observe(page){
  for(const [file,factory,global]of [['map-owner-composition.js','createMapOwners','__sharedOwners'],['rendering-domain.js','createRenderingDomain','__sharedRendering']]){
    await page.route('**/modules/'+file+'*',async route=>{
      const response=await route.fetch(),source=await response.text();
      await route.fulfill({response,body:source.replace(`export function ${factory}(`,'function observedFactory(')+
        `\nexport function ${factory}(...args){const value=observedFactory(...args);window.${global}={value,options:args[0]};return value;}`});
    });
  }
}
async function openProject(page,bytes){
  await openFileMenu(page);
  const picker=page.waitForEvent('filechooser');await page.locator('#openProjectBtn').click();
  await(await picker).setFiles({name:'shared-map.gpkg',mimeType:'application/geopackage+sqlite3',buffer:bytes});
  await expect.poll(()=>page.evaluate(()=>window.__sharedOwners.value.objectPresentation.territorialScope.displayEntities().length),{timeout:45000}).toBe(2);
  await expect.poll(()=>page.evaluate(()=>window.__sharedOwners.value.projectSession.state.countryVisualPhase),{timeout:45000}).not.toBe('pending');
}
const state=page=>page.evaluate(()=>window.__sharedRendering.options.projectDomain.state());
async function mapPoint(page){
  const point=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.project([7,8]));
  const bounds=await page.locator('#map').boundingBox();return {x:bounds.x+point[0],y:bounds.y+point[1]};
}
for(const renderer of ['webgl','canvas'])for(const touch of [false,true]){
  test(`${renderer} ${touch?'touch':'mouse'} shares viewing and picking across both products`,async({browser})=>{
    test.setTimeout(180000);
    for(const product of ['viewer','editor']){
      const context=await browser.newContext({viewport:touch?{width:430,height:900}:{width:1440,height:900},hasTouch:touch,isMobile:touch});
      const page=await context.newPage(),errors=[],terrain=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/\/terrain\//.test(request.url()))terrain.push(request.url());});
      await page.addInitScript(forceCanvas=>{
        Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
        if(forceCanvas){const original=window.HTMLCanvasElement.prototype.getContext;window.HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:original.call(this,type,...args);};}
      },renderer==='canvas');
      await observe(page);
      if(product==='editor')await gotoEditor(page,'/?debug=1');else await page.goto('/?debug=1');
      await expect(page.locator(product==='editor'?'#app':'#viewerStatus')).toHaveAttribute(product==='editor'?'data-readiness':'data-ready',product==='editor'?'enhanced':'true',{timeout:90000});
      await openProject(page,fixture.bytes);
      const pendingMeta=await page.evaluate(()=>{
        const owners=window.__sharedOwners.value,pending=owners.countryIndex.pendingCountryLabelAnchors,wasPending=pending.has('A');
        pending.add('A');const meta=owners.objectCatalog.listObjectCatalogItems('objectLabels').find(row=>row.id==='A').meta;
        if(!wasPending)pending.delete('A');return meta;
      });
      expect(pendingMeta).toBe('계산 중');
      await expect.poll(()=>page.evaluate(()=>window.__sharedRendering.options.gpuMapRenderer.getStats().renderer)).toBe(renderer==='canvas'?'canvas-worker':'webgl2');
      if(renderer==='webgl'&&!touch){
        const camera=await page.evaluate(()=>JSON.stringify(window.__sharedOwners.value.projectSession.state.view));
        if(product==='editor'){await setEditorMonth(page,'1914-07');await setEditorMonth(page,'1914-08');}
        else{await page.locator('#timelineDateButton').click();await page.locator('#timelineViewUnit').selectOption('month');await page.locator('#timelineNextMonth').click();await page.locator('#timelineNextMonth').click();await page.keyboard.press('Escape');}
        await expect.poll(()=>page.evaluate(()=>window.__sharedOwners.value.projectSession.state.timelineCursor)).toBe('1914-08');
        expect(await page.evaluate(()=>JSON.stringify(window.__sharedOwners.value.projectSession.state.view))).toBe(camera);
      }
      await page.addStyleTag({content:'#map .territorial-label-item {pointer-events:none !important;}'});
      const before=await state(page),view=await page.evaluate(()=>JSON.stringify(window.__sharedOwners.value.projectSession.state.view));
      const point=await mapPoint(page);
      if(touch){
        const cdp=await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:point.x,y:point.y}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:point.x+30,y:point.y+20}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await cdp.detach();
      }else{
        await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+30,point.y+20,{steps:5});await page.mouse.up();
      }
      await expect.poll(()=>page.evaluate(()=>JSON.stringify(window.__sharedOwners.value.projectSession.state.view))).not.toBe(view);
      await expect.poll(()=>page.evaluate(()=>window.__sharedOwners.value.projectSession.state.mapMoving)).toBe(false);
      await expect.poll(()=>page.evaluate(()=>window.__sharedOwners.value.projectSession.state.suppressNextMapClick||null)).toBeNull();
      const target=await mapPoint(page);
      await page.evaluate(()=>{window.__sharedClicks=[];for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','click'])document.addEventListener(type,event=>window.__sharedClicks.push({type,target:event.target.tagName,prevented:event.defaultPrevented}),{capture:true});});
      if(touch)await page.touchscreen.tap(target.x,target.y);else await page.mouse.click(target.x,target.y);
      const choice=page.locator('#objectChooserList [data-object-chooser-index]').filter({hasText:'공통 A'});
      const hit=await page.evaluate(({x,y})=>{const owner=window.__sharedOwners.value,map=document.getElementById('map').getBoundingClientRect();return {clicks:window.__sharedClicks,target:document.elementFromPoint(x,y)?.outerHTML.slice(0,180),tool:owner.projectSession.state.tool,hits:owner.objectPicking.territorialObjectsAt([x-map.x,y-map.y],[7,8]).map(row=>row.ref.id),selection:window.__sharedRendering.options.selectionDomain.snapshot().selection.items.map(ref=>ref.id)};},target);
      try{await expect(choice,product+' '+JSON.stringify(hit)).toBeVisible();}
      catch(error){throw new Error(product+' touch trace: '+JSON.stringify(await page.evaluate(()=>window.__sharedClicks)),{cause:error});}
      if(touch)await choice.tap();else await choice.click();
      await expect.poll(()=>page.evaluate(()=>window.__sharedRendering.options.selectionDomain.snapshot().selection.items.map(ref=>ref.id))).toContain('A');
      const after=await state(page);for(const key of ['checkpoint','presentationCheckpoint','dirty','canUndo'])expect(after[key],product+' '+key).toBe(before[key]);
      if(product==='editor')expect(terrain).toEqual([]);
      if(product==='editor'&&renderer==='webgl'&&!touch){
        const name=page.locator('#entityNameInput');await expect(name).toBeVisible();await name.fill('공통 A 수정');await name.press('Tab');
        const readName=()=>page.evaluate(()=>window.__sharedOwners.value.objectPresentation.territorialScope.displayFeature('A').properties.name);
        await expect.poll(readName).toBe('공통 A 수정');
        const history=async action=>{const desktop=page.locator('#'+action+'Btn');await(await desktop.isVisible()?desktop:page.locator('#mobile'+action[0].toUpperCase()+action.slice(1)+'Btn')).click();};
        await history('undo');await expect.poll(readName).toBe('공통 A');await history('redo');await expect.poll(readName).toBe('공통 A 수정');
        await openFileMenu(page);const downloading=page.waitForEvent('download');await page.locator('#saveProjectBtn').click();const download=await downloading;
        const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);const bytes=Buffer.concat(chunks);await download.delete();
        expect(bytes.subarray(0,16).toString()).toBe('SQLite format 3\0');
        await openProject(page,bytes);await expect.poll(readName).toBe('공통 A 수정');expect((await state(page)).dirty).toBe(false);
      }
      expect(errors).toEqual([]);await context.close();
    }
  });
}
