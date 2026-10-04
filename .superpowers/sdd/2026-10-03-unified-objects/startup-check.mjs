import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chromium'}),page=await browser.newPage();const errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
try{await page.goto('http://127.0.0.1:4173/?debug=1');await page.waitForFunction(()=>document.querySelector('#app')?.dataset.readiness==='enhanced',{},{timeout:30000});console.log('SELECT',await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.select('DEU'))); await page.locator('#selectionToolbarEditBtn').click({timeout:5000}); console.log('FORM',await page.locator('#entityProperties').isVisible());}catch(e){console.log('FAIL',e.message)}
console.log('ERRORS',JSON.stringify(errors));await browser.close();
