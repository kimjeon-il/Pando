import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'off', actionTimeout: 10_000 });

const thresholds = [
  { projection: 'globe', lower: 1.8, upper: 2.2, band: 2 },
  { projection: 'flat', lower: 2.2, upper: 2.8, band: 2.5 },
];

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function openMap(page, { enhanced = true } = {}) {
  const url = process.env.PANDOLAB_TEST_SITE_URL
    ? new URL('?debug=1', process.env.PANDOLAB_TEST_SITE_URL).href : '/?debug=1';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => !!window.__PANDOLAB_VIEW_DEBUG__)).toBe(true);
  if (enhanced) {
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  }
}

async function activeQuality(page) {
  return page.evaluate(() => {
    const metrics = window.__PANDOLAB_GPU_METRICS__ || {};
    return metrics.activeMeshQuality;
  });
}

async function expectQuality(page, quality) {
  await expect.poll(() => activeQuality(page), { timeout: 20_000 }).toBe(quality);
}

async function selectProjection(page, projection) {
  await page.locator(`#${projection === 'globe' ? 'globe' : 'flat'}Btn`).evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().projection)).toBe(projection);
}

async function zoomTo(page, zoom) {
  // Exercise the real wheel controller rather than directly mutating view state.
  const actual = await page.evaluate(target => {
    const map = document.getElementById('map');
    const rect = map.getBoundingClientRect();
    const current = window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom;
    map.dispatchEvent(new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaY: -Math.log(target / current) / 0.0013,
    }));
    return window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom;
  }, zoom);
  expect(actual).toBeCloseTo(zoom, 10);
  await expect(page.locator('#map')).not.toHaveClass(/dragging/);
}

async function sampleQualityFrames(page, count = 8) {
  return page.evaluate(async frameCount => {
    const qualities = [];
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const metrics = window.__PANDOLAB_GPU_METRICS__ || {};
      qualities.push(metrics.activeMeshQuality);
    }
    return qualities;
  }, count);
}

test('selected country outline follows the fill mesh on the first frame of each quality switch', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  // Observe the real renderer and SelectionPass without replacing their behavior.
  await page.route('**/assets/js/modules/gpu-map-renderer.js*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const anchor = 'dispose, attach,';
    expect(body.split(anchor)).toHaveLength(2);
    await route.fulfill({ response, body: body.replace(anchor, `${anchor}
      selectionMeshSnapshot: window.__PANDOLAB_SELECTION_MESH_SNAPSHOT__ = () => {
        const boundary = getCountryInteractionBoundaryData();
        const { base, selectionBase } = boundary.strokeResources;
        return {
          quality: activeMeshQuality,
          sameResource: selectionBase === base,
          sameGeometry: selectionBase?.packet.preparedGeometry === mesh?.preparedStroke,
          selectionResourceKeys: selectionPass.resourceKeys(),
          primaryRebuilds: selectionPass.stats().channels.primary.rebuildCount,
          renderedKeys: lastSelectionRenderResult?.channels?.primary?.renderedKeys || [],
          fallbackKeys: [...document.querySelectorAll('[data-selection-fallback-key]')]
            .map(node => node.getAttribute('data-selection-fallback-key')),
        };
      },`) });
  });
  await openMap(page);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  // The property editor deliberately holds canonical quality; close it while
  // retaining the selection so wheel navigation exercises both mesh variants.
  if (await page.locator('#editorSurface').evaluate(node => node.classList.contains('surface-open'))) {
    await page.locator('#mobileEditBtn').evaluate(button => button.click());
  }
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer)).toMatch(/^webgl/);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const { projection, lower, upper } of thresholds) {
    await selectProjection(page, projection);
    await zoomTo(page, lower - 0.01);
    await expectQuality(page, 'preview');
    const initial = await page.evaluate(() => window.__PANDOLAB_SELECTION_MESH_SNAPSHOT__());
    expect(initial.sameResource).toBe(true);
    expect(initial.sameGeometry).toBe(true);
    expect(initial.selectionResourceKeys).toEqual(['country-boundary:preview']);
    let rebuilds = initial.primaryRebuilds;
    for (const [zoom, quality] of [[upper + 0.01, 'canonical'], [lower - 0.01, 'preview']]) {
      const firstFrame = await page.evaluate(async target => {
        const map = document.getElementById('map');
        const rect = map.getBoundingClientRect();
        const current = window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom;
        map.dispatchEvent(new window.WheelEvent('wheel', {
          bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
          deltaY: -Math.log(target / current) / 0.0013,
        }));
        await new Promise(resolve => requestAnimationFrame(resolve));
        return window.__PANDOLAB_SELECTION_MESH_SNAPSHOT__();
      }, zoom);
      expect(firstFrame.quality).toBe(quality);
      expect(firstFrame.sameResource).toBe(true);
      expect(firstFrame.sameGeometry).toBe(true);
      expect(firstFrame.selectionResourceKeys).toEqual([`country-boundary:${quality}`]);
      expect(firstFrame.primaryRebuilds).toBeGreaterThan(rebuilds);
      // The existing SVG outline covers frames whose shared GPU upload is
      // pending. Selection must remain visible through the quality switch.
      expect([...firstFrame.renderedKeys, ...firstFrame.fallbackKeys]).toContain('territorial:entity:DEU');
      rebuilds = firstFrame.primaryRebuilds;
    }
  }
  expect(errors).toEqual([]);
});

