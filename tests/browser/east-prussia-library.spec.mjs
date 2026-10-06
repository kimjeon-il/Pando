import { expect, test } from '@playwright/test';
import { openLibrary, refuseFiniteActivation } from './helpers/library-state.mjs';

test('East Prussia r3 preserves reviewed geometry and rejects finite activation atomically', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  const neighbors = () => page.evaluate(async () => {
    const result = {};
    for (const id of ['POL', 'RUS', 'LTU']) {
      const bytes = new TextEncoder().encode(JSON.stringify(window.PANDOLAB_TERRITORIAL.get(id).geometry));
      result[id] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
    }
    return result;
  });
  const before = await neighbors();
  await page.locator('#historicalLibrarySearchInput').fill('동프로이센');
  await page.locator('#historicalLibraryYearInput').fill('1900');
  const result = page.locator('[data-library-entity-id="state:east-prussia"]');
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator('#historicalLibraryPreview')).toBeHidden();
  await expect(page.locator('#historicalLibraryPreview details')).toHaveCount(0);
  await expect(page.locator('#historicalLibraryPreview svg path')).toHaveCount(0);
  const source = await page.evaluate(async () => {
    const entity = await window.PANDOLAB_TERRITORIAL_LIBRARY.get('state:east-prussia');
    const version = entity.geometryVersions[0];
    const bytes = new TextEncoder().encode(JSON.stringify(version.geometry));
    return {
      versionId: version.id, components: version.geometry.coordinates.length,
      coordinateCount: version.geometry.coordinates.flat(2).length,
      hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join(''),
      metadataHash: entity.metadata.geometrySha256, certainty: version.certainty,
      validation: entity.metadata.validation,
    };
  });
  expect(source.versionId).toBe('ostpreussen-1878-1920-r3');
  expect(source.components).toBe(1);
  expect(source.coordinateCount).toBe(6766);
  expect(source.hash).toBe('54c45d4de9f5f16e9dffb06eec24aeaef8f89b82aa455fd7c26b1064fe716237');
  expect(source.metadataHash).toBe(source.hash);
  expect(source.certainty).toBe('medium');
  expect(source.validation.modernEastUnmatchedLengthM).toBe(0);
  await refuseFiniteActivation(page, testInfo, 'state:east-prussia', errors);
  expect(await neighbors()).toEqual(before);
});
