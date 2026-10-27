import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';

test('desktop display menu becomes visible as soon as it opens', async ({ page }) => {
  await gotoEditor(page, '/assets/css/app.css');
  await page.setContent(`
    <link rel="stylesheet" href="/assets/css/ui.bundle.css">
    <div class="app-root" data-layout="wide">
      <aside id="displayFixture" class="workspace-surface surface-display ui-sheet view-menu-desktop"></aside>
    </div>
  `);
  const state = await page.locator('#displayFixture').evaluate(element => {
    const before = getComputedStyle(element).visibility;
    element.classList.add('surface-open');
    const style = getComputedStyle(element);
    return { before, visibility: style.visibility, opacity: style.opacity };
  });
  expect(state).toEqual({ before: 'hidden', visibility: 'visible', opacity: '1' });
});

async function openApp(page, viewport) {
  await page.setViewportSize(viewport);
  await gotoEditor(page, '/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
}

test('mobile create, display and editor share the current sheet contract', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, { width: 390, height: 844 });

  const surfaces = [
    ['#mobileCreateBtn', '#createMenu'],
    ['#mobileDisplayBtn', '#mapDisplaySurface'],
    ['#mobileEditBtn', '#editorSurface'],
  ];

  for (const [triggerSelector, panelSelector] of surfaces) {
    if (triggerSelector === '#mobileDisplayBtn') {
      await page.locator('#mobileMenuBtn').click();
      await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
    }
    const trigger = page.locator(triggerSelector);
    const panel = page.locator(panelSelector);
    await trigger.click();
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const handle = panel.locator('[data-sheet-handle]');
    await expect(handle).toHaveAttribute('role', 'slider');
    await handle.press('End');
    await expect(panel).toHaveAttribute('data-sheet-snap', '2');
    await handle.press('Home');
    await expect(panel).toHaveAttribute('data-sheet-snap', '0');
    for (const [otherTrigger, otherPanel] of surfaces) {
      if (otherPanel === panelSelector) continue;
      await expect(page.locator(otherPanel)).toBeHidden();
      await expect(page.locator(otherTrigger)).toHaveAttribute('aria-expanded', 'false');
    }
  }
});

test('display and create reuse their DOM when switching between menu and sheet layouts', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, { width: 1024, height: 800 });

  await page.evaluate(() => {
    document.querySelector('#createMenu').dataset.testIdentity = 'create';
    document.querySelector('#mapDisplaySurface').dataset.testIdentity = 'display';
  });

  await page.locator('#mapDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeVisible();
  await expect(page.locator('#mapDisplaySurface')).toHaveClass(/view-menu-desktop/);
  await page.setViewportSize({ width: 390, height: 844 });
  // The open surface follows the layout change; toggling again would close it.
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await expect(page.locator('#mobileDisplayBtn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#mapDisplaySurface')).toBeVisible();
  await expect(page.locator('#mapDisplaySurface')).not.toHaveClass(/view-menu-desktop/);
  await expect(page.locator('#mapDisplaySurface')).toHaveCount(1);
  await expect(page.locator('#createMenu')).toHaveCount(1);
  await expect(page.locator('#mapDisplaySurface')).toHaveAttribute('data-test-identity', 'display');
  await expect(page.locator('#createMenu')).toHaveAttribute('data-test-identity', 'create');
});

