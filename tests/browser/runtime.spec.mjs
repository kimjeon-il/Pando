import { expect, test } from '@playwright/test';

const layouts = [
  { name: 'wide', viewport: { width: 1440, height: 900 } },
  { name: 'compact', viewport: { width: 1024, height: 800 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
];

async function openApp(page, { waitForCanonical = true, url = '/' } = {}) {
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
  await page.goto(url);
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  if (waitForCanonical) await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  return errors;
}

async function editorTypographySnapshot(page) {
  return page.evaluate(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    const font = selector => {
      const computed = style(selector);
      return [computed.fontSize, computed.fontWeight];
    };
    const formIds = [
      'countryProperties', 'territoryProperties', 'administrativeProperties', 'regionProperties',
      'distributionProperties', 'genericFeatureProperties', 'labelProperties', 'hydroProperties',
    ];
    return {
      unifiedForms: formIds.every(id => document.getElementById(id)?.classList.contains('editor-object-form')),
      flatSections: formIds.every(id => (
        [...document.getElementById(id).children]
          .filter(element => element.classList.contains('editor-section'))
          .every(element => !element.classList.contains('ui-card'))
      )),
      objectTitle: font('#propertyTitle'),
      objectType: font('#propertyTypeLabel'),
      sectionTitle: font('#territoryGeometryActionsTitle'),
      propertyLabel: font('label[for="countryNameInput"]'),
      editableValue: font('#countryNameInput'),
      readonlyLabel: font('.editor-property-list span'),
      readonlyValue: font('#countryAreaValue'),
      distributionType: font('#distributionTypeValue'),
      metaLabel: font('.editor-meta-list span'),
      metaValue: font('#countryCodeInput'),
      helper: font('#territoryNameConflict'),
      colorValue: font('#countryColorValue'),
      propertyHeading: font('.editor-property-heading'),
      disclosure: font('#countryProperties > .editor-disclosure > summary'),
      periodHeading: font('.editor-period-group > legend'),
      periodSubfield: font('label[for="regionValidFromInput"]'),
    };
  });
}

test('bootstrap loading card keeps fixed copy and only changes for real startup errors', async ({ page }) => {
  let workerMode = 'pending';
  await page.route('**/assets/js/workers/data-loader-worker.js*', route => {
    const body = workerMode === 'error'
      ? "self.postMessage({ type: 'preview-error', message: '테스트 시작 오류' });"
      : 'setInterval(() => {}, 1000);';
    return route.fulfill({ contentType: 'text/javascript', body });
  });

  for (const { viewport, colorScheme } of [
    { viewport: layouts[0].viewport, colorScheme: 'light' },
    { viewport: layouts[2].viewport, colorScheme: 'dark' },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.locator('#bootstrapLoading')).toBeVisible();
    const card = await page.locator('.bootstrap-loading-card').evaluate(element => {
      const text = element.querySelector('#bootstrapLoadingText');
      const probe = element.querySelector('#startupProbe');
      const progress = element.querySelector('.bootstrap-progress');
      const style = node => getComputedStyle(node);
      return {
        order: [...element.children].map(child => child.id || child.className),
        text: text.textContent,
        probe: probe.textContent,
        textAlign: style(text).textAlign,
        probeAlign: style(probe).textAlign,
        textFont: [style(text).fontSize, style(text).fontWeight],
        probeFont: [style(probe).fontSize, style(probe).fontWeight],
        progressHeight: style(progress).height,
        progressBelowCopy: progress.getBoundingClientRect().top > probe.getBoundingClientRect().bottom,
      };
    });
    expect(card.order).toEqual(['bootstrapLoadingText', 'startupProbe', 'ui-progress bootstrap-progress']);
    expect(card.text).toBe('지도를 표시하는 중입니다');
    expect(card.probe).toBe('잠시만 기다려 주세요');
    expect(card.textAlign).toBe('center');
    expect(card.probeAlign).toBe('center');
    expect(card.textFont).toEqual(['15px', '600']);
    expect(card.probeFont).toEqual(['13px', '400']);
    expect(card.progressHeight).toBe('4px');
    expect(card.progressBelowCopy).toBe(true);
    await page.waitForTimeout(350);
    await expect(page.locator('#bootstrapLoadingText')).toHaveText('지도를 표시하는 중입니다');
    await expect(page.locator('#startupProbe')).toHaveText('잠시만 기다려 주세요');
  }

  workerMode = 'error';
  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveClass(/error/);
  await expect(page.locator('#bootstrapLoadingText')).toHaveText('지도를 불러오지 못했습니다');
  await expect(page.locator('#startupProbe')).toHaveText('페이지를 새로고침해 다시 시도해 주세요');
});

for (const layout of layouts) {
  for (const colorScheme of ['light', 'dark']) {
    test(`${layout.name} ${colorScheme} boots without runtime errors`, async ({ page }) => {
      await page.setViewportSize(layout.viewport);
      await page.emulateMedia({ colorScheme });
      const errors = await openApp(page);
      await expect(page.locator('#app')).toHaveAttribute('data-layout', layout.name);
      const typography = await editorTypographySnapshot(page);
      expect(typography.unifiedForms).toBe(true);
      expect(typography.flatSections).toBe(true);
      expect(typography.objectTitle).toEqual(['18px', '700']);
      expect(typography.objectType).toEqual(['15px', '400']);
      expect(typography.sectionTitle).toEqual(['16px', '700']);
      expect(typography.propertyLabel).toEqual(['14px', '500']);
      expect(typography.editableValue).toEqual(['15px', '400']);
      expect(typography.readonlyLabel).toEqual(['14px', '500']);
      expect(typography.readonlyValue).toEqual(['15px', '600']);
      expect(typography.distributionType).toEqual(['15px', '600']);
      expect(typography.metaLabel).toEqual(['13px', '400']);
      expect(typography.metaValue).toEqual(['13px', '600']);
      expect(typography.helper).toEqual(['13px', '400']);
      expect(typography.colorValue).toEqual(['15px', '400']);
      expect(typography.propertyHeading).toEqual(['14px', '500']);
      expect(typography.disclosure).toEqual(['14px', '500']);
      expect(typography.periodHeading).toEqual(['14px', '500']);
      expect(typography.periodSubfield).toEqual(['13px', '500']);
      expect(errors).toEqual([]);
    });
  }
}

test('annex territory exposes river boundaries as a retained component-selection option', async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page, { url: '/?debug=1', waitForCanonical: false });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await page.locator('#actionsTabBtn').click();
  await page.locator('#annexTerritoryBtn').click();
  await expect(page.locator('#modeTaskStage')).toHaveText('대상 국가 선택');
  const donorPoint = await page.evaluate(() => {
    const anchor = window.__PANDOLAB_VIEW_DEBUG__.countryLabelAnchor('POL');
    return window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(anchor);
  });
  const mapBox = await page.locator('#map').boundingBox();
  await page.mouse.click(mapBox.x + donorPoint[0], mapBox.y + donorPoint[1]);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();

  await expect(page.locator('#modeMethodSwitch .mode-method-btn')).toHaveCount(3);
  await expect(page.locator('#modeRiverMethodBtn')).toHaveCount(0);
  await expect(page.locator('#modeRiverBoundaryOption')).toBeHidden();
  await page.locator('#modeComponentsMethodBtn').click();
  await expect(page.locator('#modeRiverBoundaryOption')).toBeVisible();
  await expect(page.locator('#modeRiverBoundaryInput')).not.toBeChecked();
  const components = page.locator('.draft-layer path.territory-component');
  await expect(components.first()).toBeVisible();
  await page.waitForTimeout(500);
  await components.first().evaluate(element => element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: -1000, clientY: -1000,
  })));
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();

  await page.locator('#modeRiverBoundaryInput').check();
  await expect(page.locator('#modeRiverBoundaryInput')).toBeChecked();
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await expect(page.locator('#modeTaskInstruction')).toContainText('계산하는 중');
  await expect(page.locator('#modeTaskInstruction')).not.toContainText('계산하는 중', { timeout: 120_000 });
  await expect(components.first()).toBeVisible();
  await page.waitForTimeout(500);
  await components.first().evaluate(element => element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: -1000, clientY: -1000,
  })));
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modeLineMethodBtn').click();
  await expect(page.locator('#modeRiverBoundaryOption')).toBeHidden();
  await page.locator('#modeComponentsMethodBtn').click();
  await expect(page.locator('#modeRiverBoundaryInput')).toBeChecked();
  await expect(components.first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await page.locator('#modeRiverBoundaryInput').uncheck();
  await expect(page.locator('#modeTaskInstruction')).toContainText('편입할 영토 조각');
  await page.waitForTimeout(500);
  await components.first().evaluate(element => element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: -1000, clientY: -1000,
  })));
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Enter');
  await expect(page.locator('#modePrimaryBtn')).toContainText('변경 적용', { timeout: 120_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#modeActionBar')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#actionStatus')).toContainText('영토 조각');
  expect(errors).toEqual([]);
});

