import { expect, test } from '@playwright/test';
import { openLibrary } from './helpers/library-state.mjs';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 390, height: 568 }]) {
  test(`library header, date clock and scrollable events fit ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    const errors = await openLibrary(page);
    await page.setViewportSize(viewport);
    const card = page.locator('.territorial-library-card'), input = page.locator('#territorialLibraryReferenceDateInput');
    const results = page.locator('#territorialLibraryResults'), footer = page.locator('.territorial-library-footer');
    const clock = page.getByRole('button', { name: '주요 역사 시점 보기' }), popover = page.locator('#territorialLibraryTimePopover');
    const title = page.locator('#territorialLibraryTitle');
    await expect(title).toHaveText('국가·지역 라이브러리');
    await expect.poll(() => title.evaluate(node => {
      const header = node.closest('header').getBoundingClientRect(), text = node.getBoundingClientRect();
      const close = document.getElementById('territorialLibraryCloseBtn').getBoundingClientRect();
      return text.width > 180 && text.height < 60 && close.x >= text.right && close.right <= header.right + 1 && close.y < text.bottom;
    })).toBe(true);
    await expect(page.locator('label[for="territorialLibrarySearchInput"]')).toHaveText('이름');
    await expect(page.locator('#territorialLibrarySearchInput')).toHaveAttribute('placeholder', '이름 검색');
    await expect(page.locator('label[for="territorialLibraryReferenceDateInput"]')).toHaveText('시점');
    expect(await clock.evaluate(node => node.closest('label'))).toBeNull();
    await expect.poll(() => results.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    const footerBefore = await footer.boundingBox();
    const scrollbar = page.locator('[role="scrollbar"][aria-controls="territorialLibraryResults"]');
    await expect(scrollbar).toBeVisible(); await scrollbar.focus(); await page.keyboard.press('End');
    await expect.poll(() => results.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
    await page.keyboard.press('Home'); await expect.poll(() => results.evaluate(node => node.scrollTop)).toBe(0);
    await clock.click(); await expect(popover).toBeVisible();
    const bounds = await popover.boundingBox(), cardBounds = await card.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(cardBounds.x); expect(bounds.x + bounds.width).toBeLessThanOrEqual(cardBounds.x + cardBounds.width + 1);
    expect(bounds.y).toBeGreaterThanOrEqual(cardBounds.y); expect(bounds.y + bounds.height).toBeLessThanOrEqual(cardBounds.y + cardBounds.height + 1);
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await expect.poll(() => popover.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    const hit = await popover.evaluate(node => { const rect = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(rect.right - 10, rect.top + 30)); });
    expect(hit).toBe(true, 'event surface is not covered by list scrollbar or clipped by the card');
    const footerAfter = await footer.boundingBox(); expect(Math.abs(footerAfter.y - footerBefore.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`library-clock-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press('Escape'); await input.fill('1989-04-25');
    const dateVisible = await input.evaluate(node => { const style = getComputedStyle(node), canvas = document.createElement('canvas'), context = canvas.getContext('2d'); context.font = style.font;
      return { text: context.measureText(node.value).width, available: node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) }; });
    expect(dateVisible.text).toBeLessThanOrEqual(dateVisible.available);
    await page.locator('#territorialLibrarySearchInput').fill('동독'); await page.locator('[data-library-entity-id="state:deutsche-demokratische-republik"]').click();
    await expect(page.locator('#territorialLibraryPreview svg path')).toHaveCount(1);
    expect(await page.locator('#territorialLibraryPreview').evaluate(node => node.previousElementSibling?.dataset.libraryEntityId)).toBe('state:deutsche-demokratische-republik');
    const previewBounds = await page.locator('#territorialLibraryPreview').boundingBox(), resultsBounds = await results.boundingBox();
    expect(previewBounds.width).toBeLessThanOrEqual(resultsBounds.width);
    expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(Math.abs((await footer.boundingBox()).y - footerBefore.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`library-preview-${viewport.width}x${viewport.height}.png`) });
    await page.locator('#territorialLibraryCloseBtn').click();
    await expect(page.locator('#territorialLibraryModal')).toBeHidden();
    expect(errors.pageErrors).toEqual([]); expect(errors.unexpectedConsoleErrors).toEqual([]);
  });
}
