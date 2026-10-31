import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';

test('territorial selection enters the editor directly and preserves its flag menu and tabs', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await gotoEditor(page, '/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  const slotPointerEvents = await page.locator('.map-overlay-layer').evaluate(node => getComputedStyle(node).pointerEvents);
  expect(slotPointerEvents).toBe('none');

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await expect(page.locator('#selectionToolbar')).toHaveCount(0);
  await expect(page.locator('#editorSurface')).toHaveClass(/surface-open/);
  await expect(page.locator('#propertyTitle')).toHaveText('독일');
  await expect(page.locator('#flagPreview')).toBeVisible();
  await expect(page.locator('#editorSurface #entityNameInput, #editorSurface #flagMenuBtn')).toHaveCount(2);
  await expect(page.locator('#editorSurface #entityNotesInput')).toHaveCount(1);
  await expect(page.locator('#editorObjectHeader #objectVisibilityBtn, #editorObjectHeader #objectLockBtn')).toHaveCount(2);
  await expect(page.locator('#editorSurface .surface-header-actions #objectVisibilityBtn, #editorSurface .surface-header-actions #objectLockBtn, #editorSurface .surface-header-actions #objectDeleteBtn')).toHaveCount(0);

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('BGR'));
  await expect(page.locator('#propertyTitle')).toHaveText('불가리아');
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('RUS'));
  await expect(page.locator('#propertyTitle')).toHaveText('러시아');

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await expect(page.locator('#propertyTitle')).toHaveText('독일');
  await expect(page.locator('#editorSurface')).toHaveClass(/surface-open/);
  await expect(page.locator('#changeCountryTypeBtn')).toHaveCount(0);
  await expect(page.locator('#editorObjectHeader')).toBeVisible();
  await expect(page.locator('#selectionToolbar')).toHaveCount(0);
  await expect(page.locator('#editorTabBtn')).toBeVisible();
  await expect(page.locator('#actionsTabBtn')).toBeVisible();
  await expect(page.locator('#relationTabBtn')).toBeVisible();
  await expect(page.locator('#editorSurface')).not.toHaveAttribute('data-editor-inline-relation', 'true');
  await expect(page.locator('#entityProperties > .editor-info-section')).toHaveAttribute('aria-label', '정보');
  await expect(page.locator('#entityNameDetailsDisclosure summary')).toHaveText('명칭 상세');
  await expect(page.locator('#entityNameDetailsDisclosure #entityNameDetails')).toHaveAttribute('aria-label', '시점별 명칭');
  await expect(page.locator('#entityPeriodInput')).toHaveAttribute('placeholder', '시작일 ~ 종료일');
  await expect(page.locator('#entityColorTrigger')).toBeVisible();
  await expect(page.locator('#entityNotesInput')).toBeVisible();
  await expect(page.locator('#entityProperties > .editor-action-section:not(.editor-relation-section)')).toHaveAttribute('aria-label', '편집');
  await expect(page.locator('#entityProperties > .editor-relation-section')).toHaveAttribute('aria-label', '관계');
  await expect(page.locator('#entityProperties > .editor-section > .editor-section-title')).toHaveCount(0);
  await page.locator('#relationTabBtn').click();
  await expect(page.locator('#entityParentInputControl')).toBeHidden();
  await page.locator('#entityChangeParentBtn').click();
  await expect(page.locator('#entityParentInputControl')).toBeVisible();
  await expect(page.locator('#annexEntityBtn')).toBeHidden();
  await expect(page.locator('#entityNameInput')).toBeHidden();
  await page.locator('#editorTabBtn').click();
  await expect(page.locator('#entityNameInput')).toBeVisible();
  await expect(page.locator('#entityParentInputControl')).toBeHidden();
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#flagMenuBtn')).toBeVisible();
    await page.locator('#flagMenuBtn').click();
    await expect(page.locator('#flagMenu')).toBeVisible();
    await expect(page.locator('#flagMenu')).toHaveAttribute('aria-label', '국기 관리');
    await expect(page.locator('#flagDefaultBtn')).toHaveText('기본값 복원');
    await expect(page.locator('#flagRemoveBtn')).toHaveText('국기 제거');
    await expect(page.locator('#flagLibraryBtn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#flagMenu')).toBeHidden();
    await expect(page.locator('#flagMenuBtn')).toBeFocused();
    await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath(`editor-header-${width}.png`) });
  }

  await page.locator('#flagMenuBtn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#flagUploadBtn').click();
  await (await chooser).setFiles({
    name: 'flag.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="28"><rect width="40" height="28" fill="red"/></svg>'),
  });
  await expect(page.locator('#flagPreview img')).toHaveCount(1);
  expect(await page.locator('#flagPreview img').evaluate(element => getComputedStyle(element).objectFit)).toBe('contain');

  await page.locator('#flagMenuBtn').click();
  await page.locator('#flagRemoveBtn').click();
  await expect(page.locator('#flagPreview .ui-icon')).toHaveCount(1);
  await page.locator('#flagMenuBtn').click();
  await expect(page.locator('#flagMenu')).toHaveClass(/ui-command-menu/);
  await expect(page.locator('#flagMenu .ui-menu-item')).toHaveCount(4);
  await expect(page.locator('#flagUploadBtn')).toHaveText('파일');
  await expect(page.locator('#flagDefaultBtn')).toBeEnabled();
  await expect(page.locator('#flagRemoveBtn')).toBeDisabled();
});

