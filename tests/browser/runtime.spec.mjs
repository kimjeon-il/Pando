import { expect, test } from '@playwright/test';

const layouts = [
  { name: 'wide', viewport: { width: 1440, height: 900 } },
  { name: 'compact', viewport: { width: 1024, height: 800 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
];

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', request => {
    if (['script', 'stylesheet'].includes(request.resourceType())) errors.push(`${request.resourceType()} failed: ${request.url()}`);
  });
  page.on('response', response => {
    if (response.status() >= 400 && ['script', 'stylesheet', 'fetch'].includes(response.request().resourceType())) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  return errors;
}

for (const layout of layouts) {
  for (const colorScheme of ['light', 'dark']) {
    test(`${layout.name} ${colorScheme} boots without runtime errors`, async ({ page }) => {
      await page.setViewportSize(layout.viewport);
      await page.emulateMedia({ colorScheme });
      const errors = await openApp(page);
      await expect(page.locator('#app')).toHaveAttribute('data-layout', layout.name);
      expect(errors).toEqual([]);
    });
  }
}

test('retired DOM hooks stay absent and every app module uses revision 0.24.0', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const audit = await page.evaluate(() => ({
    retiredElementCount: document.querySelectorAll([
      '.notification-center', '.map-toolbar', '.mobile-world-btn', '.hydro-data-details',
      '.panel-collapsed', '.section-heading', '.row-between',
    ].join(',')).length,
    retiredSymbolCount: document.querySelectorAll('symbol#icon-cursor, symbol#icon-menu').length,
    moduleUrls: performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => /\/assets\/js\/(?:app|modules\/[^/]+)\.js\?/.test(name)),
  }));
  expect(audit.retiredElementCount).toBe(0);
  expect(audit.retiredSymbolCount).toBe(0);
  expect(audit.moduleUrls.length).toBeGreaterThanOrEqual(7);
  expect(audit.moduleUrls.every(url => new URL(url).searchParams.get('v') === '0.24.0')).toBe(true);
  expect(errors).toEqual([]);
});

test('country edit worker executes annex, new-country, merge, commit, discard, and failure paths', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const result = await page.evaluate(async () => {
    const worker = new Worker('/assets/js/workers/map-edit-worker.js?v=0.24.0');
    let workerError = '';
    worker.addEventListener('error', event => { workerError = event.message || 'worker error'; });
    const ring = (left, right) => [[left, 0], [right, 0], [right, 2], [left, 2], [left, 0]];
    const feature = (id, left, right) => ({
      type: 'Feature',
      properties: { editor_id: id, editor_name: id, pop_est: 1, gdp_md_est: 1 },
      geometry: { type: 'Polygon', coordinates: [ring(left, right)] },
    });
    const base = [feature('A', 0, 2), feature('B', 2, 4)];
    const send = (message, expectedType) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(workerError || `worker timeout: ${expectedType}`)), 8000);
      const receive = event => {
        if (event.data?.type !== expectedType) return;
        if (message.requestId && event.data.requestId !== message.requestId) return;
        clearTimeout(timer);
        worker.removeEventListener('message', receive);
        resolve(event.data);
      };
      worker.addEventListener('message', receive);
      worker.postMessage(message);
    });
    const rebase = revision => send({ type: 'rebase', features: base, dataRevision: revision }, 'ready');
    const execute = (requestId, operation, payload) => send({
      type: 'execute', requestId, dataRevision: requestId, operation, ...payload,
    }, 'result');
    try {
      await rebase(1);
      const mergeDiscarded = await execute(1, 'merge', { sourceId: 'A', targetIds: ['B'] });
      worker.postMessage({ type: 'discard', requestId: 1 });
      const annexAfterDiscard = await execute(2, 'annex', {
        targetId: 'B', donorIds: ['A'], transferredGeometry: { type: 'Polygon', coordinates: [ring(1, 2)] },
      });
      worker.postMessage({ type: 'commit', requestId: 2 });

      await rebase(3);
      const newCountry = await execute(3, 'new-country', {
        sourceIds: ['A'], transferredGeometry: { type: 'Polygon', coordinates: [ring(0, 1)] },
        newFeature: feature('N', 0, 1),
      });
      worker.postMessage({ type: 'discard', requestId: 3 });

      await rebase(4);
      const mergeCommitted = await execute(4, 'merge', { sourceId: 'A', targetIds: ['B'] });
      worker.postMessage({ type: 'commit', requestId: 4 });
      const mergeAfterCommit = await execute(5, 'merge', { sourceId: 'A', targetIds: ['B'] });
      const invalid = await execute(6, 'annex', {
        targetId: 'missing', donorIds: ['A'], transferredGeometry: { type: 'Polygon', coordinates: [ring(0, 1)] },
      });
      return {
        mergeDiscarded, annexAfterDiscard, newCountry, mergeCommitted, mergeAfterCommit, invalid,
      };
    } finally {
      worker.terminate();
    }
  });
  expect(result.mergeDiscarded.ok).toBe(true);
  expect(result.annexAfterDiscard.ok).toBe(true);
  expect(result.newCountry.ok).toBe(true);
  expect(result.newCountry.result.newCountryId).toBe('N');
  expect(result.mergeCommitted.ok).toBe(true);
  expect(result.mergeAfterCommit.ok).toBe(false);
  expect(result.invalid.ok).toBe(false);
  expect(errors).toEqual([]);
});

