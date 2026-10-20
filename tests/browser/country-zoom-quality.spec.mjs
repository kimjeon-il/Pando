import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'off', actionTimeout: 10_000 });

const thresholds = [
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
  await gotoEditor(page, url, { waitUntil: 'domcontentloaded' });
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
  expect(projection).toBe('flat');
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

test('selected country fill and outline keep the same precise mesh across screen scales', async ({ page }) => {
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
  // Keep selection while closing the property editor: navigation must retain precise geometry.
  if (await page.locator('#editorSurface').evaluate(node => node.classList.contains('surface-open'))) {
    await page.locator('#mobileEditBtn').evaluate(button => button.click());
  }
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer)).toMatch(/^webgl/);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const { projection, lower, upper } of thresholds) {
    await selectProjection(page, projection);
    await zoomTo(page, lower - 0.01);
    await expectQuality(page, 'canonical');
    const initial = await page.evaluate(() => window.__PANDOLAB_SELECTION_MESH_SNAPSHOT__());
    expect(initial.sameResource).toBe(true);
    expect(initial.sameGeometry).toBe(true);
    expect(initial.selectionResourceKeys).toEqual(['country-boundary:canonical']);
    let rebuilds = initial.primaryRebuilds;
    for (const [zoom, quality] of [[upper + 0.01, 'canonical'], [lower - 0.01, 'canonical']]) {
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
      expect(firstFrame.primaryRebuilds).toBe(rebuilds);
      // The existing SVG outline covers frames whose shared GPU upload is
      // pending. Selection must remain visible through the quality switch.
      expect([...firstFrame.renderedKeys, ...firstFrame.fallbackKeys]).toContain('territorial:entity:DEU');
      rebuilds = firstFrame.primaryRebuilds;
    }
  }
  expect(errors).toEqual([]);
});

for (const { projection, lower, upper, band } of thresholds) {
  test(`${projection} uncertified preview stays excluded across low, transition and high zoom`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await openMap(page);
    await selectProjection(page, projection);
    await page.locator('#resetViewBtn').evaluate(button => button.click());
    await expectQuality(page, 'canonical');

    // Exact equality is covered by the policy unit test. Native wheel math may
    // round one ULP, so cross endpoints by a tiny explicit amount here.
    for (const [zoom, quality] of [
      [lower, 'canonical'],
      [band, 'canonical'],
      [upper - 0.001, 'canonical'],
      [band, 'canonical'],
      [upper + 0.000001, 'canonical'],
      [band, 'canonical'],
      [lower + 0.001, 'canonical'],
      [band, 'canonical'],
      [lower - 0.000001, 'canonical'],
      [band, 'canonical'],
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
  await selectProjection(page, 'flat');
  await page.locator('#resetViewBtn').evaluate(button => button.click());
  await expectQuality(page, 'canonical');
  const original = await page.evaluate(() => JSON.stringify(window.PANDOLAB_TERRITORIAL.get('DEU').geometry));

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
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
  await expectQuality(page, 'canonical');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.countryFocusPending)).toBe(false);
  await page.locator('#mobileEditBtn').evaluate(button => button.click());
  await expectQuality(page, 'canonical');
  await page.locator('#resetViewBtn').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom)).toBe(1);
  await expectQuality(page, 'canonical');
  await page.locator('#mobileEditBtn').evaluate(button => button.click());
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  await expectQuality(page, 'canonical');

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
  await expectQuality(page, 'canonical');
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
    await selectProjection(page, 'flat');
    await page.locator('#resetViewBtn').evaluate(button => button.click());
    await expectQuality(page, 'preview');
    await zoomTo(page, 2.9);
    await expectQuality(page, 'preview');
    await zoomTo(page, 2.5);
    await expectQuality(page, 'preview');
    await expect.poll(() => canonicalRequests, { timeout: 20_000 }).toBe(1);
    releaseCanonical();
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    await expectQuality(page, 'canonical');
    expect(await sampleQualityFrames(page)).toEqual(Array(8).fill('canonical'));
    await zoomTo(page, 2.9);
    await expectQuality(page, 'canonical');
    await zoomTo(page, 2.1);
    await expectQuality(page, 'canonical');
    expect(errors).toEqual([]);
  } finally {
    releaseCanonical();
    await page.close();
  }
});

test('flat editor rejects globe changes without altering quality or camera', async ({ page }) => {
  test.setTimeout(180_000);
  const errors=collectErrors(page);
  await openMap(page);
  await selectProjection(page,'flat');
  await zoomTo(page,2.5);
  const result=await page.evaluate(()=>{
    const host=window.__PANDOLAB_MAP_HOST__,before=host.getViewState();
    let code;try{host.setProjectionKind('globe');}catch(error){code=error.code;}
    return {before,after:host.getViewState(),code};
  });
  expect(result.code).toBe('PL-PRODUCT-PROJECTION');
  expect(result.after).toEqual(result.before);
  expect(errors).toEqual([]);
});