test('narrow mobile widths keep the editor type scale instead of shrinking text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openApp(page, { waitForCanonical: false });
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 780 });
    await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
    const typography = await editorTypographySnapshot(page);
    expect(typography.objectTitle).toEqual(['18px', '700']);
    expect(typography.objectType).toEqual(['15px', '400']);
    expect(typography.propertyLabel).toEqual(['14px', '500']);
    expect(typography.editableValue).toEqual(['15px', '400']);
    expect(typography.readonlyValue).toEqual(['15px', '600']);
    expect(typography.metaValue).toEqual(['13px', '600']);
  }
  expect(errors).toEqual([]);
});

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
      ? freshHtml.replace('data-app-version="0.30.0"', 'data-app-version="0.24.0"')
      : freshHtml;
    await route.fulfill({ response, body });
  });
  await page.goto('/?stale-shell=1');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  expect(shellRequests).toBe(2);
  expect(new URL(page.url()).searchParams.has('_pandolab_cache')).toBe(false);
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
  expect(audit.moduleUrls.every(url => new URL(url).searchParams.get('v') === '0.30.0-r41')).toBe(true);
  expect(errors).toEqual([]);
});

test('country edit worker executes annex, new-country, merge, commit, discard, and failure paths', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__map-edit-worker-test.html', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>map edit worker test</title><script src="/assets/js/vendor/d3.min.js"></script>',
  }));
  await page.goto('/__map-edit-worker-test.html');
  const result = await page.evaluate(async () => {
  const worker = new Worker('/assets/js/workers/map-edit-worker.js?v=0.30.0-r41');
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
    let dataRevision = 0;
    const rebase = async revision => {
      const result = await send({ type: 'rebase', features: base, dataRevision: revision }, 'ready');
      dataRevision = revision;
      return result;
    };
    const execute = (requestId, operation, payload) => send({
      type: 'execute', requestId, jobKey: `test:${operation}`, dataRevision,
      geometryRevision: dataRevision, targetRevision: dataRevision, operation, ...payload,
    }, 'result');
    const commit = requestId => {
      worker.postMessage({ type: 'commit', requestId, dataRevision, nextDataRevision: dataRevision + 1 });
      dataRevision += 1;
    };
    try {
      await rebase(1);
      const mergeDiscarded = await execute(1, 'merge', { sourceId: 'A', targetIds: ['B'] });
      worker.postMessage({ type: 'discard', requestId: 1 });
      const annexAfterDiscard = await execute(2, 'annex', {
        targetId: 'B', donorIds: ['A'], transferredGeometry: { type: 'Polygon', coordinates: [ring(1, 2)] },
      });
      commit(2);

      await rebase(3);
      const newCountry = await execute(3, 'new-country', {
        sourceIds: ['A'], transferredGeometry: { type: 'Polygon', coordinates: [ring(0, 1)] },
        newFeature: feature('N', 0, 1),
      });
      worker.postMessage({ type: 'discard', requestId: 3 });

      await rebase(4);
      const mergeCommitted = await execute(4, 'merge', { sourceId: 'A', targetIds: ['B'] });
      commit(4);
      const mergeAfterCommit = await execute(5, 'merge', { sourceId: 'A', targetIds: ['B'] });
      const invalid = await execute(6, 'annex', {
        targetId: 'missing', donorIds: ['A'], transferredGeometry: { type: 'Polygon', coordinates: [ring(0, 1)] },
      });
      return {
        mergeDiscarded, annexAfterDiscard, newCountry, mergeCommitted, mergeAfterCommit, invalid,
        canonicalWinding: [mergeDiscarded, annexAfterDiscard, newCountry, mergeCommitted]
          .filter(message => message?.ok && message.result)
          .every(message => message.result.features.every(feature => hasCanonicalWinding(feature.geometry))),
        mergedSphericalArea: mergeDiscarded?.result?.features?.[0]
          ? window.d3.geo.area(mergeDiscarded.result.features[0])
          : null,
      };
    } finally {
      worker.terminate();
    }
  });
  expect(result.mergeDiscarded.ok, JSON.stringify(result.mergeDiscarded)).toBe(true);
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

