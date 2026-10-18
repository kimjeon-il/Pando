import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('product HTML is generated from one source for each common viewing control',async()=>{
 const {renderProductHtml}=await import('../../scripts/lib/product-html.mjs');
 const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
 const pages=renderProductHtml(read);
 for(const key of ['object-search','map-display','preferences','timeline','tooltip','notification','map-icons','map-search-control','map-fit-control']){
  const fragment=read(`ui/fragments/${key}.html`).trim();
  assert.ok(pages.web.includes(fragment),`web omitted ${key}`);
  assert.ok(pages.editor.includes(fragment),`app omitted ${key}`);
 }
 assert.ok(!pages.web.includes('entityNameInput'));
 assert.ok(pages.editor.includes('entityNameInput'));
 assert.ok(!pages.web.includes('viewerInfoPanel'));
 const changed=renderProductHtml(path=>path==='ui/fragments/tooltip.html'?read(path).replace('role="tooltip"','role="tooltip" data-source-probe="shared"'):read(path));
 assert.ok(changed.web.includes('data-source-probe="shared"'));
 assert.ok(changed.editor.includes('data-source-probe="shared"'));
});
