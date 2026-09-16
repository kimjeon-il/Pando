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
      helper: font('#territoryNameConflict'),
      colorValue: font('#countryColorValue'),
      propertyHeading: font('.editor-property-heading'),
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
      expect(typography.helper).toEqual(['13px', '400']);
      expect(typography.colorValue).toEqual(['15px', '400']);
      expect(typography.propertyHeading).toEqual(['14px', '500']);
      expect(typography.periodHeading).toEqual(['14px', '500']);
      expect(typography.periodSubfield).toEqual(['13px', '500']);
      expect(errors).toEqual([]);
    });
  }
}

test('annex territory exposes river boundaries as a retained component-selection option', async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page, { url: '/?debug=1' });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await page.locator('#actionsTabBtn').click();
  await page.locator('#annexTerritoryBtn').click();
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입 1단계');
  await expect(page.locator('#modeTaskStage')).toHaveText('대상 선택');
  await expect(page.locator('#annexCountryFlow')).toBeVisible();
  await expect(page.locator('#modeMethodSwitch')).toBeHidden();
  const donorPoint = await page.evaluate(() => {
    const anchor = window.__PANDOLAB_VIEW_DEBUG__.countryLabelAnchor('POL');
    return window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(anchor);
  });
  const mapBox = await page.locator('#map').boundingBox();
  await page.locator('#map .map-svg').dispatchEvent('click', {
    clientX: mapBox.x + donorPoint[0],
    clientY: mapBox.y + donorPoint[1],
    button: 0,
  });
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await expect(page.locator('#modePrimaryBtn')).toContainText('다음');
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입 1단계');
  await expect(page.locator('#modeMethodSwitch')).toBeHidden();
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입 2단계');
  await expect(page.locator('#modeTaskStage')).toHaveText('영역 선택');
  await expect(page.locator('#modeMethodSwitch')).toBeVisible();
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await expect(page.locator('#modeMethodSwitch .mode-direct-method-option')).toHaveCount(3);
  await expect(page.locator('#modePolygonMethodInput')).not.toBeChecked();
  await expect(page.locator('#modeRiverMethodBtn')).toHaveCount(0);
  await expect(page.locator('#modeRiverBoundaryOption')).toBeHidden();
  await page.locator('#modeComponentsMethodInput').check();
  await expect(page.locator('#modeComponentsMethodInput')).toBeChecked();
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await expect(page.locator('#modeMethodSwitch')).toBeVisible();
  await expect(page.locator('#modeRiverBoundaryOption')).toBeVisible();
  await expect(page.locator('#modeRiverBoundaryInput')).not.toBeChecked();
  const components = page.locator('.draft-layer path.territory-component');
  await expect(components.first()).toBeVisible();
  await page.waitForTimeout(500);
  await components.first().evaluate(element => element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: -1000, clientY: -1000,
  })));
  await expect(page.locator('#modePrimaryBtn')).toContainText('다음', { timeout: 120_000 });
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();

  await page.locator('#modeRiverBoundaryOption').click();
  await expect(page.locator('#modeRiverBoundaryInput')).toBeChecked();
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await expect(page.locator('#modeTaskInstruction')).toContainText('준비하는 중');
  await expect(page.locator('#modeTaskInstruction')).not.toContainText('준비하는 중', { timeout: 120_000 });
  await expect(components.first()).toBeVisible();
  await page.waitForTimeout(500);
  await components.first().evaluate(element => element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: -1000, clientY: -1000,
  })));
  await page.locator('#modeRiverBoundaryOption').click();
  await expect(page.locator('#modeRiverBoundaryInput')).not.toBeChecked();
  await expect(page.locator('#modeTaskInstruction')).toContainText('가져올 영토 조각');
  await page.waitForTimeout(500);
  await components.first().evaluate(element => element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: -1000, clientY: -1000,
  })));
  await expect(page.locator('#modePrimaryBtn')).toContainText('다음', { timeout: 120_000 });
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입 3단계');
  await expect(page.locator('#modeTaskStage')).toHaveText('결과 확인');
  await expect(page.locator('#modeMethodSwitch')).toBeHidden();
  await expect(page.locator('#modeRiverBoundaryOption')).toBeHidden();
  await expect(page.locator('#modePrimaryBtn')).toContainText('편입 (1)');
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeActionBar')).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('#actionStatus')).toContainText('영토 조각');
  expect(errors).toEqual([]);
});

