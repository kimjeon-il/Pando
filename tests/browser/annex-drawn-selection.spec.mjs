import { expect, test } from '@playwright/test';

test('country territory controls expose role cards, a compact draw toolbar and a separate selection list', async ({ page }) => {
  await page.route('**/territory-controls-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="ko"><head><link rel="stylesheet" href="/assets/css/app.css"><link rel="stylesheet" href="/assets/css/ui.bundle.css"></head><body class="app-root" data-layout="mobile"></body></html>',
  }));
  await page.goto('/territory-controls-fixture');
  await page.evaluate(async () => {
    const source = new DOMParser().parseFromString(await (await fetch('/index.html')).text(), 'text/html');
    const task = source.getElementById('modeEditingHud');
    document.body.append(task);
    task.querySelector('#modeDraftActions').classList.remove('hidden');
    task.querySelector('#territorySelectionStack').classList.remove('hidden');
    const objects = task.querySelector('#modeTaskObjects');
    objects.classList.remove('hidden');
    for (const role of ['넘겨받는 객체', '넘겨주는 객체']) {
      const card = document.createElement('section');
      card.className = 'workflow-object-card';
      card.textContent = role;
      objects.append(card);
    }
  });
  await expect(page.locator('#modeTaskObjects')).toContainText('넘겨받는 객체');
  await expect(page.locator('#modeTaskObjects')).toContainText('넘겨주는 객체');
  await expect(page.locator('#modeComponentsMethodInput + span')).toHaveText('영역 선택');
  await expect(page.locator('#modeRiverBoundaryOption')).toContainText('하천을 경계로 사용');
  await expect(page.locator('#territorySelectionStack')).toBeVisible();
  await expect(page.locator('#modeDraftActions .ui-icon')).toHaveCount(4);
  await expect(page.locator('#multiDrawnActions')).toBeHidden();
});

test('annex selection controls and heading fit a narrow editor surface', async ({ page }) => {
  // Exercise the shipped HTML/CSS without loading the world mesh and camera.
  await page.route('**/annex-controls-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="ko"><head><link rel="stylesheet" href="/assets/css/app.css"><link rel="stylesheet" href="/assets/css/ui.bundle.css"></head><body></body></html>',
  }));
  await page.goto('/annex-controls-fixture');
  await page.evaluate(async () => {
    const source = new DOMParser().parseFromString(await (await fetch('/index.html')).text(), 'text/html');
    const task = source.getElementById('modeEditingHud');
    document.body.append(task);
    document.body.classList.add('app-root');
    task.classList.remove('hidden');
    task.querySelector('#territorySelectionStack').classList.remove('hidden');
    task.querySelector('#modeDraftActions').classList.remove('hidden');
    task.querySelector('#modeDraftDeleteBtn').classList.add('hidden');
    task.querySelector('#modeTaskName').textContent = '영토 편입';
    task.querySelector('#modeTaskStage').textContent = '영토 선택';
    task.querySelector('#modeTaskStep').textContent = '2 / 3';
    task.querySelector('#modeTaskStep').classList.remove('hidden');
    task.querySelector('#modeTaskStatus').classList.add('hidden');
    task.querySelector('#modeActionBar').classList.remove('hidden');
    task.querySelector('#modeCancelBtn .mode-button-label').textContent = '뒤로';
    task.querySelector('#modePrimaryBtn .mode-button-label').textContent = '다음';
  });
  for (const width of [260, 300, 360]) {
    await page.setViewportSize({ width: width < 300 ? 390 : 1024, height: 844 });
    await page.evaluate(mobile => { document.body.dataset.layout = mobile ? 'mobile' : 'compact'; }, width < 300);
    await page.locator('#modeEditingHud').evaluate((element, value) => { element.style.width = value + 'px'; }, width);
    const sizes = await page.locator('#modeEditingHud').evaluate(element => ({
      controlsFit: element.querySelector('#modeDraftActions').scrollWidth <= element.querySelector('#modeDraftActions').clientWidth,
      titleFits: element.querySelector('#modeTaskName').scrollWidth <= element.querySelector('#modeTaskName').clientWidth,
      buttons: [...element.querySelectorAll('#modeDraftActions button:not(.hidden), #modeActionBar button')].map(button => ({
        text: button.getAttribute('aria-label'),
        fits: button.scrollWidth <= button.clientWidth,
        height: button.getBoundingClientRect().height,
      })),
      icons: [...element.querySelectorAll('#modeDraftActions .ui-icon')]
        .filter(icon => getComputedStyle(icon).display !== 'none').length,
    }));
    expect(sizes.controlsFit).toBe(true);
    expect(sizes.titleFits).toBe(true);
    expect(sizes.buttons.slice(0, 3).map(button => button.text)).toEqual(['꼭짓점 추가', '현재 경로 다시 그리기', '그리기 완료']);
    expect(sizes.buttons.every(button => button.fits)).toBe(true);
    expect(sizes.buttons.slice(0, 3).every(button => button.height >= (width < 300 ? 48 : 36))).toBe(true);
    expect(sizes.icons).toBe(4);
  }
});

