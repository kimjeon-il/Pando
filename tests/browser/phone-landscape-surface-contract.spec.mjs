import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

for (const viewport of [{width: 640, height: 360}, {width: 844, height: 390}]) {
  test('phone-landscape sheet at ' + viewport.width + ' keeps its common side-dock skin', async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/assets/css/app.css');
    await page.setContent([
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
      '   <nav class="mobile-bottom-bar"><button class="ui-button ui-nav-item" aria-expanded="true"><span>검색</span><strong>검색</strong></button></nav>',
      '   <div class="mobile-menu-toolbar"><button class="mobile-menu-trigger">메뉴</button></div>',
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
    expect(actual.right).toBeCloseTo(viewport.width, 0);
    expect(actual.headerDisplay).toBe('flex');
    expect(actual.handleDisplay).toBe('none');
    expect(actual.titleDisplay).toBe('flex');
    await expect(page.locator('.mobile-bottom-bar')).toBeVisible();
    const navStyle = await page.locator('.mobile-bottom-bar').evaluate(node => getComputedStyle(node).backgroundColor);
    expect(navStyle).not.toBe('rgba(0, 0, 0, 0)');
  });
}