test('river territory partition Worker returns disjoint donor cells', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const worker = new Worker('/assets/js/workers/river-territory-partition-worker.js?v=0.30.0-r41', { type: 'module' });
    const donor = {
      countryId: 'donor', geometryRevision: 1,
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    };
    const rivers = [
      { type: 'Feature', id: 'vertical', properties: { category: 'river' }, geometry: { type: 'LineString', coordinates: [[0.5, -1], [0.5, 2]] } },
      { type: 'Feature', id: 'horizontal', properties: { category: 'river' }, geometry: { type: 'LineString', coordinates: [[-1, 0.5], [2, 0.5]] } },
    ];
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('river territory partition Worker timeout')), 15_000);
      worker.addEventListener('error', event => {
        clearTimeout(timer);
        reject(new Error(event.message || 'river territory partition Worker error'));
      });
      worker.addEventListener('message', event => {
        clearTimeout(timer);
        worker.terminate();
        if (event.data?.type === 'error') reject(new Error(event.data.message));
        else resolve(event.data?.result || null);
      }, { once: true });
      worker.postMessage({ type: 'compute', requestId: 1, payload: { donors: [donor], riverFeatures: rivers, hydroRevision: 'browser' } });
    });
  });
  expect(result.candidates).toHaveLength(4);
  expect(new Set(result.candidates.map(candidate => candidate.key)).size).toBe(4);
  expect(result.candidates.every(candidate => candidate.donorCountryId === 'donor')).toBe(true);
  expect(result.candidates.every(candidate => candidate.algorithmRevision === 'river-partitions-v1')).toBe(true);
  expect(result.donorResults).toEqual([{ donorCountryId: 'donor', status: 'ready', candidateCount: 4, reason: '' }]);
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

