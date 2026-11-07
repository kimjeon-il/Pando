import { describe as contractSuite } from 'node:test';
import * as __unit_dep0 from "node:test";
import * as __unit_dep1 from "node:assert/strict";
import * as __unit_dep2 from "node:fs";
import * as __unit_dep3 from "node:path";
import * as __unit_dep4 from "node:url";
import * as __unit_dep5 from "node:crypto";
import * as __unit_dep6 from "../../scripts/lib/product-html.mjs";
import * as __unit_dep7 from "../../scripts/lib/frontend-layout.mjs";
import * as __unit_dep8 from "../../scripts/lib/css-analysis.mjs";
import * as __unit_dep9 from "../../scripts/build-ui-bundle.mjs";

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