test('annex archives a component and starts the next method without losing the combined selection', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page, { url: '/?debug=1' });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await page.locator('#actionsTabBtn').click();
  await page.locator('#annexTerritoryBtn').click();
  await expect(page.locator('#modeTaskName')).toHaveText('영토 편입 1단계');
  const donorPoint = await page.evaluate(() => {
    const anchor = window.__PANDOLAB_VIEW_DEBUG__.countryLabelAnchor('POL');
    return window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(anchor);
  });
  const mapBox = await page.locator('#map').boundingBox();
  await page.locator('#map .map-svg').dispatchEvent('click', {
    clientX: mapBox.x + donorPoint[0], clientY: mapBox.y + donorPoint[1], button: 0,
  });
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await page.locator('#modeComponentsMethodInput').check();
  const components = page.locator('.draft-layer path.territory-component');
  await expect(components.first()).toBeVisible();
  await components.first().evaluate(element => element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: -1000, clientY: -1000,
  })));
  await expect(page.locator('#modePrimaryBtn')).toContainText('다음', { timeout: 120_000 });
  await expect(page.locator('#multiDrawnAddBtn')).toBeEnabled();
  await page.locator('#multiDrawnAddBtn').click();
  await expect(page.locator('#modeMethodSwitch')).toBeVisible();
  await expect(page.locator('#modeDirectLineMethodInput')).not.toBeChecked();
  await expect(page.locator('#modePolygonMethodInput')).not.toBeChecked();
  await expect(page.locator('#modeComponentsMethodInput')).not.toBeChecked();
  await expect(page.locator('#multiDrawnCount')).toHaveText('영역 1개');
  await expect(page.locator('#multiDrawnAddBtn')).toBeDisabled();
  await expect(page.locator('#multiDrawnUndoBtn')).toBeEnabled();
  await page.locator('#modePolygonMethodInput').check();
  await expect(page.locator('#modeDraftActions')).toBeVisible();
  await expect(page.locator('#modePrimaryBtn')).toBeDisabled();
  await page.locator('#modeCancelBtn').click();
  await page.locator('#modeCancelBtn').click();
  await expect(page.locator('#modeActionBar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('narrow mobile widths keep the editor type scale instead of shrinking text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openApp(page);
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 780 });
    await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
    const typography = await editorTypographySnapshot(page);
    expect(typography.objectTitle).toEqual(['18px', '700']);
    expect(typography.objectType).toEqual(['15px', '400']);
    expect(typography.propertyLabel).toEqual(['14px', '500']);
    expect(typography.editableValue).toEqual(['15px', '400']);
    expect(typography.readonlyValue).toEqual(['15px', '600']);
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
  const assetRevision = await page.evaluate(() => window.PANDOLAB_ASSET_REVISION);
  expect(audit.moduleUrls.every(url => new URL(url).searchParams.get('v') === assetRevision)).toBe(true);
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
  const worker = new Worker('/assets/js/workers/map-edit-worker.js?v=0.30.0-r44');
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
      id,
      properties: { name: id },
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
    const worker = new Worker('/assets/js/workers/river-territory-partition-worker.js?v=0.30.0-r44', { type: 'module' });
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
  expect(result.candidates.every(candidate => candidate.algorithmRevision === 'river-partitions-v2')).toBe(true);
  expect(result.donorResults).toEqual([{ donorCountryId: 'donor', status: 'ready', candidateCount: 4, reason: '' }]);
});