for (const { projection, lower, upper, band } of thresholds) {
  test(`${projection} preview and canonical switch in both directions without oscillating in the band`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await openMap(page);
    await selectProjection(page, projection);
    await page.locator('#resetViewBtn').evaluate(button => button.click());
    await expectQuality(page, 'preview');

    // Exact equality is covered by the policy unit test. Native wheel math may
    // round one ULP, so cross endpoints by a tiny explicit amount here.
    for (const [zoom, quality] of [
      [lower, 'preview'],
      [band, 'preview'],
      [upper - 0.001, 'preview'],
      [band, 'preview'],
      [upper + 0.000001, 'canonical'],
      [band, 'canonical'],
      [lower + 0.001, 'canonical'],
      [band, 'canonical'],
      [lower - 0.000001, 'preview'],
      [band, 'preview'],
    ]) {
      await zoomTo(page, zoom);
      await expectQuality(page, quality);
      expect(await sampleQualityFrames(page, 3)).toEqual(Array(3).fill(quality));
    }
    expect(errors).toEqual([]);
  });
}

test('focus survives frames and resize until navigation resumes while editing retains canonical', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await openMap(page);
  await selectProjection(page, 'globe');
  await page.locator('#resetViewBtn').evaluate(button => button.click());
  await expectQuality(page, 'preview');
  const original = await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('DEU').geometry));

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  if (await page.locator('#selectionToolbarEditBtn').isVisible()) await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#entityProperties')).toBeVisible();
  await page.locator('#focusSelectedObjectBtn').evaluate(button => button.click());
  await expectQuality(page, 'canonical');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.countryFocusPending)).toBe(true);
  await page.setViewportSize({ width: 1380, height: 880 });
  expect(await sampleQualityFrames(page)).toEqual(Array(8).fill('canonical'));
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.countryFocusPending)).toBe(true);
  await page.locator('#mobileEditBtn').evaluate(button => button.click());
  await expectQuality(page, 'canonical');
  await zoomTo(page, 1.1);
  await expectQuality(page, 'preview');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.countryFocusPending)).toBe(false);
  await page.locator('#mobileEditBtn').evaluate(button => button.click());
  await expectQuality(page, 'canonical');
  await page.locator('#resetViewBtn').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom)).toBe(1);
  await expectQuality(page, 'canonical');
  await page.locator('#mobileEditBtn').evaluate(button => button.click());
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  await expectQuality(page, 'preview');

  await page.locator('#createMenuBtn').click();
  await page.locator('#addRiverBtn').click();
  await expect(page.locator('#modeCancelBtn')).toBeVisible();
  await expectQuality(page, 'canonical');
  await zoomTo(page, 1.1);
  await expectQuality(page, 'canonical');
  await selectProjection(page, 'flat');
  await page.locator('#resetViewBtn').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom)).toBe(1);
  await expectQuality(page, 'canonical');
  expect(await sampleQualityFrames(page)).toEqual(Array(8).fill('canonical'));
  await page.locator('#modeCancelBtn').click();
  await page.locator('#mobileEditBtn').evaluate(button => button.click());
  await expectQuality(page, 'preview');
  expect(await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('DEU').geometry))).toBe(original);
  expect(errors).toEqual([]);
});

test('a pending canonical response cannot revive an obsolete high zoom request', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  let releaseCanonical;
  const gate = new Promise(resolve => { releaseCanonical = resolve; });
  let canonicalRequests = 0;
  await page.route('**/countries-canonical-v*.pcg.gz*', async route => {
    canonicalRequests += 1;
    await gate;
    if (!page.isClosed()) await route.continue();
  });
  try {
    await openMap(page, { enhanced: false });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview');
    await selectProjection(page, 'globe');
    await page.locator('#resetViewBtn').evaluate(button => button.click());
    await expectQuality(page, 'preview');
    await zoomTo(page, 2.3);
    await expectQuality(page, 'preview');
    await zoomTo(page, 2);
    await expectQuality(page, 'preview');
    await expect.poll(() => canonicalRequests, { timeout: 20_000 }).toBe(1);
    releaseCanonical();
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    await expectQuality(page, 'preview');
    expect(await sampleQualityFrames(page)).toEqual(Array(8).fill('preview'));
    await zoomTo(page, 2.3);
    await expectQuality(page, 'canonical');
    await zoomTo(page, 1.7);
    await expectQuality(page, 'preview');
    expect(errors).toEqual([]);
  } finally {
    releaseCanonical();
    await page.close();
  }
});

test('projection switches preserve the displayed quality in the destination band', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await openMap(page);
  await selectProjection(page, 'flat');
  await zoomTo(page, 2.5);
  await expectQuality(page, 'preview');
  await selectProjection(page, 'globe');
  await zoomTo(page, 2.3);
  await expectQuality(page, 'canonical');
  await zoomTo(page, 2);
  await selectProjection(page, 'flat');
  await expectQuality(page, 'canonical');
  await zoomTo(page, 2.1);
  await expectQuality(page, 'preview');
  await selectProjection(page, 'globe');
  await expectQuality(page, 'preview');
  expect(await sampleQualityFrames(page)).toEqual(Array(8).fill('preview'));
  expect(errors).toEqual([]);
});