test('brand frame stays empty and every add action renders a unique icon', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  await expect(page).toHaveTitle('판도연구소 — 국가와 국경을 만드는 세계지도 편집기');
  await expect(page.locator('.brand > div:last-child strong')).toHaveText('판도연구소');
  const brandMark = page.locator('.brand-mark');
  await expect(brandMark).toBeVisible();
  expect(await brandMark.evaluate(element => element.childElementCount)).toBe(0);
  const brandBox = await brandMark.boundingBox();
  expect(brandBox?.width).toBe(34);
  expect(brandBox?.height).toBe(34);

  await page.locator('#createMenuBtn').click();
  const iconHrefs = await page.locator('#createMenu .create-menu-item use').evaluateAll(elements => (
    elements.map(element => element.getAttribute('href'))
  ));
  expect(iconHrefs).toHaveLength(8);
  expect(new Set(iconHrefs).size).toBe(8);
  for (const href of iconHrefs) {
    expect(href).toMatch(/^#icon-/);
    await expect(page.locator(`symbol${href}`)).toHaveCount(1);
  }
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

test('projection control stays in the map view and uses one segmented geometry in every layout', async ({ page }) => {
  for (const pattern of ['**/countries-ne-5.1.1.geojson*', '**/world-mesh-v0.12.6.bin.gz*']) {
    await page.route(pattern, route => route.abort('failed'));
  }
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page, { waitForCanonical: false });
  const measureProjection = () => page.evaluate(() => {
    const host = document.querySelector('#mapViewProjectionSlot').getBoundingClientRect();
    const control = document.querySelector('#projectionControl');
    const controlBox = control.getBoundingClientRect();
    const controlStyle = getComputedStyle(control);
    const segments = ['#globeBtn', '#flatBtn'].map(selector => {
      const button = document.querySelector(selector);
      const box = button.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        borderRadius: getComputedStyle(button).borderRadius,
      };
    });
    return {
      host: { width: host.width, height: host.height },
      control: {
        width: controlBox.width,
        height: controlBox.height,
        borderWidth: controlStyle.borderTopWidth,
        padding: controlStyle.padding,
      },
      segments,
    };
  });

  for (const layout of layouts) {
    await page.setViewportSize(layout.viewport);
    await expect(page.locator('#app')).toHaveAttribute('data-layout', layout.name);
    if (!await page.locator('#leftPanel').isVisible()) await page.locator('#mobileMapBtn').click();
    await page.locator('#mapViewTabBtn').click();
    await expect(page.locator('#mapViewSection')).toBeVisible();
    await expect.poll(() => page.locator('#projectionControl').evaluate(control => control.parentElement?.id)).toBe('mapViewProjectionSlot');
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      const geometry = await measureProjection();
      expect(geometry.control.borderWidth).toBe('1px');
      expect(geometry.control.width).toBeCloseTo(geometry.host.width, 0);
      expect(geometry.control.height).toBeGreaterThanOrEqual(layout.name === 'mobile' ? 48 : 40);
      for (const segment of geometry.segments) {
        expect(segment.width).toBeGreaterThan(0);
        expect(segment.height).toBeGreaterThan(0);
        expect(parseFloat(segment.borderRadius)).toBeGreaterThan(0);
      }
    }
  }

  await page.locator('#flatBtn').click();
  await expect(page.locator('#flatBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#globeBtn')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('common row buttons, headers, cards, and checkboxes keep their component geometry', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const layout of layouts) {
    const context = await browser.newContext({ viewport: layout.viewport });
    const page = await context.newPage();
    try {
      const errors = await openApp(page, { waitForCanonical: false, url: '/?renderer=canvas' });
      const createTrigger = layout.name === 'wide' ? '#createMenuBtn' : '#mobileCreateBtn';
      await page.locator(createTrigger).click();
      const geometry = await page.evaluate(() => {
      const item = document.querySelector('#addCountryBtn');
      const body = document.querySelector('#createMenu .map-sheet-body');
      const checkbox = document.querySelector('#countriesVisible');
      const checkboxControl = checkbox.closest('.layer-visibility-control');
      const checkboxIcon = checkboxControl.querySelector('.layer-visibility-eye');
      const itemStyle = getComputedStyle(item);
      const bodyStyle = getComputedStyle(body);
      const checkStyle = getComputedStyle(checkboxControl);
      return {
        itemWidth: item.getBoundingClientRect().width,
        bodyInnerWidth: body.clientWidth - Number.parseFloat(bodyStyle.paddingLeft) - Number.parseFloat(bodyStyle.paddingRight),
        itemHeight: item.getBoundingClientRect().height,
        itemBoxSizing: itemStyle.boxSizing,
        checkSize: [checkboxControl.getBoundingClientRect().width, checkboxControl.getBoundingClientRect().height],
        checkBorder: checkStyle.borderTopWidth,
        checkShadow: checkStyle.boxShadow,
        checkBackground: checkStyle.backgroundColor,
        checkIconWidth: checkboxIcon.getBoundingClientRect().width,
        checkIconHref: checkboxIcon.querySelector('use').getAttribute('href'),
        flatObjectSections: [...document.querySelectorAll('.editor-object-form > .editor-section')].every(section => !section.classList.contains('ui-card')),
        unifiedObjectForms: [...document.querySelectorAll('.editor-view:not(.multi-properties)')].every(view => view.classList.contains('editor-object-form')),
      };
      });
      if (layout.name !== 'mobile') expect(Math.abs(geometry.itemWidth - geometry.bodyInnerWidth)).toBeLessThanOrEqual(1);
      expect(geometry.itemHeight).toBe(layout.name === 'mobile' ? 68 : 64);
      expect(geometry.itemBoxSizing).toBe('border-box');
      expect(geometry.checkSize).toEqual(layout.name === 'mobile' ? [48, 48] : [42, 42]);
      expect(geometry.checkBorder).toBe('0px');
      expect(geometry.checkShadow).toBe('none');
      expect(geometry.checkBackground).toBe('rgba(0, 0, 0, 0)');
      expect(geometry.checkIconWidth).toBe(20);
      expect(geometry.checkIconHref).toBe('#icon-eye');
      expect(geometry.flatObjectSections).toBe(true);
      expect(geometry.unifiedObjectForms).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test('compact layer, create, and editor headers share the drawer header shell', async ({ page }) => {
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
        paddingBlock: [getComputedStyle(header).paddingTop, getComputedStyle(header).paddingBottom],
        closeTopInset: closeBox.top - headerBox.top,
        closeRightInset: headerBox.right - closeBox.right,
        titleRight: titleBox.right,
        closeLeft: closeBox.left,
      };
    }));
  }
  expect(measurements.map(value => value.height)).toEqual([74, 74, 74]);
  expect(measurements.map(value => value.paddingBlock)).toEqual([['16px', '16px'], ['16px', '16px'], ['16px', '16px']]);
  for (const value of measurements) {
    expect(Math.abs(value.closeTopInset - value.closeRightInset)).toBeLessThanOrEqual(1);
    expect(value.titleRight).toBeLessThanOrEqual(value.closeLeft - 8);
  }
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
    const metrics = window.__PANDOLAB_GPU_METRICS__ || {};
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
  const revision = () => page.evaluate(() => window.__PANDOLAB_VIEW_REVISION__ || 0);
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

test('virtualized country deletion honors per-object lock, undo, and autosave restore', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  await page.locator('[data-layer-folder-toggle="countries"]').first().click();
  const firstRow = page.locator('#countriesLayerChildren .layer-child').first();
  const name = await firstRow.locator('.layer-child-name').textContent();
  const countryId = await firstRow.getAttribute('data-item-id');
  await firstRow.locator('.layer-child-menu').click();
  await page.locator('#objectLockMenuBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.isLocked('country', id), countryId)).toBe(true);
  await expect(page.locator('#editorObjectHeader')).toBeVisible();
  await firstRow.locator('.layer-child-menu').click();
  await expect(page.locator('#objectDeleteMenuBtn')).toBeDisabled();
  await page.locator('#objectLockMenuBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.isLocked('country', id), countryId)).toBe(false);

  const deleteCountry = async () => {
    const row = page.getByRole('button', { name, exact: true }).locator('..');
    if (await page.locator('#objectActionsMenu').isHidden()) await row.locator('.layer-child-menu').click();
    await page.locator('#objectDeleteMenuBtn').click();
    await page.locator('#confirmModalOkBtn').click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  };
  await deleteCountry();
  await page.locator('#undoBtn').click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await deleteCountry();
  await expect.poll(() => page.evaluate(async expectedId => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const project = await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readonly');
        const request = transaction.objectStore('projects').get('active-project');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      return project?.countryDelta?.removedIds?.map(String).includes(String(expectedId)) === true;
    } finally {
      database.close();
    }
  }, countryId), { message: 'country deletion should reach autosave before reload', timeout: 10_000 }).toBe(true);
  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const countryFolderToggle = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await countryFolderToggle.getAttribute('aria-expanded') !== 'true') await countryFolderToggle.click();
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('layer folders expose presentation controls while global view settings stay in the map view', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const categories = page.locator('.layer-category');
  await expect(categories.locator('.layer-category-title')).toHaveText(['영토·구역', '인문 분포', '지형지물']);
  await expect(categories.nth(0).locator('.layer-folder-name')).toHaveText(['국가', '권역', '행정구역', '지방']);
  await expect(categories.nth(1).locator('.layer-folder-name')).toHaveText(['언어', '민족', '종교']);
  await expect(categories.nth(2).locator('.layer-folder-name')).toHaveText(['강', '호수', '기타 객체']);
  await expect(page.locator('#layerSection #terrainVisible')).toHaveCount(0);
  await expect(categories.locator('.layer-category-title button, .layer-category-title input')).toHaveCount(0);
  await expect(page.locator('[data-layer-style-toggle="countries"]')).toHaveCount(1);
  await expect(page.locator('[data-layer-style-toggle="rivers"]')).toHaveCount(1);
  await expect(page.locator('[data-layer-style-toggle="lakes"]')).toHaveCount(1);
  await expect(page.locator('[data-layer-style-toggle="labels"], [data-layer-style-toggle="countryLabels"]')).toHaveCount(0);
  await page.locator('#mapViewTabBtn').click();
  await expect(page.locator('#mapNameSettingsTitle')).toHaveText('이름 표시');
  await expect(page.locator('#mapViewSection label:has(#basemapLabelsVisible)')).toContainText('국가명 표시');
  await expect(page.locator('#mapViewSection label:has(#labelsVisible)')).toContainText('지명 표시');
  const terrainVisible = page.locator('#terrainVisible');
  const terrainOptions = page.locator('#terrainDisplayOptions');
  const terrainStrength = page.locator('#terrainStrengthInput');
  await expect(page.locator('#mapViewSection #terrainVisible')).toHaveCount(1);
  await expect(page.locator('label:has(#terrainVisible)')).toContainText('지형 음영 표시');
  await expect(terrainVisible).toHaveAttribute('aria-expanded', 'true');
  await expect(terrainOptions).toBeVisible();
  await expect(terrainStrength).toHaveJSProperty('value', '32');
  await expect.poll(() => terrainStrength.evaluate(input => getComputedStyle(input).getPropertyValue('--ui-range-progress').trim())).toBe('32%');
  await terrainStrength.evaluate(input => {
    input.value = '75';
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
  });
  await expect(page.locator('#terrainStrengthValue')).toHaveText('75%');
  await expect.poll(() => terrainStrength.evaluate(input => getComputedStyle(input).getPropertyValue('--ui-range-progress').trim())).toBe('75%');
  await terrainVisible.uncheck();
  await expect(terrainVisible).toHaveAttribute('aria-expanded', 'false');
  await expect(terrainOptions).toBeHidden();
  await terrainVisible.check();
  await expect(terrainOptions).toBeVisible();
  await expect(page.locator('#terrainStrengthValue')).toHaveText('75%');
  await page.locator('#terrainPhysicalRadio').check();
  await expect(page.locator('#terrainStrengthControl')).toBeHidden();
  await page.locator('#terrainPoliticalRadio').check();
  await expect(page.locator('#terrainStrengthControl')).toBeVisible();
  for (const layout of layouts.slice(1)) {
    await page.setViewportSize(layout.viewport);
    await expect(page.locator('#app')).toHaveAttribute('data-layout', layout.name);
    if (!await page.locator('#leftPanel').isVisible()) await page.locator('#mobileMapBtn').click();
    if (!await page.locator('#mapViewSection').isVisible()) await page.locator('#mapViewTabBtn').click();
    await expect(page.locator('.terrain-settings')).toBeVisible();
    const overflow = await page.locator('#leftPanel').evaluate(panel => ({
      panel: panel.scrollWidth > panel.clientWidth + 1,
      settings: panel.querySelector('.terrain-settings').scrollWidth > panel.querySelector('.terrain-settings').clientWidth + 1,
    }));
    expect(overflow).toEqual({ panel: false, settings: false });
  }
  expect(errors).toEqual([]);
});