test('object deletion remains in its shared action footer and is destructive only on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page, '/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await page.locator('#actionsTabBtn').click();
  const deletion = page.locator('#objectDeleteBtn');
  const visibility = page.locator('#objectVisibilityBtn');
  const lock = page.locator('#objectLockBtn');
  await expect(deletion.locator('small')).toBeEmpty();
  await expect(deletion).toHaveAttribute('data-action-reason', 'false');
  await expect(visibility).toHaveAttribute('aria-label', '객체 숨기기');
  await expect(lock).toHaveAttribute('aria-label', '잠금');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect(lock).toHaveAttribute('aria-label', '잠금 해제');
  await expect(page.locator('#editorObjectStatus')).toContainText('잠김');
  await expect(page.locator('#flagMenuBtn')).toBeDisabled();
  await expect(deletion).toBeDisabled();
  await expect(deletion.locator('small')).toHaveText('잠금 해제 후 삭제');
  await expect(deletion).toHaveAttribute('data-action-reason', 'true');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#flagMenuBtn')).toBeEnabled();
  await expect(deletion).toBeEnabled();
  await expect(deletion.locator('small')).toBeEmpty();
  await expect(deletion).toHaveAttribute('data-action-reason', 'false');
  await visibility.click();
  await expect(visibility).toHaveAttribute('aria-label', '객체 표시');
  await expect(visibility).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#editorObjectStatus')).toContainText('숨김');
  await visibility.click();
  await expect(visibility).toHaveAttribute('aria-label', '객체 숨기기');
  await expect(visibility).toHaveAttribute('aria-pressed', 'true');
  const readAppearance = selector => page.locator(selector).evaluate(row => ({
    icon: getComputedStyle(row.querySelector('.command-row-icon')).color,
    title: getComputedStyle(row.querySelector('strong')).color,
    help: getComputedStyle(row.querySelector('small')).color,
    background: getComputedStyle(row).backgroundColor,
  }));
  const resolveColor = value => page.evaluate(color => {
    const probe = document.createElement('span');
    probe.style.color = color;
    document.body.append(probe);
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
  }, value);

  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.mouse.move(0, 0);
    await expect(deletion).toBeVisible();
    expect(await deletion.evaluate(row => ({
      host: row.parentElement.parentElement.classList.contains('surface-content-editor'),
      previous: row.parentElement.previousElementSibling?.id,
      section: row.parentElement.tagName,
    }))).toEqual({ host: true, previous: 'hydroProperties', section: 'DIV' });
    const coast = await page.locator('#editEntityCoastBtn').boundingBox();
    const finalAction = await page.locator('#copyEntityRegionBtn').boundingBox();
    const remove = await deletion.boundingBox();
    expect(remove.y).toBeGreaterThanOrEqual(finalAction.y + finalAction.height);
    expect(remove.x).toBeCloseTo(coast.x, 1);
    expect(remove.width).toBeCloseTo(coast.width, 1);
    expect(await readAppearance('#objectDeleteBtn')).toEqual(await readAppearance('#editEntityCoastBtn'));
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await readAppearance('#objectDeleteBtn')).title).toBe(await resolveColor('var(--text)'));
    const normal = await readAppearance('#objectDeleteBtn');
    await deletion.hover();
    await expect.poll(async () => (await readAppearance('#objectDeleteBtn')).background).toBe(await resolveColor('color-mix(in srgb, var(--danger) 8%, var(--panel))'));
    const hovered = await readAppearance('#objectDeleteBtn');
    expect(hovered.icon).toBe(await resolveColor('var(--danger-text)'));
    expect(hovered.title).toBe(hovered.icon);
    expect(hovered.help).toBe(await resolveColor('color-mix(in srgb, var(--danger-text) 75%, var(--panel))'));
    expect(hovered.background).not.toBe(normal.background);
    await page.mouse.move(0, 0);
    await expect.poll(() => readAppearance('#objectDeleteBtn')).toEqual(normal);
    await deletion.focus();
    expect((await readAppearance('#objectDeleteBtn')).title).not.toBe(hovered.title);
    await deletion.evaluate(row => row.blur());
  }

  await deletion.click();
  await expect(page.locator('#confirmModal')).toBeVisible();
  await expect(page.locator('#confirmModalOkBtn')).toHaveClass(/danger-confirm/);
  await expect(page.locator('#confirmModalOkBtn')).toHaveText('선택 객체 삭제');
  await expect(page.locator('#confirmModal')).toContainText('직접 연결된 데이터도 삭제됩니다.');
  await expect(page.locator('#confirmModal')).toContainText('실행취소로 복구할 수 있습니다.');
  await page.locator('#confirmModalCancelBtn').click();
  await expect(page.locator('#confirmModal')).toBeHidden();
  await expect(page.locator('#propertyTitle')).toHaveText('독일');

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('BGR'));
  await expect(page.locator('#editorScrollBody #objectDeleteBtn')).toHaveCount(1);
  expect(await deletion.evaluate(row => row.parentElement.parentElement.classList.contains('surface-content-editor'))).toBe(true);
  await expect(deletion).toBeEnabled();
});
