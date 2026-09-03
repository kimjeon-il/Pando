import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relativePath => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const app = read('assets/js/app.js');
const rendering = read('assets/js/modules/rendering-domain.js');
const coordinator = read('assets/js/modules/map-render-coordinator.js');
const bootstrap = read('assets/js/bootstrap.js');
const loader = read('assets/js/workers/data-loader-worker.js');
const metadata = read('assets/js/build-meta.js');
const bundle = read('assets/css/ui-v2.bundle.css');

const uiSources = Object.freeze([
  'assets/css/tokens/ui-v2.css',
  'assets/css/primitives/controls.css',
  'assets/css/components/surface.css',
  'assets/css/components/content.css',
  'assets/css/components/command-row.css',
  'assets/css/components/workflow.css',
  'assets/css/components/workspace-refinements.css',
  'assets/css/layout/surfaces.css',
  'assets/css/features/layer-panel.css',
  'assets/css/components/editor-shell.css',
  'assets/css/components/map-create-panel.css',
  'assets/css/components/edit-workflow.css',
  'assets/css/components/library-gis-file.css',
  'assets/css/components/mobile-sheets.css',
  'assets/css/components/feedback.css',
  'assets/css/utilities/accessibility.css',
]);

test('render resources use frame snapshots instead of Proxy traps', () => {
  assert.doesNotMatch(app, /createLiveResources|new\s+Proxy/);
  assert.match(app, /createResourceSnapshot/);
  assert.match(app, /refreshRenderResources/);
  assert.match(rendering, /getRenderResourceSnapshot/);
  assert.match(rendering, /beginFrame/);
  assert.match(rendering, /renderResourceRefreshCount/);
  assert.match(rendering, /renderResourceProxyCount/);
  assert.match(coordinator, /callRenderer\('beginFrame'/);
});

test('data and asset revisions remain separate contracts', () => {
  assert.match(metadata, /"assetRevision":\s*"[^"]+"/);
  assert.match(metadata, /"dataRevision":\s*"data-[a-f0-9]{32}"/);
  assert.match(loader, /const DATA_REVISION/);
  assert.match(loader, /const DATA_CACHE_PREFIX = 'pandolab-data-'/);
  assert.match(loader, /url\.searchParams\.set\('v', DATA_REVISION\)/);
  assert.match(bootstrap, /window\.PANDOLAB_DATA_REVISION = DATA_REVISION/);
  assert.match(bootstrap, /firstCanonicalFrameMs: null/);
  assert.match(bootstrap, /canonicalFrameFallbackCount: 0/);
});

test('UI bundle contains every canonical stylesheet exactly once in order', () => {
  let previous = -1;
  for (const source of uiSources) {
    const marker = `/* source: ${source} */`;
    const index = bundle.indexOf(marker);
    assert.ok(index > previous, `missing or out-of-order bundle source: ${source}`);
    assert.equal(bundle.indexOf(marker, index + marker.length), -1, `duplicate bundle source: ${source}`);
    previous = index;
  }
  assert.match(bootstrap, /const UI_BUNDLE = '\.\.\/css\/ui-v2\.bundle\.css'/);
  assert.doesNotMatch(bootstrap, /const UI_STYLES/);
});