test('built-in rivers and lakes use independent folders without overwriting source visibility', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page, { url: '/?renderer=canvas' });
  const expected = [
    { group: 'rivers', itemId: 'rivers_hydro', source: 'HydroRIVERS' },
    { group: 'lakes', itemId: 'lakes_natural_earth', source: 'Natural Earth' },
  ];

  for (const item of expected) {
    const folderRow = page.locator(`.layer-folder[data-layer-group="${item.group}"]`);
    const toggle = folderRow.locator('[data-layer-folder-toggle]').first();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const sourceRow = folderRow.locator(`.layer-child[data-item-id="${item.itemId}"]`);
    await expect(sourceRow.locator('.layer-child-name')).toHaveText(item.source);
    const folderVisibility = folderRow.locator(`:scope > .layer-folder-row #${item.group}Visible`);
    const sourceVisibility = sourceRow.locator('.layer-visibility-toggle');
    await folderVisibility.uncheck();
    await expect(sourceVisibility).toBeChecked();
    await folderVisibility.check();
    await expect(sourceVisibility).toBeChecked();
  }

  for (const layout of layouts.slice(1)) {
    await page.setViewportSize(layout.viewport);
    await expect(page.locator('#app')).toHaveAttribute('data-layout', layout.name);
    if (layout.name === 'mobile' && !await page.locator('#leftPanel').isVisible()) await page.locator('#mobileMapBtn').click();
    const folderRows = page.locator('#featuresLayerItems > .layer-folder');
    await expect(folderRows.locator('.layer-folder-name')).toHaveText(['강', '호수', '기타 객체']);
    if (layout.name === 'mobile') {
      const touchSize = await folderRows.first().locator('.layer-folder-toggle').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return [Math.round(rect.width), Math.round(rect.height)];
      });
      expect(touchSize).toEqual([48, 48]);
    }
  }
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
    'pandolab_capital', 'pandolab_color', 'pandolab_id', 'pandolab_name', 'pandolab_notes', 'pandolab_object_class', 'continent',
    'editor_color', 'editor_custom', 'editor_id', 'editor_name', 'editor_original_name', 'gdp_md_est',
    'id', 'iso_a3', 'map_date', 'name', 'name_long', 'object_class', 'pop_est',
  ].map((key, index) => [key, index]));
  await page.locator('#gisFileInput').setInputFiles({
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
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#gisAdvancedMapping summary').click();

  const nameSelect = page.locator('#gisNameField');
  const nameControl = nameSelect.locator('..').locator('.ui-select-control');
  await expect(nameControl).toHaveJSProperty('readOnly', false);
  await nameControl.click();
  await nameControl.fill('name');
  const openPopover = page.locator('.ui-select-popover:not([hidden])');
  const optionLabels = await openPopover.getByRole('option').allTextContents();
  expect(optionLabels).toEqual(expect.arrayContaining([
    '이름 — 16',
    '이름 — 17',
    '이름 — 10',
    '이름 — 11',
    '이름 — 3',
  ]));
  await openPopover.getByRole('option', { name: '이름 — 16', exact: true }).click();
  await expect(nameSelect).toHaveValue('name');

  const targetSelect = page.locator('#gisTargetType');
  const targetControl = targetSelect.locator('..').locator('.ui-select-control');
  await expect(targetControl).toHaveJSProperty('readOnly', true);
  await targetControl.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('.ui-select-popover:not([hidden])')).toHaveCount(0);
  await targetControl.click();
  await page.locator('.ui-select-popover:not([hidden])').getByRole('option', { name: '권역', exact: true }).click();
  await expect(targetSelect).toHaveValue('territory');
  await expect(page.locator('#gisCountryFieldRow')).toBeVisible();
  expect(errors).toEqual([]);
});

