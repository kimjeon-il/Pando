import {test,expect} from '@playwright/test';

test('report first builtin project startup failure without importing files',async({page})=>{
 test.setTimeout(120000);
 const errors=[],consoleErrors=[];
 page.on('pageerror',error=>errors.push(String(error.stack||error.message)));
 page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 await page.goto('/?debug=1&renderer=canvas');
 await page.waitForFunction(()=>{
   const element=document.getElementById('viewerStatus');
   return element?.dataset.ready==='true'||element?.getAttribute('role')==='alert';
 },null,{timeout:90000});
 const result=await page.evaluate(()=>{
   const element=document.getElementById('viewerStatus');
   const viewer=window.__PANDOLAB_VIEWER__;
   return {status:element?.textContent,ready:element?.dataset.ready,role:element?.getAttribute('role'),
     diagnostics:viewer?.diagnostics?.(),projectId:viewer?.documentSnapshot?.()?.documentId,
     generation:viewer?.rendererStats?.()?.projectGeneration};
 });
 console.log('PROJECT_OPEN_STARTUP_DIAGNOSTIC',JSON.stringify({result,errors,consoleErrors}).slice(0,20000));
 expect(result.ready).toBe('true');
});
