import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('product HTML is generated from one source for each common viewing control',async()=>{
 const {renderProductHtml}=await import('../../scripts/lib/product-html.mjs');
 const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
 const pages=renderProductHtml(read);
 for(const page of Object.values(pages))assert.doesNotMatch(page,/data-map-background="(?:builtinHydro|builtinPlaces)"/);
 for(const key of ['object-search','map-display','preferences','tooltip','notification','map-icons','map-search-control','map-fit-control']){
  const fragment=read(`ui/fragments/${key}.html`).replaceAll('\r\n','\n').trim();
  for(const sharedPart of fragment.split(/<!-- include:[a-z-]+ -->/).filter(Boolean)){
   assert.ok(pages.web.includes(sharedPart),`web omitted ${key}`);
   assert.ok(pages.editor.includes(sharedPart),`app omitted ${key}`);
  }
 }
 const terrain=read('ui/fragments/map-terrain.html').replaceAll('\r\n','\n').trim();
 const timeline=read('ui/fragments/timeline.html').replaceAll('\r\n','\n').trim();
 assert.ok(pages.web.includes(timeline));
 assert.doesNotMatch(pages.editor,/timeline-status|timelinePreviousYear|timelinePreviousMonth|timelineMonthButton|timelineMonthInput|timelineNextMonth|timelineNextYear/);
 assert.doesNotMatch(pages.editor,/timelineComparePin|timelineComparisonPanel|autosaveRecoveryBtn/);
 assert.doesNotMatch(pages.editor,/data-map-display-row="advanced"/);
 assert.doesNotMatch(pages.web,/data-map-display-row="advanced"/);
 assert.match(pages.editor,/id="fileAdvancedBtn"/);
 for(const key of ['graticule','globeShadow']){
  assert.equal(pages.web.split(`data-map-background="${key}"`).length-1,1,key);
  assert.doesNotMatch(pages.editor,new RegExp(`data-map-background="${key}"`));
 }
 assert.doesNotMatch(pages.editor,/id="(?:globeBtn|flatBtn|mapProjectionMenuTrigger|projectionControl)"/);
 assert.match(pages.web,/id="globeBtn"/);assert.match(pages.web,/id="flatBtn"/);
 assert.ok(pages.web.includes(terrain));assert.ok(!pages.editor.includes('terrainNoneRadio'));
 assert.ok(!pages.web.includes('entityNameInput'));
 assert.ok(pages.editor.includes('entityNameInput'));
 assert.ok(!pages.web.includes('viewerInfoPanel'));
 for(const page of Object.values(pages))assert.doesNotMatch(page,/zoomInBtn|zoomOutBtn|map-view-toolbar/);
 const changed=renderProductHtml(path=>path==='ui/fragments/tooltip.html'?read(path).replace('role="tooltip"','role="tooltip" data-source-probe="shared"'):read(path));
 assert.ok(changed.web.includes('data-source-probe="shared"'));
 assert.ok(changed.editor.includes('data-source-probe="shared"'));
});
