import { describe as contractSuite } from 'node:test';
import * as __merge_dep0 from "node:test";
import * as __merge_dep1 from "node:assert/strict";
import * as __merge_dep2 from "node:fs";
import * as __merge_dep3 from "node:url";
import * as __merge_dep4 from "../../scripts/lib/source-analysis.mjs";
import * as __merge_dep5 from "../../scripts/lib/frontend-layout.mjs";
import * as __merge_dep6 from "node:child_process";
import * as __merge_dep7 from "../../scripts/plan-application-checks.mjs";
import * as __merge_dep8 from "../../scripts/lib/product-html.mjs";
import * as __merge_dep9 from "../../scripts/lib/reviewer-ui-contracts.mjs";
import * as __merge_dep10 from "../../scripts/build-ui-bundle.mjs";
import * as __merge_dep11 from "node:path";
import * as __merge_dep12 from "node:crypto";
import * as __merge_dep13 from "../../scripts/lib/css-analysis.mjs";

// Original feature contract: ui-source-catalog.test.mjs
contractSuite("ui-source-catalog", () => {
const { describe : contractSuite } = __merge_dep0;
const __contract_dep0 = __merge_dep1;
const __contract_dep1 = __merge_dep2;
const __contract_dep2 = __merge_dep0;
const __contract_dep3 = __merge_dep3;
const __contract_dep4 = __merge_dep4;
const __contract_dep5 = __merge_dep5;
const __contract_dep6 = __merge_dep6;
const __contract_dep7 = __merge_dep7;
const __contract_dep8 = __merge_dep8;
const __contract_dep9 = __merge_dep9;
const __contract_dep10 = __merge_dep10;

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
    assert.match(result.stdout, new RegExp(`Viewer ${mode} audit passed`));
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
});

// Original feature contract: brand-icons.test.mjs
contractSuite("brand-icons", () => {
const { describe : contractSuite } = __merge_dep0;
const __unit_dep0 = __merge_dep0;
const __unit_dep1 = __merge_dep1;
const __unit_dep2 = __merge_dep2;
const __unit_dep3 = __merge_dep11;
const __unit_dep4 = __merge_dep3;
const __unit_dep5 = __merge_dep12;
const __unit_dep6 = __merge_dep8;
const __unit_dep7 = __merge_dep5;
const __unit_dep8 = __merge_dep13;
const __unit_dep9 = __merge_dep10;

// Original feature contract: brand-icons.test.mjs
contractSuite("brand-icons", () => {
const { test } = __unit_dep0;
const assert = __unit_dep1.default;
const { readFileSync } = __unit_dep2;
const { join } = __unit_dep3;
const { fileURLToPath } = __unit_dep4;
const { createHash } = __unit_dep5;
const { renderProductHtml } = __unit_dep6;
const { buildFrontendIndex } = __unit_dep7;

const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=path=>readFileSync(join(root,path));
const text=path=>bytes(path).toString('utf8');
const brand='shared/frontend/static/brand/';
const templates={
 'apps/viewer/templates/index.html':'<!doctype html><head><link rel="icon" href="data:,"></head><body>viewer</body>',
};
const pages=()=>renderProductHtml(path=>templates[path]??text(path));

function icoSizes(buffer){
 assert.equal(buffer.readUInt16LE(0),0);assert.equal(buffer.readUInt16LE(2),1);
 const count=buffer.readUInt16LE(4),sizes=[];
 for(let i=0;i<count;i++){
  const at=6+i*16,width=buffer[at]||256,height=buffer[at+1]||256;
  const length=buffer.readUInt32LE(at+8),offset=buffer.readUInt32LE(at+12);
  assert.equal(width,height);assert.ok(offset>=6+count*16&&offset+length<=buffer.length);
  const image=buffer.subarray(offset,offset+length);
  assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16),width);assert.equal(image.readUInt32BE(20),height);sizes.push(width);
 }
 return sizes.sort((a,b)=>a-b);
}

test('Viewer uses the canonical shared brand icons',()=>{
 for(const [mode,page] of Object.entries(pages())){
  assert.doesNotMatch(page,/href="data:,"/);
  assert.equal((page.match(/rel="icon"/g)||[]).length,2);
  assert.equal((page.match(/rel="apple-touch-icon"/g)||[]).length,1);
  assert.match(page,/assets\/brand\/favicon\.svg\?v=\{\{assetRevision\}\}/);
  assert.match(page,/assets\/brand\/favicon\.ico\?v=\{\{assetRevision\}\}/);
  assert.equal(mode,'web');assert.match(page,/<body>viewer<\/body>/);
 }
});

test('brand URLs resolve under the published Viewer',()=>{
 const index=buildFrontendIndex(root),links=[...pages().web.matchAll(/href="(assets\/brand\/[^"?]+)[^"]*"/g)].map(m=>m[1]);
 assert.equal(links.length,3);
 for(const path of links){
  assert.equal(index.get(path)?.product,'shared',path);
  assert.equal(index.get(path)?.sourcePath,'shared/frontend/static/'+path.slice(7));
  assert.ok(bytes(index.get(path).sourcePath).length);
  // Browser Pages uses a subpath; there is no native shell origin.
  for(const [page,baseHref,prefix]of [['https://example.test/Pando/',null,'/Pando/']]){
   const base=baseHref?new URL(baseHref,page):new URL(page);
   assert.equal(new URL(path,base).pathname,prefix+path);
  }
 }
 assert.doesNotMatch(text('shared/frontend/ui/fragments/brand-icons.html'),/rel="manifest"|https?:/);
});

test('Viewer favicon containers retain their reviewed optical-size PNG frames',()=>{

 assert.deepEqual(icoSizes(bytes(brand+'favicon.ico')),[16,32,48]);
 const apple=bytes(brand+'apple-touch-icon.png');assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
 const approved=JSON.parse(text('design/brand/asset-hashes.json'));
 for(const [path,sha]of Object.entries(approved)){
  assert.ok(path.startsWith('shared/frontend/static/brand/'),'Only Viewer brand assets may be approved');
  const raw=bytes(path),content=/\.(?:svg|xml)$/.test(path)?Buffer.from(raw.toString('utf8').replaceAll('\r\n','\n')):raw;
  assert.equal(createHash('sha256').update(content).digest('hex'),sha,path);
 }
});

test('favicon preserves the reviewed small form instead of auto-scaling the standard glyph',()=>{
 const favicon=text(brand+'favicon.svg');
 assert.match(favicon,/<rect\b[^>]*fill="#FFFFFF"/);
 assert.equal((favicon.match(/<path\b[^>]*fill="#315EDB"/g)||[]).length,2);
 assert.match(favicon,/M9 6 H18 V27 H24 V42/);assert.match(favicon,/M39 42 H30 V21 H24 V6/);
 assert.doesNotMatch(favicon,/<(?:script|image|filter)\b|href=/);
});
});

