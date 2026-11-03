import {test,expect} from '@playwright/test';
test('an immediate presentation request waits for compiled Worker startup and editing stays unavailable',async({page})=>{
 await page.route('**/map-display-worker-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Map display Worker</title>'}));
 await page.goto('/map-display-worker-fixture');
 await page.addScriptTag({url:'/assets/js/build-meta.js'});
 const result=await page.evaluate(async()=>{
  const {createMapDisplayClient}=await import('/assets/js/modules/map-display-client.js');
  const {createTerritorialFeature}=await import('/assets/js/modules/territorial-units.js');
  const feature=(id,x)=>createTerritorialFeature({id,entityKind:id==='CHILD'?'regional':'general',parentId:'',geometry:{type:'Polygon',coordinates:[[[0,0],[0,10],[x,10],[x,0],[0,0]]]}});
  const entities=[feature('ROOT',10),feature('CHILD',5)],before=JSON.stringify(entities);
  const client=createMapDisplayClient({getEntities:()=>entities,getRevision:()=>1});
  try{const response=await client.prepare({kind:'boundaries'});
   const editingBlocked=await client.prepare({kind:'editing'}).then(()=>false,()=>true);
   return {count:response.result.segments.length,same:before===JSON.stringify(entities),editingBlocked};
  }finally{client.dispose();}
 });
 expect(result.count).toBeGreaterThan(0);expect(result.same).toBe(true);expect(result.editingBlocked).toBe(true);
});
