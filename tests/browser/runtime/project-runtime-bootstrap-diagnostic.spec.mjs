import {test,expect} from '@playwright/test';

test('capture actual default-world runtime initialization and source error',async({page})=>{
  test.setTimeout(70000);
  const errors=[],consoleMessages=[],failedRequests=[];
  page.on('pageerror',error=>errors.push(error.stack||String(error)));
  page.on('console',message=>{if(['warning','error'].includes(message.type()))consoleMessages.push(message.text());});
  page.on('requestfailed',request=>failedRequests.push([request.url(),request.failure()?.errorText]));
  await page.route('**/modules/viewer-composition.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const marker="onError:error=>{presentViewerLoadStatus(status,'지도를 불러오지 못했습니다.";
    if(!source.includes(marker))throw Error('No lifecycle error diagnostic marker');
    const next=source.replace(marker,
      "onError:error=>{window.__BOOT_ERROR__=String(error?.stack||error);console.error('BOOT_SOURCE_ERROR',error);presentViewerLoadStatus(status,'지도를 불러오지 못했습니다.");
    await route.fulfill({response,body:next});
  });
  await page.goto('/?debug=1',{waitUntil:'domcontentloaded'});
  await expect.poll(async()=>page.evaluate(()=>{
    const status=document.querySelector('#viewerStatus');
    return status?.dataset.ready==='true'||status?.getAttribute('role')==='alert';
  }),{timeout:55000}).toBe(true);
  const result=await page.evaluate(()=>({
    status:document.querySelector('#viewerStatus')?.textContent,
    ready:document.querySelector('#viewerStatus')?.dataset.ready,
    bootError:window.__BOOT_ERROR__||null,
    diagnostics:window.__PANDOLAB_VIEWER__?.diagnostics?.()||null,
  }));
  console.log('BOOTSTRAP_DIAGNOSTIC',JSON.stringify({result,errors,consoleMessages,failedRequests}));
  expect(result.bootError).toBeNull();
  expect(result.ready).toBe('true');
});