test('wide editor opens from object selection without the retired edge toggle', async ({ page }) => {
  await page.setViewportSize(layouts[0].viewport);
  const errors = await openApp(page);
  await expect(page.locator('#togglePanelBtn')).toHaveCount(0);
  await page.locator('#layerSearchInput').fill('폴란드');
  await page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '폴란드' }).first().click();
  await expect(page.locator('#rightPanel')).toBeVisible();
  await expect(page.locator('#propertyTitle')).toHaveText('폴란드');
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

test('terrain schedules a retry after a transient high-resolution tile failure', async ({ page }) => {
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
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'transient terrain failure' });
      return;
    }
    await route.continue();
  });
  const errors = await openApp(page);
  await expect.poll(() => failedUrl && (attempts.get(failedUrl) || 0), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect(failedUrl).not.toBe('');
  expect(attempts.get(failedUrl)).toBeGreaterThanOrEqual(2);
  expect(errors.filter(message => !message.includes('503') && !message.includes('Failed to load resource'))).toEqual([]);
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
  await page.evaluate(({ point: origin }) => {
    const target = document.querySelector('#map .map-svg');
    const dispatch = (type, pointerId, x, y, buttons) => target.dispatchEvent(new window.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: pointerId === 21,
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
    }));
    dispatch('pointerdown', 21, origin.x, origin.y, 1);
    dispatch('pointerdown', 22, origin.x + 40, origin.y, 1);
    dispatch('pointermove', 22, origin.x + 90, origin.y, 1);
    dispatch('pointerup', 22, origin.x + 90, origin.y, 0);
    dispatch('pointerup', 21, origin.x, origin.y, 0);
  }, { point });
  await expect.poll(revision, { message: 'pinch zoom should render a new frame', timeout: 20_000 }).toBeGreaterThan(before);

  before = await revision();
  for (const pointerId of [31, 32]) {
    await touch('touchStart', [touchPoint(pointerId, point.x, point.y)]);
    await touch('touchEnd', []);
  }
  await expect.poll(revision, { message: 'double tap should render a new frame', timeout: 20_000 }).toBeGreaterThan(before);
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
  await expect(page.locator('#gisStepIndicator')).toContainText('1/3');

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
  await expect(page.locator('#gisTargetCountryRow')).toBeVisible();
  await targetSelect.evaluate(select => {
    select.value = 'country';
    const BrowserEvent = select.ownerDocument.defaultView.Event;
    select.dispatchEvent(new BrowserEvent('input', { bubbles: true }));
    select.dispatchEvent(new BrowserEvent('change', { bubbles: true }));
  });
  await expect(page.locator('#gisStepIndicator')).toContainText('1/3');
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
      expect(left, `${selector} left edge`).toBeGreaterThanOrEqual(measurements.left);
      expect(right, `${selector} right edge`).toBeLessThanOrEqual(measurements.right);
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
    await expect(page.locator('#gisStepIndicator')).toContainText('1/3');
    await railMatches(['#gisTargetTypeRow']);
    await page.locator('#gisTargetType').evaluate(select => {
      select.value = 'country';
      select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
    });
    await expect(page.locator('#gisStepIndicator')).toContainText('1/3');
    await railMatches(['#gisAdvancedMapping', '#gisCrsSummary']);
    await page.locator('#gisAdvancedMapping summary').click();
    await railMatches(['#gisAdvancedMapping']);

    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText('2/3');
    await railMatches(['#gisImportImpact', '#gisOpenModeRow']);

    await page.locator('#gisImportNextBtn').click();
    const identitySelect = page.locator('#gisCountryIdentityRows [data-identity-source-key]').first();
    await expect(identitySelect).toHaveCount(1, { timeout: 30_000 });
    await identitySelect.evaluate(element => {
      element.value = 'new';
      const BrowserEvent = element.ownerDocument.defaultView.Event;
      element.dispatchEvent(new BrowserEvent('input', { bubbles: true }));
      element.dispatchEvent(new BrowserEvent('change', { bubbles: true }));
    });
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText('3/3');
    await railMatches(['#gisFinalSummary']);
    await page.locator('#gisImportCancelBtn').click();
    await expect(page.locator('#gisImportModal')).toBeHidden();
    expect(errors).toEqual([]);
  }
});
