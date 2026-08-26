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

test('a stale HTML shell recovers once through the current asset revision', async ({ page }) => {
  let shellRequests = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*stale-shell=1*', async route => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    shellRequests += 1;
    const response = await route.fetch();
    const freshHtml = await response.text();
    const body = shellRequests === 1
      ? freshHtml.replace('data-app-version="0.28.0"', 'data-app-version="0.24.0"')
      : freshHtml;
    await route.fulfill({ response, body });
  });
  await page.goto('/?stale-shell=1');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  expect(shellRequests).toBe(2);
  expect(new URL(page.url()).searchParams.has('_aw_cache')).toBe(false);
  expect(errors).toEqual([]);
});

test('retired DOM hooks stay absent and every app module uses the current revision', async ({ page }) => {
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
  expect(audit.moduleUrls.every(url => new URL(url).searchParams.get('v') === '0.28.0-r3')).toBe(true);
  expect(errors).toEqual([]);
});

test('country edit worker executes annex, new-country, merge, commit, discard, and failure paths', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const result = await page.evaluate(async () => {
    const worker = new Worker('/assets/js/workers/map-edit-worker.js?v=0.28.0-r3');
    let workerError = '';
    worker.addEventListener('error', event => { workerError = event.message || 'worker error'; });
    const ring = (left, right) => [[left, 0], [left, 2], [right, 2], [right, 0], [left, 0]];
    const ringArea = coordinates => coordinates.slice(0, -1).reduce((sum, coordinate, index) => {
      const next = coordinates[index + 1];
      return sum + coordinate[0] * next[1] - next[0] * coordinate[1];
    }, 0) / 2;
    const hasCanonicalWinding = geometry => {
      const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.coordinates || [];
      return polygons.length > 0 && polygons.every(polygon => polygon.every((coordinates, index) => {
        const signedArea = ringArea(coordinates);
        return index === 0 ? signedArea < 0 : signedArea > 0;
      }));
    };
    const feature = (id, left, right) => ({
      type: 'Feature',
      properties: { editor_id: id, editor_name: id, pop_est: 1, gdp_md_est: 1 },
      geometry: { type: 'Polygon', coordinates: [ring(left, right)] },
    });
    const base = [feature('A', 0, 2), feature('B', 2, 4)];
    const send = (message, expectedType) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(workerError || `worker timeout: ${expectedType}`)), 30_000);
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
        canonicalWinding: [mergeDiscarded, annexAfterDiscard, newCountry, mergeCommitted]
          .filter(message => message.ok)
          .every(message => message.result.features.every(feature => hasCanonicalWinding(feature.geometry))),
        mergedSphericalArea: window.d3.geo.area(mergeDiscarded.result.features[0]),
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
  expect(result.canonicalWinding).toBe(true);
  expect(result.mergedSphericalArea).toBeLessThan(2 * Math.PI);
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

test('compact primary navigation and history controls share one horizontal top axis', async ({ page }) => {
  await page.setViewportSize(layouts[1].viewport);
  const errors = await openApp(page);
  const geometry = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const nav = box('.adaptive-nav');
    const history = box('#mapCommandToolbar');
    const view = box('.map-view-toolbar');
    const buttons = [...document.querySelectorAll('.adaptive-nav button')].map(button => button.getBoundingClientRect());
    return {
      nav: { top: nav.top, right: nav.right, height: nav.height },
      history: { top: history.top, left: history.left, height: history.height },
      view: { top: view.top, height: view.height },
      buttonTops: buttons.map(button => button.top),
      buttonLefts: buttons.map(button => button.left),
    };
  });
  expect(geometry.nav.top).toBe(geometry.history.top);
  expect(geometry.history.top).toBe(geometry.view.top);
  expect(geometry.nav.height).toBe(geometry.history.height);
  expect(geometry.history.height).toBe(geometry.view.height);
  expect(geometry.history.left - geometry.nav.right).toBe(8);
  expect(new Set(geometry.buttonTops).size).toBe(1);
  expect(geometry.buttonLefts).toEqual([...geometry.buttonLefts].sort((a, b) => a - b));
  await page.locator('#mobileMapBtn').click();
  await expect.poll(async () => {
    const panel = await page.locator('#leftPanel').boundingBox();
    const workspace = await page.locator('.workspace').boundingBox();
    return Math.round(panel.x - workspace.x);
  }).toBe(8);
  const panel = await page.locator('#leftPanel').boundingBox();
  const workspace = await page.locator('.workspace').boundingBox();
  expect(panel.x - workspace.x).toBe(8);
  expect(panel.y - workspace.y).toBe(74);
  expect(errors).toEqual([]);
});

