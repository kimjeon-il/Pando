import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

async function fixture(page) {
  await page.route('**/feedback-fixture', route => route.fulfill({ contentType: 'text/html', body: `
    <link rel="stylesheet" href="/assets/css/components/surface.css">
    <style>html{font-size:16px}.hidden,[hidden]{display:none!important}
    .ui-dialog{position:fixed;inset:20px;background:white}
    .ui-scroll-surface{height:140px;overflow:auto;width:240px}
    .ui-overlay-scrollbar{width:16px}.ui-overlay-scrollbar-thumb{display:block;background:gray}
    </style><div id="app" data-layout="mobile"></div>
    <button id="trigger" data-tooltip="레이어 추가" aria-describedby="help">추가</button><p id="help">도움말</p>
    <div id="tip" class="hidden" role="tooltip"></div>
    <div id="sheet"><div id="scroll" class="ui-scroll-surface"><div style="height:1200px">내용</div></div></div>
    <div id="dialog" class="ui-dialog hidden" aria-modal="true" role="dialog"><button>처음</button><div id="modalScroll" class="ui-scroll-surface"><div style="height:1200px">상세</div></div><button>마지막</button></div>
    <div id="nested" class="ui-dialog hidden" aria-modal="true" role="dialog"><button>확인</button></div>` }));
  await page.goto('/feedback-fixture');
  await page.evaluate(async () => {
    const { installOverlayScrollbars } = await import('/assets/js/modules/overlay-scrollbars.js');
    const { installDialogAccessibilityController } = await import('/assets/js/modules/dialog-accessibility-controller.js');
    const { createTooltipController } = await import('/assets/js/modules/tooltip-controller.js');
    installDialogAccessibilityController();
    window.disposeScrollbars = installOverlayScrollbars();
    createTooltipController({ document, window, tooltip: document.querySelector('#tip'), clamp: (n,a,b) => Math.max(a,Math.min(b,n)) }).bind();
  });
}

test('keyboard tooltip works on narrow touch layouts without losing descriptions', async ({ page }) => {
  await fixture(page);
  await page.locator('#trigger').dispatchEvent('pointerover', { pointerType: 'touch' });
  await expect(page.locator('#tip')).toBeHidden();
  for (const width of [360, 390, 430, 1024, 1366]) {
    await page.setViewportSize({ width, height: 740 });
    await page.evaluate(() => document.documentElement.classList.add('keyboard-navigation'));
    await page.locator('#trigger').focus();
    await expect(page.locator('#tip')).toBeVisible();
    await expect(page.locator('#trigger')).toHaveAttribute('aria-describedby', 'help tip');
    await page.keyboard.press('Escape');
    await expect(page.locator('#tip')).toBeHidden();
    await expect(page.locator('#trigger')).toHaveAttribute('aria-describedby', 'help');
    await page.locator('#trigger').blur();
  }
});

test('modal scrollbars belong to the focus scope and nested dialogs hide background tracks', async ({ page }) => {
  await fixture(page);
  await page.locator('#dialog').evaluate(el => el.classList.remove('hidden'));
  const track = page.locator('[role="scrollbar"][aria-controls="modalScroll"]');
  await expect(track).toBeVisible();
  expect(await track.evaluate(el => !!el.closest('#dialog'))).toBe(true);
  expect(Math.abs((await track.boundingBox()).y - (await page.locator('#modalScroll').boundingBox()).y)).toBeLessThan(2);
  await track.focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.locator('#modalScroll').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('#dialog button').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(track).toBeFocused();
  for (const key of ['Home', 'PageDown', 'ArrowDown', 'PageUp', 'ArrowUp']) await page.keyboard.press(key);
  await page.locator('#nested').evaluate(el => el.classList.remove('hidden'));
  await expect(track).toBeHidden();
  await page.locator('#nested').evaluate(el => el.classList.add('hidden'));
  await expect(track).toBeVisible();
});

test('scrollbar follows sheet transforms during drag and settling', async ({ page }) => {
  await fixture(page);
  const track = page.locator('[role="scrollbar"][aria-controls="scroll"]');
  await expect(track).toBeVisible();
  for (const state of ['is-sheet-dragging', 'is-sheet-settling']) {
    await page.locator('#sheet').evaluate((el, name) => { el.className = name; }, state);
    for (const offset of [40, 110, 65]) {
      await page.locator('#sheet').evaluate((el, y) => { el.style.transform = `translateY(${y}px)`; }, offset);
      await expect.poll(async () => Math.abs((await track.boundingBox()).y - (await page.locator('#scroll').boundingBox()).y)).toBeLessThan(2);
    }
  }
  await page.evaluate(() => window.disposeScrollbars());
  await expect(page.locator('[role="scrollbar"]')).toHaveCount(0);
});

test('concise toast copy fits narrow screens without enlarging the toast', async ({ page }) => {
  await fixture(page);
  await page.addStyleTag({ url: '/assets/css/tokens/ui-v2.css' });
  await page.addStyleTag({ url: '/assets/css/app.css' });
  await page.addStyleTag({ url: '/assets/css/components/feedback.css' });
  await page.evaluate(() => {
    const notice = document.createElement('div');
    notice.className = 'action-status ui-toast error';
    notice.innerHTML = '<span></span><strong></strong><button class="notification-close">닫기</button>';
    document.body.append(notice);
  });
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 740 });
    for (const message of ['프로젝트 저장 완료', '3개 객체 삭제 완료', '다른 원본 국가를 선택하세요',
      '국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.',
      'Very-long-project-file-name.json의 전체 geometry를 보존해 1개 행정구역을 가져왔습니다.']) {
      await page.evaluate(async value => {
        const { compactNotificationMessage } = await import('/assets/js/modules/notification-copy.js');
        document.querySelector('.action-status strong').textContent = compactNotificationMessage(value, { tone: value.includes('잠금') ? 'error' : 'success' });
      }, message);
      expect(await page.locator('.action-status strong').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
  }
});