test('wide keeps layers visible while the add popover opens', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  await page.locator('#createMenuBtn').click();
  await expect(page.locator('#createMenu')).not.toHaveClass(/hidden/);
  await expect(page.locator('#leftPanel')).toBeVisible();
  await expect(page.locator('#createMenuBtn')).toHaveAttribute('aria-expanded', 'true');
  expect(errors).toEqual([]);
});

for (const layout of layouts.slice(1)) {
  test(`${layout.name} keeps exactly one navigation surface active`, async ({ page }) => {
    await page.setViewportSize(layout.viewport);
    const errors = await openApp(page);
    for (const [button, panel] of [
      ['#mobileMapBtn', '#leftPanel'],
      ['#mobileCreateBtn', '#createMenu'],
      ['#mobileEditBtn', '#rightPanel'],
      ['#mobileMapBtn', '#leftPanel'],
    ]) {
      await page.locator(button).click();
      await expect(page.locator(button)).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(panel)).toBeVisible();
      await expect(page.locator('.adaptive-nav button.sheet-open')).toHaveCount(1);
    }
    expect(errors).toEqual([]);
  });
}

test('opening a sheet does not shift the compact map projection safe area', async ({ page }) => {
  await page.setViewportSize(layouts[1].viewport);
  await openApp(page);
  const before = await page.locator('#map').boundingBox();
  await page.locator('#mobileCreateBtn').click();
  const after = await page.locator('#map').boundingBox();
  expect(after).toEqual(before);
});

test('common row buttons, headers, cards, and checkboxes keep their component geometry', async ({ page }) => {
  test.setTimeout(120_000);
  for (const layout of layouts) {
    await page.setViewportSize(layout.viewport);
    const errors = await openApp(page);
    const createTrigger = layout.name === 'wide' ? '#createMenuBtn' : '#mobileCreateBtn';
    await page.locator(createTrigger).click();
    const geometry = await page.evaluate(() => {
      const item = document.querySelector('#addCountryBtn');
      const body = document.querySelector('#createMenu .map-sheet-body');
      const checkbox = document.querySelector('#countriesVisible');
      const itemStyle = getComputedStyle(item);
      const bodyStyle = getComputedStyle(body);
      const checkStyle = getComputedStyle(checkbox);
      return {
        itemWidth: item.getBoundingClientRect().width,
        bodyInnerWidth: body.clientWidth - Number.parseFloat(bodyStyle.paddingLeft) - Number.parseFloat(bodyStyle.paddingRight),
        itemHeight: item.getBoundingClientRect().height,
        itemBoxSizing: itemStyle.boxSizing,
        checkSize: [checkbox.getBoundingClientRect().width, checkbox.getBoundingClientRect().height],
        checkBorder: checkStyle.borderTopWidth,
        checkShadow: checkStyle.boxShadow,
        checkBackground: checkStyle.backgroundColor,
        checkBorderColor: checkStyle.borderTopColor,
        cardsUseBase: [...document.querySelectorAll('.editor-section, .editor-danger-zone')].every(card => card.classList.contains('ui-card')),
      };
    });
    if (layout.name !== 'mobile') expect(Math.abs(geometry.itemWidth - geometry.bodyInnerWidth)).toBeLessThanOrEqual(1);
    expect(geometry.itemHeight).toBe(layout.name === 'mobile' ? 68 : 64);
    expect(geometry.itemBoxSizing).toBe('border-box');
    expect(geometry.checkSize).toEqual([18, 18]);
    expect(geometry.checkBorder).toBe('1px');
    expect(geometry.checkShadow).toBe('none');
    expect(geometry.checkBackground).toBe(geometry.checkBorderColor);
    expect(geometry.cardsUseBase).toBe(true);
    expect(errors).toEqual([]);
  }
});