test('wide editor toggle stays attached to the viewport and open drawer edge', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const trigger = page.locator('#togglePanelBtn');
  const workspace = page.locator('.workspace');
  const closedTrigger = await trigger.boundingBox();
  const workspaceBox = await workspace.boundingBox();
  expect(Math.abs(closedTrigger.x + closedTrigger.width - (workspaceBox.x + workspaceBox.width))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(closedTrigger.y + closedTrigger.height / 2 - (workspaceBox.y + workspaceBox.height / 2))).toBeLessThanOrEqual(0.5);
  await trigger.click();
  await expect(page.locator('#rightPanel')).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-label', '편집창 닫기');
  await expect.poll(async () => {
    const openTrigger = await trigger.boundingBox();
    const panel = await page.locator('#rightPanel').boundingBox();
    return Math.abs(openTrigger.x + openTrigger.width - panel.x);
  }).toBeLessThanOrEqual(0.5);
  const openTrigger = await trigger.boundingBox();
  const panel = await page.locator('#rightPanel').boundingBox();
  expect(Math.abs(openTrigger.x + openTrigger.width - panel.x)).toBeLessThanOrEqual(0.5);
  await trigger.click();
  await expect(page.locator('#rightPanel')).not.toBeVisible();
  await expect(trigger).toHaveAttribute('aria-label', '편집창 열기');
  expect(errors).toEqual([]);
});

test('wide editor remains the only active surface after switching to compact', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  await page.locator('#togglePanelBtn').click();
  await expect(page.locator('#rightPanel')).toBeVisible();
  await page.setViewportSize(layouts[1].viewport);
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'compact');
  await expect(page.locator('#rightPanel')).toBeVisible();
  await expect(page.locator('#leftPanel')).not.toBeVisible();
  await expect(page.locator('.adaptive-nav button.sheet-open')).toHaveCount(1);
  await expect(page.locator('#mobileEditBtn')).toHaveAttribute('aria-expanded', 'true');
  expect(errors).toEqual([]);
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

test('sheet titles match object titles and mobile zoom dock has symmetric insets', async ({ page }) => {
  await page.setViewportSize(layouts[2].viewport);
  const errors = await openApp(page);
  const metrics = await page.evaluate(() => {
    const fontSize = selector => getComputedStyle(document.querySelector(selector)).fontSize;
    const dock = document.querySelector('.mobile-zoom-dock').getBoundingClientRect();
    const button = document.querySelector('.mobile-zoom-dock button').getBoundingClientRect();
    return {
      fontSizes: [fontSize('#mapSheetTitle'), fontSize('#editSheetTitle'), fontSize('#propertyTitle')],
      leftInset: button.left - dock.left,
      rightInset: dock.right - button.right,
    };
  });
  expect(metrics.fontSizes).toEqual(['18px', '18px', '18px']);
  expect(Math.abs(metrics.leftInset - metrics.rightInset)).toBeLessThanOrEqual(0.5);
  expect(errors).toEqual([]);
});

