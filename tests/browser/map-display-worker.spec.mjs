import {test,expect} from '@playwright/test';
test('an immediate presentation request waits for compiled Worker startup and editing stays unavailable',async({page})=>{
 await page.goto('/assets/js/build-meta.js');
 const result=await page.evaluate(async()=>{
  const {createMapDisplayClient}=await import('/assets/js/modules/map-display-client.js');
  const feature=(id,x,parentId='')=>({type:'Feature',id,properties:{entityKind:'general',parentId},geometry:{type:'Polygon',coordinates:[[[0,0],[0,10],[x,10],[x,0],[0,0]]]}});
  const entities=[feature('ROOT',10),feature('CHILD',5,'ROOT')],before=JSON.stringify(entities);
  const client=createMapDisplayClient({getEntities:()=>entities,getRevision:()=>1});
  try{const response=await client.prepare({kind:'boundaries'});return {count:response.result.segments.length,same:before===JSON.stringify(entities)};}finally{client.dispose();}
 });
 expect(result.count).toBeGreaterThan(0);expect(result.same).toBe(true);
});
