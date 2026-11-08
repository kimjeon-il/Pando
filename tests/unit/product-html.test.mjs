import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';

const read=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');

test('a missing included fragment fails visibly instead of being silently omitted',()=>{
  assert.throws(()=>renderProductHtml(path=>{
    if(path==='src/app/index.html')return '<!-- include:preferences-statusbar -->';
    throw new Error('Missing required fragment: '+path);
  }),/Missing required fragment: .*preferences-statusbar\.html/);
});

test('Viewer HTML includes one copy of its current shared controls',()=>{
  const html=renderProductHtml(read).web;
  for(const key of ['object-search','map-display','preferences','tooltip','notification','map-icons','map-search-control','map-fit-control']){
    const fragment=read(`src/ui/fragments/${key}.html`).replaceAll('\r\n','\n').trim();
    for(const part of fragment.split(/<!-- include:[a-z-]+ -->/).filter(Boolean))
      assert.ok(html.includes(part),`Viewer omitted ${key}`);
  }
  const timeline=read('src/ui/fragments/timeline.html').replaceAll('\r\n','\n').trim();
  assert.ok(html.includes(timeline));
  assert.match(timeline,/id="timelineMonthInput"/);
  assert.match(timeline,/id="timelineViewUnit"/);
  assert.doesNotMatch(html,/id="(?:mapBottomStatus|preferencesStatusBarVisibleInput|entityNameInput|viewerInfoPanel)"/);
  assert.doesNotMatch(html,/data-map-background="(?:builtinHydro|builtinPlaces)"/);
  for(const key of ['graticule','globeShadow'])assert.equal(html.split(`data-map-background="${key}"`).length-1,1);
  assert.doesNotMatch(html,/zoomInBtn|zoomOutBtn|map-view-toolbar/);
});

test('Viewer keeps compact OSM and ODbL credits without the old attribution banner',()=>{
  const html=renderProductHtml(read).web;
  const fragment=read('src/ui/fragments/map-attribution.html').replaceAll('\r\n','\n').trim();
  assert.equal(html.split(fragment).length-1,1);
  assert.doesNotMatch(html,/class="map-attribution"/);
  assert.match(html,/<footer class="map-data-credit" aria-label="지도 자료 출처">/);
  assert.match(html,/href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>© OpenStreetMap<\/a>/);
});