test('terrain retries a transient high-resolution tile failure and reaches the target level', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  let failedUrl = '';
  const attempts = new Map();
  await page.route('**/terrain/v0.12.6/**/*.webp*', async route => {
    const url = route.request().url();
    const count = (attempts.get(url) || 0) + 1;
    attempts.set(url, count);
    const level = Number(/\/v0\.12\.6\/(\d+)\//.exec(url)?.[1] || 0);
    if (!failedUrl && level > 0) {
      failedUrl = url;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  const errors = await openApp(page);
  await expect.poll(async () => page.evaluate(() => {
    const metrics = window.__ATLASWRIGHT_GPU_METRICS__ || {};
    return metrics.terrainTargetTileCount > 0
      && metrics.terrainTargetTilesLoaded === metrics.terrainTargetTileCount
      && metrics.terrainRenderedLevel === metrics.terrainLevel;
  }), { timeout: 30_000 }).toBe(true);
  expect(failedUrl).not.toBe('');
  expect(attempts.get(failedUrl)).toBeGreaterThanOrEqual(2);
  expect(errors.filter(message => !message.includes('net::ERR_FAILED'))).toEqual([]);
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

test('layer folders are grouped into scan-friendly non-collapsible categories', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const categories = page.locator('.layer-category');
  await expect(categories.locator('.layer-category-title')).toHaveText(['영토·구역', '인문 분포', '지도 요소', '라벨']);
  await expect(categories.nth(0).locator('.layer-folder-name')).toHaveText(['국가', '지역', '행정구역', '역사·지리 지역']);
  await expect(categories.nth(1).locator('.layer-folder-name')).toHaveText(['언어', '민족', '종교']);
  await expect(categories.nth(2).locator('.layer-folder-name')).toHaveText(['지형 음영', '지형지물']);
  await expect(categories.nth(3).locator('.layer-folder-name')).toHaveText(['도시·지명', '국가명 라벨']);
  await expect(categories.locator('.layer-category-title button, .layer-category-title input')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('themed dropdowns preserve native values and search long dynamic option lists', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const nativeSelectCount = await page.locator('select').count();
  await expect(page.locator('.ui-select-shell')).toHaveCount(nativeSelectCount);
  await expect(page.locator('select.ui-native-select')).toHaveCount(nativeSelectCount);

  const shortControl = page.locator('#labelKindInput').locator('..').locator('.ui-select-control');
  await expect(shortControl).toHaveJSProperty('readOnly', true);

  const properties = Object.fromEntries([
    'aw_capital', 'aw_color', 'aw_id', 'aw_name', 'aw_notes', 'aw_object_class', 'continent',
    'editor_color', 'editor_custom', 'editor_id', 'editor_name', 'editor_original_name', 'gdp_md_est',
    'id', 'iso_a3', 'map_date', 'name', 'name_long', 'object_class', 'pop_est',
  ].map((key, index) => [key, index]));
  await page.locator('#geoJsonFileInput').setInputFiles({
    name: 'searchable-fields.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: [0, 0] },
      }],
    })),
  });
  await expect(page.locator('#geoJsonTargetModal')).toBeVisible();

  const nameSelect = page.locator('#geoJsonNameField');
  const nameControl = nameSelect.locator('..').locator('.ui-select-control');
  await expect(nameControl).toHaveJSProperty('readOnly', false);
  await nameControl.click();
  await nameControl.fill('name');
  const openPopover = page.locator('.ui-select-popover:not([hidden])');
  await expect(openPopover.getByRole('option')).toHaveText(['name', 'name_long', 'aw_name', 'editor_name', 'editor_original_name']);
  await openPopover.getByRole('option', { name: 'name', exact: true }).click();
  await expect(nameSelect).toHaveValue('name');

  const targetSelect = page.locator('#geoJsonTargetType');
  const targetControl = targetSelect.locator('..').locator('.ui-select-control');
  await expect(targetControl).toHaveJSProperty('readOnly', true);
  await targetControl.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#geoJsonTargetModal')).toBeVisible();
  await expect(page.locator('.ui-select-popover:not([hidden])')).toHaveCount(0);
  await targetControl.click();
  await page.locator('.ui-select-popover:not([hidden])').getByRole('option', { name: '지역', exact: true }).click();
  await expect(targetSelect).toHaveValue('region');
  await expect(page.locator('#geoJsonCountryFieldRow')).toBeVisible();
  expect(errors).toEqual([]);
});

test('virtualized layer selection and search results preserve scroll and accessible selection state', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const folderToggle = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await folderToggle.getAttribute('aria-expanded') !== 'true') await folderToggle.click();
  await page.locator('#countriesLocked').uncheck({ force: true });
  const list = page.locator('#countriesLayerChildren');
  await list.evaluate(element => { element.scrollTop = 2400; });
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(2000);
  const target = list.locator('.layer-child-name').nth(6);
  const targetName = (await target.textContent()).trim();
  const before = await list.evaluate(element => element.scrollTop);
  await target.click();
  const after = await list.evaluate(element => element.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  await expect(page.locator('#countriesLayerChildren .layer-child.is-selected .layer-child-name')).toHaveText(targetName);

  const search = page.locator('#layerSearchInput');
  await search.fill(targetName);
  const result = page.locator('.layer-search-result').first();
  await result.click();
  await expect(result).toHaveAttribute('aria-selected', 'true');
  const colors = await result.evaluate(element => ({
    row: getComputedStyle(element).color,
    name: getComputedStyle(element.querySelector('strong')).color,
    group: getComputedStyle(element.querySelector('span')).color,
    background: getComputedStyle(element).backgroundColor,
  }));
  expect(colors.name).toBe(colors.row);
  expect(colors.group).not.toBe('rgb(102, 113, 125)');
  expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(errors).toEqual([]);
});

