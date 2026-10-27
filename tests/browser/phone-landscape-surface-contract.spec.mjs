import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

for (const viewport of [{width: 640, height: 360}, {width: 844, height: 390}]) {
  test('phone-landscape sheet at ' + viewport.width + ' keeps its common side-dock skin', async ({ page }) => {
    await page.setViewportSize(viewport);
    const safeTop = viewport.width === 640 ? 24 : 0;
    if (safeTop) await page.route('**/assets/css/ui.bundle.css', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replaceAll('env(safe-area-inset-top)', '24px').replaceAll('env(safe-area-inset-right)', '12px');
      await route.fulfill({response,body});
    });
    await page.goto('/assets/css/app.css');
    await page.setContent([
      '<link rel="stylesheet" href="/assets/css/app.css">',
      '<link rel="stylesheet" href="/assets/css/ui.bundle.css">',
      '<div class="app-root" data-layout="phone-landscape">',
      ' <div class="workspace search-drawer-open">',
      '   <main class="map-wrap"></main>',
      '   <aside id="fixtureSheet" class="workspace-surface ui-sheet surface-search surface-open">',
      '     <header class="surface-header">',
      '       <button class="sheet-drag-handle" type="button">높이</button>',
      '       <div class="surface-header-title"><strong>검색</strong></div>',
      '     </header>',
      '     <div class="surface-body"><input aria-label="검색어"></div>',
      '   </aside>',
      '   <div class="mobile-workspace-controls">',
      '     <div class="mobile-menu-toolbar"><button class="ui-button ui-nav-item mobile-menu-trigger"><span><svg class="ui-icon" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></span><strong>메뉴</strong></button></div>',
      '     <nav class="mobile-bottom-bar"><button class="ui-button ui-nav-item" aria-expanded="true"><span>검색</span><strong>검색</strong></button></nav>',
      '   </div>',
      '   <div class="mobile-global-menu"><button class="ui-button ui-menu-item">파일</button></div>',
      '   <div class="top-actions mobile-open"><button class="ui-button ui-menu-item">뒤로</button></div>',
      ' </div></div>',
    ].join(''));
    const actual = await page.locator('#fixtureSheet').evaluate(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const header = element.querySelector('.surface-header');
      return {
        position: style.position,
        borderTop: style.borderTopWidth,
        borderLeft: style.borderLeftWidth,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        shadow: style.boxShadow,
        right: rect.right,
        width: rect.width,
        headerDisplay: getComputedStyle(header).display,
        handleDisplay: getComputedStyle(header.querySelector('.sheet-drag-handle')).display,
        titleDisplay: getComputedStyle(header.querySelector('.surface-header-title')).display,
      };
    });
    expect(actual.position).toBe('fixed');
    expect(actual.borderTop).toBe('0px');
    expect(actual.borderLeft).toBe('1px');
    expect(actual.radius).toBe('0px');
    expect(actual.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(actual.shadow).not.toBe('none');
    expect(actual.width).toBeLessThanOrEqual(Math.min(320, viewport.width * 0.45) + 1);
    const dock = await page.locator('.mobile-workspace-controls').boundingBox();
    expect(dock.x + dock.width).toBeCloseTo(viewport.width, 0);
    expect(actual.right).toBeCloseTo(dock.x, 0);
    const panel = await page.locator('#fixtureSheet').boundingBox();
    expect(panel.y).toBe(safeTop);
    expect(panel.y + panel.height).toBe(viewport.height);
    const menu = await page.locator('.mobile-menu-toolbar').boundingBox();
    const nav = await page.locator('.mobile-bottom-bar').boundingBox();
    expect(menu.x).toBeCloseTo(dock.x, 0);
    expect(menu.y).toBe(safeTop);
    for (const selector of ['.mobile-global-menu','.top-actions']) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds.y).toBe(safeTop);
      expect(bounds.x + bounds.width).toBeCloseTo(dock.x, 0);
    }
    expect(nav.x).toBeCloseTo(dock.x, 0);
    expect(nav.y).toBeCloseTo(menu.y + menu.height, 0);
    expect(nav.y + nav.height).toBeLessThanOrEqual(viewport.height);
    const insets = await page.locator('.workspace').evaluate(node => {
      const style = getComputedStyle(node);
      return {left:style.getPropertyValue('--map-safe-left').trim(),right:style.getPropertyValue('--map-safe-right').trim()};
    });
    expect(insets.left).toBe('0px');
    expect(Number.parseFloat(insets.right)).toBeCloseTo(dock.width + actual.width, 0);
    const chrome = await page.locator('.mobile-menu-toolbar').evaluate(node => {
      const style = getComputedStyle(node);
      return {border:style.borderTopWidth,radius:style.borderRadius,shadow:style.boxShadow};
    });
    expect(chrome).toEqual({border:'0px',radius:'0px',shadow:'none'});
    for (const selected of [true,false]) {
      await page.locator('.mobile-workspace-controls button').evaluateAll((buttons, value) => buttons.forEach(button => button.setAttribute('aria-expanded', String(value))), selected);
      await expect.poll(async () => {
        const states = await page.locator('.mobile-workspace-controls button').evaluateAll(buttons => buttons.map(button => {
          const style = getComputedStyle(button);
          return [style.color,style.backgroundColor,style.borderColor,style.boxShadow];
        }));
        return JSON.stringify(states[0]) === JSON.stringify(states[1]);
      }).toBe(true);
    }
    expect(actual.headerDisplay).toBe('flex');
    expect(actual.handleDisplay).toBe('none');
    expect(actual.titleDisplay).toBe('flex');
    await expect(page.locator('.mobile-bottom-bar')).toBeVisible();
    const navStyle = await page.locator('.mobile-workspace-controls').evaluate(node => getComputedStyle(node).backgroundColor);
    expect(navStyle).not.toBe('rgba(0, 0, 0, 0)');
  });
}