test('menu joins the bottom navigation and follows measured height', async ({ page }) => {
  test.setTimeout(180_000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await openApp(page, { width: 1366, height: 800 });
  await expect(page.locator('#mobileMenuBtn')).toBeHidden();
  await expect(page.locator('#mobileFileBtn')).toBeVisible();
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    await expect(page.locator('#mobileMenuBtn')).toHaveCount(1);
    await expect(page.locator('#mobileMenuBtn strong')).toHaveText('메뉴');
    for (const font of [100,200]) {
      await page.locator('html').evaluate((node,value)=>{node.style.fontSize=`${value}%`;},font);
      const bar = await page.locator('.mobile-workspace-controls').boundingBox();
      await expect.poll(()=>page.locator('#app').evaluate(node=>Number.parseFloat(node.style.getPropertyValue('--mobile-nav-height')))).toBe(Math.ceil(bar.height));
      const buttons = await page.locator('.mobile-workspace-controls button').evaluateAll(buttons=>buttons.map(button=>{
        const b=button.getBoundingClientRect(),label=button.querySelector('strong'),l=label.getBoundingClientRect();
        return {id:button.id,x:b.x,right:b.right,y:b.y,width:b.width,height:b.height,bottom:b.bottom,labelBottom:l.bottom,clipped:label.scrollWidth>label.clientWidth};
      }).sort((a,b)=>a.x-b.x));
      expect(buttons).toHaveLength(6);
      expect(buttons.at(-1).id).toBe('mobileMenuBtn');
      for (const button of buttons) {
        expect(button.width).toBeCloseTo(buttons[0].width,0);
        expect(button.height).toBeCloseTo(buttons[0].height,0);
        expect(button.clipped).toBe(false);
        expect(button.labelBottom).toBeLessThanOrEqual(button.bottom);
      }
      await page.locator('#mobileMenuBtn').click();
      await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
      const menu=await page.locator('#mobileGlobalMenu').boundingBox();
      expect(menu.y+menu.height).toBeLessThanOrEqual(bar.y);
      expect(menu.x).toBeGreaterThanOrEqual(0);
      await page.locator('#mobileMenuFileBtn').click();
      await expect(page.locator('.top-actions')).toBeVisible();
      const file=await page.locator('.top-actions').boundingBox();
      expect(file.y+file.height).toBeLessThanOrEqual(bar.y);
      await page.locator('#mobileFileBackBtn').click();
      await page.keyboard.press('Escape');
      await expect(page.locator('#mobileMenuBtn')).toBeFocused();
      await page.locator('#mobileEditBtn').click();
      await expect(page.locator('#editorSurface')).toBeVisible();
      await expect.poll(async()=>{const b=await page.locator('#editorSurface').boundingBox();return Math.abs(b.y+b.height-bar.y);}).toBeLessThanOrEqual(1);
      await page.locator('#mobileEditBtn').click();
    }
  }
  await page.locator('html').evaluate(node=>{node.style.removeProperty('font-size');});
  await page.locator('#mobileSearchBtn').click();
  await page.locator('#objectSearchInput').fill('서울');
  await page.evaluate(()=>{
    Object.defineProperty(window.visualViewport,'height',{configurable:true,value:450});
    window.visualViewport.dispatchEvent(new window.Event('resize'));
  });
  await expect.poll(async()=>{const bar=await page.locator('.mobile-workspace-controls').boundingBox();return Math.round(bar.y+bar.height);}).toBe(450);
  await expect.poll(async()=>{const sheet=await page.locator('#objectSearchSurface').boundingBox();const bar=await page.locator('.mobile-workspace-controls').boundingBox();return sheet.y+sheet.height-bar.y;}).toBeLessThanOrEqual(1);
  await expect(page.locator('#objectSearchInput')).toHaveValue('서울');
  await page.evaluate(()=>{delete window.visualViewport.height;window.visualViewport.dispatchEvent(new window.Event('resize'));});
  await page.screenshot({path:test.info().outputPath('bottom-menu-320.png')});
  const metrics = await page.evaluate(() => {
    const app = document.querySelector('#app').getBoundingClientRect();
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    return { appTop: app.top, appHeight: app.height, workspaceTop: workspace.top, workspaceHeight: workspace.height };
  });
  expect(metrics.workspaceTop).toBe(0);
  expect(metrics.workspaceHeight).toBeGreaterThanOrEqual(metrics.appHeight - 1);
  expect(errors).toEqual([]);
});