test('shared color picker applies presets, restores defaults, and participates in undo', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const folderToggle = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await folderToggle.getAttribute('aria-expanded') !== 'true') await folderToggle.click();
  await page.locator('#countriesLocked').uncheck({ force: true });
  await page.locator('#countriesLayerChildren .layer-child-name').first().click();
  await page.locator('#countryColorTrigger').click();
  await expect(page.locator('#countryColorPopover')).toBeVisible();
  await page.locator('#countryColorPopover [data-color-value="#dc2626"]').click();
  await expect(page.locator('#countryColorInput')).toHaveValue('#dc2626');
  await expect(page.locator('#countryColorValue')).toHaveText('#DC2626');
  await page.locator('#countryColorTrigger').click();
  await page.locator('#countryColorPopover [data-color-default]').click();
  await expect(page.locator('#countryColorValue')).toHaveText('기본 색상');
  await page.locator('#undoBtn').click();
  await expect(page.locator('#redoBtn')).toBeEnabled();
  await expect(page.locator('#countryProperties')).toBeHidden();
  expect(errors).toEqual([]);
});

test('mobile sheets share one default snap, reset on reopen, and map actions dismiss them', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(layouts[2].viewport);
  const errors = await openApp(page);
  const openSheet = async (button, panel) => {
    if (await page.locator(button).getAttribute('aria-expanded') !== 'true') await page.locator(button).click();
    await expect(page.locator(panel)).toBeVisible();
    return page.locator(panel).evaluate(element => element.getBoundingClientRect().height);
  };
  const layerHeight = await openSheet('#mobileMapBtn', '#leftPanel');
  const createHeight = await openSheet('#mobileCreateBtn', '#createMenu');
  const editHeight = await openSheet('#mobileEditBtn', '#rightPanel');
  expect(Math.max(layerHeight, createHeight, editHeight) - Math.min(layerHeight, createHeight, editHeight)).toBeLessThanOrEqual(1);
  expect(editHeight).toBeGreaterThan(500);

  await page.getByRole('slider', { name: '편집창 높이 조절' }).press('ArrowUp');
  const raisedHeight = await page.locator('#rightPanel').evaluate(element => element.getBoundingClientRect().height);
  expect(raisedHeight).toBeGreaterThan(editHeight);
  await page.locator('#mobileCloseRightBtn').click();
  const reopenedHeight = await openSheet('#mobileEditBtn', '#rightPanel');
  expect(Math.abs(reopenedHeight - editHeight)).toBeLessThanOrEqual(1);

  await openSheet('#mobileMapBtn', '#leftPanel');
  await page.locator('#countriesLocked').uncheck({ force: true });
  const folderToggle = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await folderToggle.getAttribute('aria-expanded') !== 'true') await folderToggle.click();
  await page.locator('#countriesLayerChildren .layer-child-name').first().click();
  await expect(page.locator('#leftPanel')).not.toBeVisible();
  await expect(page.locator('#mobileMapBtn')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#map')).toBeFocused();

  await openSheet('#mobileMapBtn', '#leftPanel');
  await page.locator('#countriesVisible').click();
  await expect(page.locator('#leftPanel')).toBeVisible();

  await openSheet('#mobileCreateBtn', '#createMenu');
  await page.locator('#addRiverBtn').click();
  await expect(page.locator('#createMenu')).not.toBeVisible();
  await expect(page.locator('#map')).toBeFocused();
  expect(errors).toEqual([]);
});