test('GIS import keeps every step on one content rail', async ({ page }) => {
  test.setTimeout(240_000);
  const importFile = JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: 'content rail' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[19, 50], [19, 51], [20, 51], [20, 50], [19, 50]]],
      },
    }],
  });
  const railMatches = async selectors => {
    await page.locator(selectors[0]).scrollIntoViewIfNeeded();
    const measurements = await page.evaluate(visibleSelectors => {
      const rail = document.querySelector('.gis-import-content-rail');
      const railRect = rail.getBoundingClientRect();
      return {
        left: Math.round(railRect.left),
        right: Math.round(railRect.left + rail.clientWidth),
        items: visibleSelectors.map(selector => {
          const source = document.querySelector(selector);
          const element = source?.matches('select, output') ? source.closest('.field-group') : source;
          const rect = element?.getBoundingClientRect();
          return [selector, Math.round(rect?.left ?? 0), Math.round(rect?.right ?? 0)];
        }),
      };
    }, selectors);
    for (const [selector, left, right] of measurements.items) {
      expect(left, `${selector} left edge`).toBe(measurements.left);
      expect(right, `${selector} right edge`).toBe(measurements.right);
    }
  };

  for (const layout of [layouts[0], layouts[2]]) {
    await page.setViewportSize(layout.viewport);
    const errors = await openApp(page);
    await page.locator('#gisFileInput').setInputFiles({
      name: `content-rail-${layout.name}.geojson`,
      mimeType: 'application/geo+json',
      buffer: Buffer.from(importFile),
    });
    await expect(page.locator('#gisImportModal')).toBeVisible();
    await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });

    await railMatches(['#gisSourceReport']);
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText('2/5');
    await railMatches(['#gisTargetTypeRow']);
    await page.locator('#gisTargetType').evaluate(select => {
      select.value = 'country';
      select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
    });

    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText('3/5');
    await railMatches(['#gisAdvancedMapping', '#gisCrsSummary']);
    await page.locator('#gisAdvancedMapping summary').click();
    await railMatches(['#gisAdvancedMapping']);

    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText('4/5');
    await railMatches(['#gisImportImpact', '#gisOpenModeRow']);

    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText('5/5');
    await railMatches(['#gisFinalSummary']);
    await page.locator('#gisImportCancelBtn').click();
    await expect(page.locator('#gisImportModal')).toBeHidden();
    expect(errors).toEqual([]);
  }
});

