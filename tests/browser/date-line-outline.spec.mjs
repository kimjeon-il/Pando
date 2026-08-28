import { expect, test } from '@playwright/test';

test('date-line and polar countries render filled selections with stroke-safe outlines', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });

  for (const id of ['RUS', 'ATA']) {
    await page.evaluate(countryId => window.PANDOLAB_TERRITORIAL.select('country', countryId), id);
    await expect(page.locator('.selection-overlay-layer .map-selection-fill')).toHaveCount(1);
    await expect(page.locator('.selection-overlay-layer .map-selection-outline')).toHaveCount(1);

    const result = await page.evaluate(() => {
      const fill = document.querySelector('.selection-overlay-layer .map-selection-fill');
      const outline = document.querySelector('.selection-overlay-layer .map-selection-outline');
      const rawPolygons = fill.__data__.geometry.type === 'Polygon'
        ? [fill.__data__.geometry.coordinates]
        : fill.__data__.geometry.coordinates;
      const rawEdges = rawPolygons.flatMap(polygon => (polygon || []).flatMap(ring => (ring || []).slice(0, -1).map((a, index) => [a, ring[index + 1]])));
      const artificial = ([a, b]) => {
        const atPole = point => Math.abs(Math.abs(Number(point[1])) - 90) <= 1e-7;
        const atDateLine = point => Math.abs(Math.abs(Number(point[0])) - 180) <= 1e-7;
        return atPole(a) || atPole(b) || (atDateLine(a) && atDateLine(b)) || Math.abs(Number(a[0]) - Number(b[0])) > 180;
      };
      return {
        rawHasArtificialClosure: rawEdges.some(artificial),
        outlineType: outline.__data__.geometry.type,
        outlineHasArtificialClosure: outline.__data__.geometry.coordinates.some(artificial),
        fillStroke: getComputedStyle(fill).stroke,
        outlineFill: getComputedStyle(outline).fill,
      };
    });

    expect(result.rawHasArtificialClosure).toBe(true);
    expect(result.outlineType).toBe('MultiLineString');
    expect(result.outlineHasArtificialClosure).toBe(false);
    expect(result.fillStroke).toBe('none');
    expect(result.outlineFill).toBe('none');
  }
});