test('editor command rows share common dimensions and expose real disabled reasons', async ({ page }) => {
  await page.route('**/editor-command-row-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="ko"><head><link rel="stylesheet" href="/assets/css/app.css"><link rel="stylesheet" href="/assets/css/ui.bundle.css"></head>
    <body class="app-root" data-layout="mobile" style="margin:0">
      <main class="editor-action-list" style="width:min(20rem, calc(100vw - 2rem)); margin:1rem">
        <button id="routineAction" class="ui-button editor-action-row" data-action-reason="false"><span><strong>영역 편입</strong><small>다른 객체의 영역 가져오기</small></span></button>
        <button id="blockedAction" class="ui-button editor-action-row" data-action-reason="true" disabled><span><strong>객체 합병</strong><small>이 객체는 잠겨 있습니다. 잠금을 해제한 뒤 작업하세요.</small></span></button>
        <button id="multiAction" class="ui-button editor-action-row" disabled><span><strong>하위단위 합병</strong><small>선택한 하위단위를 하나로 합치기</small></span></button>
      </main>
    </body></html>`,
  }));
  await page.goto('/editor-command-row-fixture');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(w => { document.body.dataset.layout = w < 800 ? 'mobile' : w < 1360 ? 'compact' : 'wide'; }, width);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      const sizes = await page.evaluate(() => {
        const measure = id => {
          const el = document.getElementById(id), small = el.querySelector('small');
          return { min: parseFloat(getComputedStyle(el).minHeight),
            height: el.getBoundingClientRect().height,
            detailVisible: getComputedStyle(small).display !== 'none',
            detailWrap: getComputedStyle(small).whiteSpace,
            radius: getComputedStyle(el).borderTopLeftRadius };
        };
        return { routine: measure('routineAction'), blocked: measure('blockedAction'),
          multi: measure('multiAction'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      const mobile = width < 800;
      expect(sizes.routine.min).toBe(mobile ? 48 : 52);
      expect(sizes.blocked.min).toBe(mobile ? 56 : 52);
      expect(sizes.multi.min).toBe(mobile ? 48 : 52);
      expect(sizes.routine.height).toBeGreaterThanOrEqual(sizes.routine.min);
      expect(sizes.blocked.height).toBeGreaterThanOrEqual(sizes.blocked.min);
      expect(sizes.routine.detailVisible).toBe(!mobile);
      expect(sizes.blocked.detailVisible).toBe(true);
      expect(sizes.multi.detailVisible).toBe(!mobile);
      expect(sizes.blocked.detailWrap).toBe('normal');
      expect(sizes.routine.radius).toBe('6px');
      expect(sizes.overflow).toBe(false);
    }
  }
});