test('virtualized layer selection and search results preserve scroll and accessible selection state', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const folderToggle = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await folderToggle.getAttribute('aria-expanded') !== 'true') await folderToggle.click();
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
  await page.emulateMedia({ colorScheme: 'light' });
  const errors = await openApp(page);
  const folderToggle = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await folderToggle.getAttribute('aria-expanded') !== 'true') await folderToggle.click();
  await page.locator('#countriesLayerChildren .layer-child-name').first().click();
  await expect(page.locator('#countryColorInput')).toHaveValue('#cccccc');
  expect(await page.locator('.editor-flag-actions > .icon-btn').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    const icon = button.querySelector('.ui-icon');
    return [style.width, style.height, getComputedStyle(icon).width, getComputedStyle(icon).height];
  }))).toEqual([
    ['30px', '30px', '16px', '16px'],
    ['30px', '30px', '16px', '16px'],
  ]);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('#countryColorInput')).toHaveValue('#63758a');
  await page.locator('#countryColorTrigger').click();
  const palette = page.locator('#countryColorPopover');
  const neutrals = palette.locator('.ui-color-swatch-grid--neutral [data-color-value]');
  const chromatic = palette.locator('.ui-color-swatch-grid--chromatic [data-color-value]');
  await expect(palette).toBeVisible();
  await expect(neutrals).toHaveCount(6);
  await expect(chromatic).toHaveCount(60);
  await expect(neutrals.first()).toHaveAttribute('aria-label', '흰색 (#FFFFFF) 색상');
  await expect(chromatic.first()).toHaveAttribute('aria-label', '빨강 아주 밝음 (#FEE2E2) 색상');
  expect(await chromatic.evaluateAll(elements => elements.slice(0, 12).map(element => element.dataset.colorFamily))).toEqual([
    '빨강', '주황', '황금', '노랑', '연두', '초록', '청록', '시안', '파랑', '인디고', '보라', '분홍',
  ]);
  expect(await palette.locator('.ui-color-swatch-grid--chromatic').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(12);
  await palette.locator('[data-color-value="#ef4444"]').click();
  await expect(page.locator('#countryColorInput')).toHaveValue('#ef4444');
  await expect(page.locator('#countryColorValue')).toHaveText('#EF4444');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('#countryColorInput')).toHaveValue('#ef4444');
  await page.locator('#countryColorTrigger').click();
  await page.locator('#countryColorPopover [data-color-default]').click();
  await expect(page.locator('#countryColorValue')).toHaveText('기본 색상');
  await expect(page.locator('#countryColorInput')).toHaveValue('#cccccc');
  await page.setViewportSize(layouts[2].viewport);
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  if (await page.locator('#mobileEditBtn').getAttribute('aria-expanded') !== 'true') await page.locator('#mobileEditBtn').click();
  expect(await page.locator('.editor-flag-actions > .icon-btn').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    return [style.width, style.height];
  }))).toEqual([
    ['36px', '36px'],
    ['36px', '36px'],
  ]);
  await page.locator('#countryColorTrigger').click();
  await expect(palette).toBeVisible();
  const paletteBox = await palette.boundingBox();
  expect(paletteBox.x).toBeGreaterThanOrEqual(0);
  expect(paletteBox.x + paletteBox.width).toBeLessThanOrEqual(layouts[2].viewport.width);
  expect(paletteBox.y).toBeGreaterThanOrEqual(0);
  expect(paletteBox.y + paletteBox.height).toBeLessThanOrEqual(layouts[2].viewport.height);
  expect(await palette.locator('.ui-color-swatch-grid--chromatic').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(12);
  await expect(palette.locator('[data-color-custom]')).toHaveText('사용자 지정');
  await expect(page.locator('#countryColorInput')).toHaveAttribute('type', 'color');
  await page.keyboard.press('Escape');
  await page.locator('#undoBtn').click();
  await expect(page.locator('#redoBtn')).toBeEnabled();
  await expect(page.locator('#countryProperties')).toBeHidden();
  expect(errors).toEqual([]);
});

test('layer style hover is isolated and preferences reuse the shared color picker', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(layouts[0].viewport);
  await page.emulateMedia({ colorScheme: 'light' });
  const errors = await openApp(page, { waitForCanonical: false });
  const folder = page.locator('.layer-folder[data-layer-group="countries"]');
  const row = folder.locator(':scope > .layer-folder-row');
  const visibility = row.locator('.layer-visibility-control');
  const styleToggle = row.locator('[data-layer-style-toggle="countries"]');
  const readHover = async locator => {
    await locator.hover();
    await page.waitForTimeout(200);
    return locator.evaluate(element => {
      const rowElement = element.closest('.layer-folder-row');
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color, rowBackground: getComputedStyle(rowElement).backgroundColor };
    });
  };
  const baseRowBackground = await row.evaluate(element => getComputedStyle(element).backgroundColor);
  const visibilityHover = await readHover(visibility);
  await page.mouse.move(0, 0);
  const styleHover = await readHover(styleToggle);
  expect(styleHover.background).toBe(visibilityHover.background);
  expect(styleHover.color).toBe(visibilityHover.color);
  expect(styleHover.rowBackground).toBe(baseRowBackground);
  await styleToggle.click();
  await expect(styleToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(styleToggle).toHaveClass(/active/);
  const activeStyle = await styleToggle.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  await page.mouse.move(0, 0);
  await expect.poll(() => styleToggle.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  })).toEqual(activeStyle);

  const folderToggle = row.locator('[data-layer-folder-toggle="countries"]').first();
  if (await folderToggle.getAttribute('aria-expanded') !== 'true') await folderToggle.click();
  await page.locator('#countriesLayerChildren .layer-child-name').first().click();
  await expect(page.locator('#countryProperties')).toBeVisible();
  expect(await page.locator('.editor-flag-actions > .icon-btn').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    const icon = button.querySelector('.ui-icon');
    return [style.width, style.height, getComputedStyle(icon).width, getComputedStyle(icon).height];
  }))).toEqual([
    ['30px', '30px', '16px', '16px'],
    ['30px', '30px', '16px', '16px'],
  ]);

  await page.locator('#mobileFileBtn').click();
  await page.locator('#preferencesBtn').click();
  await expect(page.locator('#preferencesModal')).toBeVisible();
  await page.locator('#preferencesSelectionColorTrigger').click();
  const palette = page.locator('#preferencesSelectionColorPopover');
  await expect(palette).toBeVisible();
  await expect(palette.locator('.ui-color-swatch-grid--neutral [data-color-value]')).toHaveCount(6);
  await expect(palette.locator('.ui-color-swatch-grid--chromatic [data-color-value]')).toHaveCount(60);
  await expect(palette.locator('[data-color-custom]')).toHaveText('사용자 지정');
  await palette.locator('[data-color-value="#ef4444"]').click();
  await expect(page.locator('#preferencesSelectionColorInput')).toHaveValue('#ef4444');
  await expect(page.locator('#preferencesSelectionColorValue')).toHaveText('#EF4444');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--map-selection-halo'))).toBe('#ef4444');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pandolab-user-preferences') || '{}').selection?.color)).toBe('#ef4444');

  await page.locator('#preferencesCloseBtn').click();
  await page.setViewportSize(layouts[2].viewport);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  if (await page.locator('#mobileEditBtn').getAttribute('aria-expanded') !== 'true') await page.locator('#mobileEditBtn').click();
  expect(await page.locator('.editor-flag-actions > .icon-btn').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    return [style.width, style.height];
  }))).toEqual([
    ['36px', '36px'],
    ['36px', '36px'],
  ]);
  await page.locator('#mobileFileBtn').click();
  await page.locator('#preferencesBtn').click();
  await page.locator('#preferencesSelectionColorTrigger').click();
  await expect(palette).toBeVisible();
  const paletteBox = await palette.boundingBox();
  expect(paletteBox.x).toBeGreaterThanOrEqual(0);
  expect(paletteBox.x + paletteBox.width).toBeLessThanOrEqual(layouts[2].viewport.width);
  expect(paletteBox.y).toBeGreaterThanOrEqual(0);
  expect(paletteBox.y + paletteBox.height).toBeLessThanOrEqual(layouts[2].viewport.height);
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
  await page.locator('#mobileEditBtn').click();
  const reopenedHeight = await openSheet('#mobileEditBtn', '#rightPanel');
  expect(Math.abs(reopenedHeight - editHeight)).toBeLessThanOrEqual(1);

  await openSheet('#mobileMapBtn', '#leftPanel');
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

