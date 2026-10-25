import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { timelineCases } from '../fixtures/timeline-records-cases.mjs';
import {repositoryFrontendSnapshot} from '../helpers/frontend-source.mjs';

test('a cached pre-C++ temporal module cannot mix with the current timeline modules', async ({ page }) => {
  const root = new URL('../../', import.meta.url);
  const snapshot=await repositoryFrontendSnapshot(),html=snapshot.html.viewer,revision=snapshot.buildMeta.assetRevision;
  const importMap = html.match(/<script\b[^>]*id="pandolab-module-import-map"[^>]*>[\s\S]*?<\/script>/)?.[0] || '';
  const stale = readFileSync(new URL('tests/fixtures/portability/web-9300609-oracle/assets/js/modules/temporal.js', root), 'utf8');
  const temporalRequests = [];
  await page.route('**/assets/js/modules/temporal.js*', async route => {
    const url = new URL(route.request().url());
    temporalRequests.push(url.href);
    if (url.searchParams.get('v') === revision) await route.continue();
    else await route.fulfill({ contentType: 'text/javascript', body: stale });
  });
  await page.route('**/__module-version-test.html', route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><meta charset="utf-8">${importMap}`,
  }));
  await page.goto('/__module-version-test.html');
  const fixture = timelineCases()[0];
  const result = await page.evaluate(async ({ revision, input, context }) => {
    const records = await import(`/assets/js/modules/timeline-records.js?v=${encodeURIComponent(revision)}`);
    const temporal = await import(`/assets/js/modules/temporal.js?v=${encodeURIComponent(revision)}`);
    const normalized = records.normalizeTimelineRecords(input, {
      entities: context.entities,
      geometryExists: ref => context.geometryRefs.some(value => value.id === ref.id && value.version === ref.version),
    });
    return {
      schemaVersion: normalized.schemaVersion,
      counts: ['lifetimes', 'geometryBindings', 'parentRelations'].map(name => normalized[name].length),
      frozen: Object.isFrozen(normalized),
      leapDay: temporal.parseTemporal('2024-02-29').canonical,
    };
  }, { revision, input: fixture.input, context: fixture.context });
  const expected = fixture.input;
  expect(result).toEqual({
    schemaVersion: expected.schemaVersion,
    counts: ['lifetimes', 'geometryBindings', 'parentRelations'].map(name => expected[name].length),
    frozen: true, leapDay: '2024-02-29',
  });
  expect(temporalRequests.length).toBeGreaterThan(0);
  expect(temporalRequests.every(url => new URL(url).searchParams.get('v') === revision)).toBe(true);
});