test('compact layer, create, and editor headers share one 74px rule', async ({ page }) => {
  await page.setViewportSize(layouts[1].viewport);
  const errors = await openApp(page);
  const measurements = [];
  for (const [trigger, panel] of [
    ['#mobileMapBtn', '#leftPanel'],
    ['#mobileCreateBtn', '#createMenu'],
    ['#mobileEditBtn', '#rightPanel'],
  ]) {
    await page.locator(trigger).click();
    measurements.push(await page.locator(`${panel} .map-sheet-header`).evaluate(header => {
      const title = header.querySelector('strong');
      const close = header.querySelector('.sheet-close-btn');
      const headerBox = header.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      const closeBox = close.getBoundingClientRect();
      return {
        height: headerBox.height,
        padding: getComputedStyle(header).padding,
        titleCenter: titleBox.top + titleBox.height / 2 - headerBox.top,
        closeCenter: closeBox.top + closeBox.height / 2 - headerBox.top,
      };
    }));
  }
  expect(measurements.map(value => value.height)).toEqual([74, 74, 74]);
  expect(measurements.map(value => value.padding)).toEqual(['16px', '16px', '16px']);
  for (const value of measurements) expect(Math.abs(value.titleCenter - value.closeCenter)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('mouse, wheel, touch pan, pinch, and double tap all advance map frames', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(layouts[2].viewport);
  const errors = await openApp(page);
  const svg = page.locator('#map .map-svg');
  const box = await svg.boundingBox();
  const revision = () => page.evaluate(() => window.__ATLASWRIGHT_VIEW_REVISION__ || 0);
  let before = await revision();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 42, box.y + box.height / 2 + 18, { steps: 4 });
  await page.mouse.up();
  await expect.poll(revision, { message: 'mouse drag should render a new frame', timeout: 20_000 }).toBeGreaterThan(before);
  before = await revision();
  await page.mouse.wheel(0, -220);
  await expect.poll(revision, { message: 'wheel zoom should render a new frame', timeout: 20_000 }).toBeGreaterThan(before);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const touchPoint = (id, x, y) => ({ id, x, y, radiusX: 1, radiusY: 1, force: 1 });
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const point = { x: box.x + 150, y: box.y + 260 };
  before = await revision();
  await touch('touchStart', [touchPoint(11, point.x, point.y)]);
  await touch('touchMove', [touchPoint(11, point.x + 36, point.y + 12)]);
  await touch('touchEnd', []);
  await expect.poll(revision, { message: 'single-touch pan should render a new frame', timeout: 20_000 }).toBeGreaterThan(before);

  before = await revision();
  await touch('touchStart', [touchPoint(21, point.x, point.y), touchPoint(22, point.x + 40, point.y)]);
  await touch('touchMove', [touchPoint(21, point.x, point.y), touchPoint(22, point.x + 90, point.y)]);
  await touch('touchEnd', []);
  await expect.poll(revision, { message: 'pinch zoom should render a new frame', timeout: 20_000 }).toBeGreaterThan(before);

  before = await revision();
  for (const pointerId of [31, 32]) {
    await touch('touchStart', [touchPoint(pointerId, point.x, point.y)]);
    await touch('touchEnd', []);
  }
  await expect.poll(revision, { message: 'double tap should render a new frame', timeout: 20_000 }).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test('virtualized country deletion honors lock, undo, and autosave restore', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  await page.locator('[data-layer-folder-toggle="countries"]').first().click();
  const firstRow = page.locator('#countriesLayerChildren .layer-child').first();
  const name = await firstRow.locator('.layer-child-name').textContent();
  await page.locator('#countriesLocked').check({ force: true });
  await expect(firstRow.locator('.layer-child-delete')).toBeDisabled();
  await page.locator('#countriesLocked').uncheck({ force: true });

  const deleteCountry = async () => {
    await page.getByRole('button', { name: `${name} 삭제`, exact: true }).click();
    await page.locator('#confirmModalOkBtn').click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  };
  await deleteCountry();
  await page.locator('#undoBtn').click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await deleteCountry();
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  const countryFolderToggle = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await countryFolderToggle.getAttribute('aria-expanded') !== 'true') await countryFolderToggle.click();
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
