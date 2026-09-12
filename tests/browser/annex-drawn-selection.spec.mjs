import { expect, test } from '@playwright/test';

test('annex selection controls and heading fit a narrow editor surface', async ({ page }) => {
  // Exercise the shipped HTML/CSS without loading the world mesh and camera.
  await page.route('**/annex-controls-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="ko"><head><link rel="stylesheet" href="/assets/css/app.css"><link rel="stylesheet" href="/assets/css/ui-v2.bundle.css"></head><body></body></html>',
  }));
  await page.goto('/annex-controls-fixture');
  await page.evaluate(async () => {
    const source = new DOMParser().parseFromString(await (await fetch('/index.html')).text(), 'text/html');
    const task = source.getElementById('modeEditingHud');
    document.body.append(task);
    task.classList.remove('hidden');
    task.querySelector('#annexDrawnActions').classList.remove('hidden');
    task.querySelector('#annexDrawnCount').textContent = '영역 12개';
    task.querySelector('#modeTaskName').textContent = '영토 편입 3단계';
    task.querySelector('#modeTaskStage').textContent = '영역 선택';
    task.querySelector('#modeActionBar').classList.remove('hidden');
    task.querySelector('#modeCancelBtn .mode-button-label').textContent = '뒤로';
    task.querySelector('#modePrimaryBtn .mode-button-label').textContent = '편입 (12)';
  });
  for (const width of [260, 300, 360]) {
    await page.setViewportSize({ width: width < 300 ? 390 : 1024, height: 844 });
    await page.locator('#modeEditingHud').evaluate((element, value) => { element.style.width = value + 'px'; }, width);
    const sizes = await page.locator('#modeEditingHud').evaluate(element => ({
      controlsFit: element.querySelector('#annexDrawnActions').scrollWidth <= element.querySelector('#annexDrawnActions').clientWidth,
      titleFits: element.querySelector('#modeTaskName').scrollWidth <= element.querySelector('#modeTaskName').clientWidth,
      buttons: [...element.querySelectorAll('#annexDrawnActions button, #modeActionBar button')].map(button => ({
        text: button.textContent.trim().replace('처리 중…', '').trim(),
        fits: button.scrollWidth <= button.clientWidth,
        nowrap: getComputedStyle(button.querySelector('.mode-button-label') || button).whiteSpace === 'nowrap',
      })),
    }));
    expect(sizes.controlsFit).toBe(true);
    expect(sizes.titleFits).toBe(true);
    expect(sizes.buttons.map(button => button.text)).toEqual(['추가', '되돌리기', '뒤로', '편입 (12)']);
    expect(sizes.buttons.every(button => button.fits && button.nowrap)).toBe(true);
  }
});