test('GeoJSON imports use file folders, move between drawing folders, and disappear immediately after deletion', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const featureCollection = name => JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: `${name}-feature`,
      properties: { name, category: 'river' },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    }],
  });
  const importFile = async name => {
    await page.locator('#geoJsonFileInput').setInputFiles({
      name: `${name}.geojson`,
      mimeType: 'application/geo+json',
      buffer: Buffer.from(featureCollection(name)),
    });
    await expect(page.locator('#geoJsonTargetModal')).toBeVisible();
    await expect(page.locator('#geoJsonTargetType')).toHaveValue('drawing');
    await page.locator('#geoJsonTargetConfirmBtn').click();
    const folder = page.locator('.layer-folder[data-drawing-folder-id]').filter({ hasText: name });
    await expect(folder).toHaveCount(1);
    expect(await folder.evaluate(element => element.parentElement?.id)).toBe('mapElementsLayerItems');
    await expect(folder.locator('.layer-child-name')).toHaveText(name);
    return folder;
  };

  const disposable = await importFile('삭제확인');
  await disposable.locator('.layer-child-name').click();
  await disposable.locator('.layer-child-delete').click();
  await expect(page.locator('.layer-folder[data-drawing-folder-id]').filter({ hasText: '삭제확인' })).toHaveCount(0);

  const target = await importFile('이동대상');
  const source = await importFile('이동원본');
  const targetId = await target.getAttribute('data-drawing-folder-id');
  await source.locator('.layer-child-name').click();
  await page.locator('#drawingFolderInput').selectOption(targetId);
  await expect(page.locator('.layer-folder[data-drawing-folder-id]').filter({ hasText: '이동원본' })).toHaveCount(0);
  const updatedTarget = page.locator(`.layer-folder[data-drawing-folder-id="${targetId}"]`);
  if (await updatedTarget.locator('.layer-folder-toggle').getAttribute('aria-expanded') !== 'true') {
    await updatedTarget.locator('.layer-folder-toggle').click();
  }
  await expect(updatedTarget.locator('.layer-child-name')).toHaveCount(2);
  await expect(page.locator('#drawingFolderInput option')).toHaveText(['지형지물', '이동대상']);
  expect(errors).toEqual([]);
});

test('GeoJSON polygon imports create dedicated country regions with inferred ownership', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const polygon = JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: 'region-import-smoke',
      properties: { name: '시험 지역' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[19, 50], [19, 51], [20, 51], [20, 50], [19, 50]]],
      },
    }],
  });

  await page.locator('#geoJsonFileInput').setInputFiles({
    name: 'region-smoke.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(polygon),
  });
  await page.locator('#geoJsonTargetType').selectOption('region');
  await page.locator('#geoJsonTargetConfirmBtn').click();

  const regionToggle = page.locator('[data-layer-folder-toggle="regions"]').first();
  if (await regionToggle.getAttribute('aria-expanded') !== 'true') await regionToggle.click();
  const importedName = page.locator('#regionsLayerChildren .layer-child-name').filter({ hasText: '시험 지역' });
  await expect(importedName).toHaveCount(1);
  await expect(page.locator('#regionsLayerChildren .layer-subfolder-row')).toHaveCount(1);
  await expect(page.locator('#regionsLayerChildren')).toContainText('미지정 지역');
  const countrySubfolder = page.locator('#regionsLayerChildren [data-country-region-folder-toggle]');
  await countrySubfolder.click();
  await expect(countrySubfolder).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#regionsLayerChildren .layer-child')).toHaveCount(0);
  await countrySubfolder.click();
  await expect(page.locator('#regionsLayerChildren .layer-child')).toHaveCount(2);

  const importedRow = page.locator('#regionsLayerChildren .layer-child').filter({ hasText: '시험 지역' });
  await importedRow.locator('.layer-child-delete').click();
  await expect(page.locator('#confirmModalChoice')).toHaveValue('unassigned');
  await expect(page.locator('#confirmModalChoice option')).toHaveText(['미지정 영역으로 전환', '이 단계의 영역 구분 전체 해제']);
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('#regionsLayerChildren .layer-child-name').filter({ hasText: '시험 지역' })).toHaveCount(0);
  await expect(page.locator('#regionsLayerChildren .layer-child-name').filter({ hasText: '미지정 지역' })).toHaveCount(1);

  await page.locator('#undoBtn').click();
  await expect(page.locator('#regionsLayerChildren .layer-child-name').filter({ hasText: '시험 지역' })).toHaveCount(1);
  expect(errors).toEqual([]);
});