test('GeoJSON imports custom genericFeatures into one flat list and deletes them immediately', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const featureCollection = name => JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: `${name}-feature`,
      properties: { name, role: 'generic', color: '#8c68d8', schemaVersion: 1 },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    }],
  });
  const importFile = async name => {
    await page.locator('#gisFileInput').setInputFiles({
      name: `${name}.geojson`,
      mimeType: 'application/geo+json',
      buffer: Buffer.from(featureCollection(name)),
    });
    await expect(page.locator('#gisImportModal')).toBeVisible();
    await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('#gisTargetType')).toHaveValue('generic');
    for (let step = 0; step < 4; step += 1) await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisImportConfirmBtn')).toBeVisible();
    await page.locator('#gisImportConfirmBtn').click();
    const genericFeaturesFolder = page.locator('.layer-folder[data-layer-group="genericFeatures"]');
    if (await genericFeaturesFolder.locator('.layer-folder-toggle').getAttribute('aria-expanded') !== 'true') {
      await genericFeaturesFolder.locator('.layer-folder-toggle').click();
    }
    const row = page.locator('#genericFeaturesLayerChildren .layer-child', { hasText: name });
    await expect(row).toHaveCount(1);
    return row;
  };

  const disposable = await importFile('삭제확인');
  await disposable.locator('.layer-child-menu').click();
  await page.locator('#objectDeleteMenuBtn').click();
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('#genericFeaturesLayerChildren .layer-child', { hasText: '삭제확인' })).toHaveCount(0);

  await importFile('첫번째 객체');
  await importFile('두번째 객체');
  await expect(page.locator('#genericFeaturesLayerChildren .layer-child-name')).toContainText(['두번째 객체', '첫번째 객체']);
  await expect(page.locator('.layer-folder[data-generic-feature-folder-id]')).toHaveCount(0);
  await expect(page.locator('#genericFeatureFolderInput')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('GeoJSON polygon imports create canonical territories with explicit ownership', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  const polygon = JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: 'territory-import-smoke',
      properties: { name: '시험 지역' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[19, 50], [19, 51], [20, 51], [20, 50], [19, 50]]],
      },
    }],
  });

  await page.locator('#gisFileInput').setInputFiles({
    name: 'territory-smoke.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(polygon),
  });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toContainText('2/5');
  const targetSelect = page.locator('#gisTargetType');
  await targetSelect.locator('..').locator('.ui-select-control').click();
  await page.locator('.ui-select-popover:not([hidden])').getByRole('option', { name: '권역', exact: true }).click();
  await expect(targetSelect).toHaveValue('territory');
  await page.locator('#gisTargetCountry').evaluate(select => {
    const poland = [...select.options].find(option => option.textContent?.includes('폴란드'));
    if (!poland) throw new Error('폴란드 소속 국가 옵션을 찾지 못했습니다.');
    select.value = poland.value;
    select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
  });
  for (const step of ['3/5', '4/5', '5/5']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step, { timeout: 30_000 });
  }
  await page.locator('#gisImportConfirmBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'territory' })
    .some(feature => feature.properties?.name === '시험 지역')), { timeout: 60_000 }).toBe(true);
  const importedIdentity = await page.evaluate(() => {
    const feature = window.PANDOLAB_TERRITORIAL.list({ type: 'territory' })
      .find(item => item.properties?.name === '시험 지역');
    return { id: feature?.id, sourceId: feature?.properties?.metadata?.sourceId };
  });
  expect(importedIdentity.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(importedIdentity.sourceId).toBe('territory-import-smoke');

  const territoryToggle = page.locator('[data-layer-folder-toggle="territories"]').first();
  if (await territoryToggle.getAttribute('aria-expanded') !== 'true') await territoryToggle.click();
  const importedName = page.getByRole('button', { name: '시험 지역', exact: true });
  await expect(importedName).toHaveCount(1);
  await importedName.click();
  await page.locator('#territoryColorTrigger').click();
  await page.locator('#territoryColorPopover [data-color-value="#dc2626"]').click();
  await expect(page.locator('#territoryColorInput')).toHaveValue('#dc2626');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'territory' })
    .find(feature => feature.properties?.name === '시험 지역')?.properties?.style?.color)).toBe('#dc2626');
  await expect(page.locator('#territoriesLayerChildren .layer-subfolder-row')).toHaveCount(1);
  await expect(page.locator('#territoriesLayerChildren')).toContainText('미지정 권역');
  const countrySubfolder = page.locator('#territoriesLayerChildren [data-territorial-unit-folder-toggle]');
  await countrySubfolder.click();
  await expect(countrySubfolder).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#territoriesLayerChildren .layer-child')).toHaveCount(0);
  await countrySubfolder.click();
  await expect(page.locator('#territoriesLayerChildren .layer-child')).toHaveCount(2);

  const importedRow = page.locator('#territoriesLayerChildren .layer-child').filter({ hasText: '시험 지역' });
  await importedRow.locator('.layer-child-menu').click();
  await page.locator('#objectDeleteMenuBtn').click();
  await expect(page.locator('#confirmModalChoice')).toHaveValue('unassigned');
  await expect(page.locator('#confirmModalChoice option')).toHaveText(['미지정 영역으로 전환', '이 단계의 영역 구분 전체 해제']);
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.getByRole('button', { name: '시험 지역', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '미지정 권역', exact: true })).toHaveCount(1);

  await page.locator('#undoBtn').click();
  await expect(page.getByRole('button', { name: '시험 지역', exact: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});
