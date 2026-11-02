import {readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const html=renderProductHtml(read).web;
test('Viewer map and review actions own one canonical command surface',()=>{
  assert.match(html, /class="[^"]*map-command-toolbar/);
  for(const id of ['reviewPanelBtn','mobileReviewBtn','reviewPanel','reviewCloseBtn','reviewLoadBtn',
    'reviewExportRequest','mobileFileBtn','fileMenu','openProjectBtn','mapDisplayBtn']) {
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  }
  assert.match(html, /id="reviewPanelBtn"[^>]*aria-controls="reviewPanel"/);
  assert.match(html, /id="mobileReviewBtn"[^>]*aria-controls="reviewPanel"/);
  assert.doesNotMatch(html,/id="(?:editorSurface|createMenuBtn|undoBtn|redoBtn|objectDeleteBtn)"/);
});
test('file and mobile navigation remain outside the map canvas hierarchy',()=>{
  const main=html.match(/<main\b[^>]*class="map-wrap"[\s\S]*?<\/main>/)?.[0];
  assert.ok(main);
  for(const id of ['fileMenu','mobileGlobalMenu','reviewPanel']) {
    assert.doesNotMatch(main,new RegExp('id="'+id+'"'));
    assert.ok(html.indexOf('id="'+id+'"')>html.indexOf('</main>'),id);
  }
});
test('desktop shell retains the shared design tokens without retired layer geometry',()=>{
  const shell=read('shared/frontend/css/components/editor-shell.css');
  const tokens=read('shared/frontend/css/tokens/design-tokens.css');
  assert.doesNotMatch(shell,/\[data-layout="wide"\] \.adaptive-nav/);
  assert.doesNotMatch(tokens+shell,/--ui-(?:v2|shell)-workspace-(?:rail|nav|active)-/);
  assert.doesNotMatch(tokens+shell,/(?:--design-left-panel-width|--ui-shell-left-panel-width|\.left-panel)/);
});
