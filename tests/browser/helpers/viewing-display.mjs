export async function openViewingDisplay(page){
 if(page.viewportSize().width<800){await page.locator('#mobileMenuBtn').click();await page.locator('#mobileDisplayBtn').click();}
 else await page.locator('#mapDisplayBtn').click();
}
export async function setViewingLayer(page,group,value){
 if(page.viewportSize().width>=800){
  const trigger=page.locator(`[data-map-display-row="${group}"]`);if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
 }
 const input=page.locator(`#${group}Visible`);
 if(await input.isChecked()!==value)await input.locator('..').click();
}
export async function closeViewingDisplay(page){
 if(page.viewportSize().width>=800)await page.locator('#mapDisplayBtn').click();
 else {await page.locator('#mobileMenuBtn').click();await page.locator('#mobileDisplayBtn').click();}
}
