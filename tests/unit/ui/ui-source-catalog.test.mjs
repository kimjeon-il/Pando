import { describe as contractSuite } from 'node:test';
import * as __merge_dep0 from "node:test";
import * as __merge_dep1 from "node:assert/strict";
import * as __merge_dep2 from "node:fs";
import * as __merge_dep3 from "node:url";
import "../../../scripts/lib/source-analysis.mjs";
import * as __merge_dep5 from "../../../scripts/lib/frontend-layout.mjs";
import "node:child_process";
import "../../../scripts/plan-application-checks.mjs";
import * as __merge_dep8 from "../../../scripts/lib/product-html.mjs";
import * as __merge_dep9 from "../../../scripts/lib/reviewer-ui-contracts.mjs";
import * as __merge_dep10 from "../../../scripts/build-ui-bundle.mjs";
import * as __merge_dep11 from "node:path";
import "node:crypto";
import * as __merge_dep13 from "../../../scripts/lib/css-analysis.mjs";
contractSuite("ui-source-catalog", () => {
const { describe : contractSuite } = __merge_dep0;
const __contract_dep0 = __merge_dep1;
const __contract_dep1 = __merge_dep2;
const __contract_dep2 = __merge_dep0;

const __contract_dep8 = __merge_dep8;
const __contract_dep9 = __merge_dep9;


contractSuite("ui-architecture-surface-boundary", () => {
const assert = __contract_dep0.default;
const test = __contract_dep2.default;
const { readFileSync } = __contract_dep1;
const { renderProductHtml } = __contract_dep8;
const { auditReviewCss, validateReviewUi } = __contract_dep9;

const read=path=>readFileSync(new URL("../../../"+path,import.meta.url),'utf8');
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

});
contractSuite("brand-icons", () => {
const { describe : contractSuite } = __merge_dep0;
const __unit_dep0 = __merge_dep0;
const __unit_dep1 = __merge_dep1;
const __unit_dep2 = __merge_dep2;
const __unit_dep3 = __merge_dep11;
const __unit_dep4 = __merge_dep3;

const __unit_dep6 = __merge_dep8;
const __unit_dep7 = __merge_dep5;
const __unit_dep8 = __merge_dep13;
const __unit_dep9 = __merge_dep10;
contractSuite("brand-icons", () => {
const { test } = __unit_dep0;
const assert = __unit_dep1.default;
const { readFileSync } = __unit_dep2;
const { join } = __unit_dep3;
const { fileURLToPath } = __unit_dep4;

const { renderProductHtml } = __unit_dep6;
const { buildFrontendIndex } = __unit_dep7;

const root=fileURLToPath(new URL("../../../",import.meta.url));
const bytes=path=>readFileSync(join(root,path));
const text=path=>bytes(path).toString('utf8');

const templates={
 'src/app/index.html':'<!doctype html><head><link rel="icon" href="data:,"></head><body>viewer</body>',
};
const pages=()=>renderProductHtml(path=>templates[path]??text(path));

test('brand URLs resolve under the published Viewer',()=>{
 const index=buildFrontendIndex(root),links=[...pages().web.matchAll(/href="(assets\/brand\/[^"?]+)[^"]*"/g)].map(m=>m[1]);
 assert.equal(links.length,3);
 for(const path of links){
  assert.equal(index.get(path)?.product,'viewer',path);
  assert.equal(index.get(path)?.sourcePath,'assets/'+path.slice(7));
  assert.ok(bytes(index.get(path).sourcePath).length);
  // Browser Pages uses a subpath; there is no native shell origin.
  for(const [page,baseHref,prefix]of [['https://example.test/Pando/',null,'/Pando/']]){
   const base=baseHref?new URL(baseHref,page):new URL(page);
   assert.equal(new URL(path,base).pathname,prefix+path);
  }
 }
 assert.doesNotMatch(text('src/ui/fragments/brand-icons.html'),/rel="manifest"|https?:/);
});

});

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