// Original feature contract: font-assets.test.mjs
contractSuite("font-assets", () => {
const assert = __unit_dep1.default;
const { createHash } = __unit_dep5;
const { readFileSync } = __unit_dep2;
const test = __unit_dep0.default;

test('bundled Pretendard font bytes and OFL license remain immutable',()=>{
 const font=readFileSync(new URL('../../shared/frontend/static/fonts/pretendard-v1.3.9/PretendardVariable.woff2',import.meta.url));
 const digest=createHash('sha256').update(font).digest('hex');
 assert.equal(digest,'9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4');
 const license=readFileSync(new URL('../../shared/frontend/static/fonts/pretendard-v1.3.9/LICENSE.txt',import.meta.url),'utf8');
 assert.match(license.toUpperCase(),/SIL OPEN FONT LICENSE/);
});
});

// Original feature contract: css-analysis.test.mjs
contractSuite("css-analysis", () => {
const assert = __unit_dep1.default;
const test = __unit_dep0.default;
const { collectCssRules } = __unit_dep8;
const { renderUiBundle } = __unit_dep9;

test('CSS analysis preserves quoted delimiters, nested contexts and important flags', () => {
  const rules = collectCssRules('/* .fake { color: red } */ @media (width > 10px) { .a:is(.b, .c), [data-name="x,y"] { content: "};:"; color: var(--ink) ! /* reason */ important; } }');
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, ['.a:is(.b, .c)', '[data-name="x,y"]']);
  assert.equal(rules[0].context, '@media (width > 10px)');
  assert.deepEqual(rules[0].declarations.map(({ property, value, important }) => ({ property, value, important })), [
    { property: 'content', value: '"};:"', important: false },
    { property: 'color', value: 'var(--ink)', important: true },
  ]);
});

test('CSS analysis handles nesting and excludes animation steps from selector policies', () => {
  const rules = collectCssRules('.card { color: var(--ink); &:hover { opacity: .5 } } @keyframes spin { from { opacity: 0 } to { opacity: 1 } }');
  assert.deepEqual(rules.map(rule => rule.prelude), ['.card', '&:hover']);
  assert.equal(rules[1].context, '.card');
  assert.throws(() => collectCssRules('.broken { color: red', { filePath: 'broken.css' }), /broken\.css/);
});

test('bundle generation preserves source order and content without a copied source inventory', () => {
  const contents = new Map([['first.css', '  .a { content: "x;y"; }\r\n'], ['next.css', '.b { color: blue; }']]);
  const output = renderUiBundle(['next.css', 'first.css'], file => contents.get(file));
  assert.ok(output.indexOf('.b { color: blue; }') < output.indexOf('.a { content: "x;y"; }'));
  assert.match(output, /source-count: 2/);
  assert.ok(output.endsWith('\n\n'));
  assert.equal(output.includes('\r'), false);
});
});
});
