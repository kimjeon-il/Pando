import { gotoEditor, setEditorMonth } from './editor-entry.mjs';
import {expect} from '@playwright/test';
export async function verifyProjectSetupUi(page,{url,domainSource,afterBoot=async()=>{}}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/modules/app-domain-assembly.js*',async route=>{const source=domainSource||await(await route.fetch()).text();await route.fulfill({contentType:'text/javascript',body:source.replace('dependencies = ports;','dependencies = ports; window.__setupPorts=ports; window.__setupDomains=()=>({projectDomain,editingDomain});')});});
 await gotoEditor(page, url);await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:90000});await afterBoot();
 const before=await page.evaluate(()=>window.__setupDomains().projectDomain.state().checkpoint);
 await page.evaluate(()=>window.__setupPorts.lifecycleUi.projectUi.requestNew());await expect(page.locator('#projectSetupDialog')).toBeVisible();
 await page.locator('#projectSetupMonth').fill('0000-01');await page.locator('#projectSetupSubmit').click();await expect(page.locator('#projectSetupError')).not.toBeEmpty();expect(await page.evaluate(()=>window.__setupDomains().projectDomain.state().checkpoint)).toBe(before);
 await page.locator('#projectSetupMonth').fill('-0044-03');await page.locator('#projectSetupSource').selectOption('empty');await page.locator('#projectSetupLimited').check();await page.locator('#projectSetupStart').fill('-0500-01');await page.locator('#projectSetupEnd').fill('0100-12');
 await page.locator('#projectSetupSubmit').click();if(await page.locator('#confirmModal').isVisible())await page.locator('#confirmModalOkBtn').click();await expect(page.locator('#projectSetupDialog')).not.toBeVisible({timeout:30000});
 let result=await page.evaluate(()=>({state:window.__setupDomains().projectDomain.state(),project:window.__setupDomains().projectDomain.snapshot()}));expect(result.state.timelineCursor).toBe('-0044-03');expect(result.project.territorialEntities).toHaveLength(0);expect(result.project.projectSetup.timelineRange.end).toBe('0100-12');
 await page.evaluate(async()=>{const domain=window.__setupDomains().projectDomain;const file=await domain.buildFileSnapshot();await domain.load(file.project);});await expect(page.locator('#editorTimelineContext')).toContainText('기원전 44년 3월');
 await expect(page.locator('#timelineComparePin, #timelineComparisonPanel')).toHaveCount(0);
 const checkpoint=await page.evaluate(()=>window.__setupDomains().projectDomain.state().checkpoint);await setEditorMonth(page, '-0044-04');await expect(page.locator('#editorTimelineContext')).toContainText('기원전 44년 4월');expect(await page.evaluate(()=>window.__setupDomains().projectDomain.state().checkpoint)).toBe(checkpoint);
 await expect(page.locator('#projectSettingsBtn,#projectSetupCaptureDefault,#projectSetupResetDefault')).toHaveCount(0);
 expect(errors).toEqual([]);return {errors,month:result.state.timelineCursor};
}
