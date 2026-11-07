import { describe as contractSuite } from 'node:test';
import * as __contract_dep0 from "node:assert/strict";
import * as __contract_dep1 from "node:fs";
import * as __contract_dep2 from "node:test";
import * as __contract_dep3 from "node:url";
import * as __contract_dep4 from "../../scripts/lib/source-analysis.mjs";
import * as __contract_dep5 from "../../scripts/lib/frontend-layout.mjs";
import * as __contract_dep6 from "node:child_process";
import * as __contract_dep7 from "../../scripts/plan-application-checks.mjs";
import * as __contract_dep8 from "../../scripts/lib/product-html.mjs";
import * as __contract_dep9 from "../../scripts/lib/reviewer-ui-contracts.mjs";
import * as __contract_dep10 from "../../scripts/build-ui-bundle.mjs";

// Original feature contract: ui-source-catalog.test.mjs
contractSuite("ui-source-catalog", () => {
const assert = __contract_dep0.default;
const { existsSync, readFileSync } = __contract_dep1;
const test = __contract_dep2.default;
const { fileURLToPath } = __contract_dep3;
const { parseJavaScript } = __contract_dep4;
const { buildFrontendIndex, frontendAsset } = __contract_dep5;
const { spawnSync } = __contract_dep6;
const { loadRepository, planApplicationChecks } = __contract_dep7;

const catalogUrl = new URL('../../scripts/lib/ui-source-catalog.mjs', import.meta.url);
const read = relativePath => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('one catalog owns Viewer and audit UI stylesheet inputs', async () => {
  assert.equal(existsSync(catalogUrl), true, 'missing shared UI source catalog');
  const {
    UI_AUDIT_STYLE_SOURCES,
    UI_VIEWER_SOURCES,
    uiSourcePath,
  } = await import(catalogUrl.href);

  assert.ok(UI_VIEWER_SOURCES.length > 0);
  assert.deepEqual(UI_AUDIT_STYLE_SOURCES, [
    'assets/css/app.css',
    ...UI_VIEWER_SOURCES,
  ]);
  for (const role of ['tokens', 'content', 'surface', 'menus'])
    assert.ok(UI_VIEWER_SOURCES.includes(uiSourcePath(role)), `${role} must resolve to a current bundle source`);
  assert.throws(() => uiSourcePath('missing'), /Unknown UI source role/);
  assert.equal(new Set(UI_AUDIT_STYLE_SOURCES).size, UI_AUDIT_STYLE_SOURCES.length);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const index = buildFrontendIndex(root);
  for (const relativePath of UI_AUDIT_STYLE_SOURCES) {
    const asset = frontendAsset(root, relativePath, { index });
    assert.ok(asset.bytes.length > 0, `missing or empty ${relativePath}`);
    assert.equal(existsSync(new URL(`../../${asset.sourcePath}`, import.meta.url)), true, `missing source for ${relativePath}`);
  }
});

test('UI bundle and review contract share the canonical source catalog', () => {
  for (const script of [
    'scripts/build-ui-bundle.mjs',
    'scripts/lib/reviewer-ui-contracts.mjs',
  ]) {
    const ast = parseJavaScript(read(script), { filePath: script }).ast;
    assert.ok(ast.body.some(node => node.type === 'ImportDeclaration'
      && node.source.value.endsWith('/ui-source-catalog.mjs')), `${script} bypasses the shared catalog`);
  }
});

test('each registered UI audit invokes its own mode and rejects unknown modes', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const scripts = JSON.parse(read('package.json')).scripts;
  const catalog = JSON.parse(read('scripts/contracts/application-checks.json'));
  for (const [id, mode] of [['ui-architecture','architecture'], ['ui-components','components'],
    ['ui-layering','layering'], ['ui-ia','information']]) {
    assert.equal(scripts[`check:${id}`], `node scripts/check-ui.mjs ${mode}`);
    assert.deepEqual(catalog.groups.find(group => group.id === id).argv, ['node','scripts/check-ui.mjs',mode]);
    const result = spawnSync(process.execPath, ['scripts/check-ui.mjs', mode], { cwd:root, encoding:'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Viewer/Windows ${mode} audit passed`));
  }
  const invalid = spawnSync(process.execPath, ['scripts/check-ui.mjs','invalid'], { cwd:root, encoding:'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unknown review UI audit/);
});

test('changes to the shared UI audit implementation select all four audits', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const repository = loadRepository(root);
  for (const file of ['scripts/check-ui.mjs','scripts/lib/reviewer-ui-contracts.mjs','scripts/lib/ui-source-catalog.mjs']) {
    const plan = planApplicationChecks({changedFiles:[file],repository});
    for (const id of ['ui-architecture','ui-components','ui-layering','ui-ia'])
      assert.ok(plan.commands.includes(id), `${file} must select ${id}`);
  }
});
});

// Original feature contract: ui-architecture-surface-boundary.test.mjs
contractSuite("ui-architecture-surface-boundary", () => {
const assert = __contract_dep0.default;
const test = __contract_dep2.default;
const { readFileSync } = __contract_dep1;
const { renderProductHtml } = __contract_dep8;
const { auditReviewCss, validateReviewUi } = __contract_dep9;

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const html=renderProductHtml(read).web;

test('review panel handles long nested descriptions without losing source ownership',()=>{
  const altered=html.replace('id="reviewPanelTitle"',
    'id="reviewPanelTitle" data-sample="'+('review detail '.repeat(1500))+'"');
  assert.deepEqual(validateReviewUi('architecture',{html:altered}),[]);
});
test('Viewer placement controls may not redefine shared input skin',()=>{
  const errors=auditReviewCss('viewer.css',
    '.viewer-root .timeline-popover input { background: var(--panel); padding: var(--ui-space-2); }');
  assert.ok(errors.some(x=>x.includes('product CSS may position/size but not reskin UI')));
});
test('layout layer may not redefine component padding or surface skin',()=>{
  const errors=auditReviewCss('layout/surfaces.css',
    '[data-layout="mobile"] .surface-header { padding-block: 0; background: var(--panel); }');
  assert.ok(errors.some(x=>x.includes('layout CSS may position/size but not reskin UI')));
});
test('scoped positioning and shared component styles remain valid',()=>{
  assert.deepEqual(auditReviewCss('viewer.css',
    '.viewer-root .timeline-popover { position: absolute; bottom: var(--ui-space-2); }'),[]);
  assert.deepEqual(auditReviewCss('components/dialogs.css',
    '.viewer-review-panel { padding: var(--ui-space-4); background: var(--panel); }'),[]);
});
test('review panel comparison sections may not be replaced by unrelated surfaces',()=>{
  const altered=html.replace('id="reviewCompareSection"','id="retiredComparisonSection"');
  assert.ok(validateReviewUi('information',{html:altered})
    .some(message=>message.includes('reviewCompareSection')));
});
});

// Original feature contract: viewer-ui-bundle.test.mjs
contractSuite("viewer-ui-bundle", () => {
const assert = __contract_dep0.default;
const test = __contract_dep2.default;
const { fileURLToPath } = __contract_dep3;
const { buildUiBundles } = __contract_dep10;
const { buildFrontendIndex, frontendAsset } = __contract_dep5;

test('viewer bundle reuses current shared UI sources and excludes unused edit forms', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const index = buildFrontendIndex(root);
  const { viewer } = buildUiBundles(root, {
    readSource: publicPath => frontendAsset(root, publicPath, { index }).bytes.toString('utf8'),
  });
  assert.equal(typeof viewer, 'string');
  for (const path of ['tokens/application-tokens.css', 'primitives/controls.css', 'components/topbar.css',
    'components/panels.css', 'components/map-search.css', 'components/dialogs.css']) {
    assert.ok(viewer.includes(`source: assets/css/${path}`), path);
  }
  for (const path of ['primitives/color-picker.css', 'components/workflows.css']) {
    assert.equal(viewer.includes(`source: assets/css/${path}`), false, path);
  }
});
});
