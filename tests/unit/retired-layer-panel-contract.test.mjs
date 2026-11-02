import {repositoryFrontendUrl} from '../helpers/frontend-source.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildFrontendIndex} from '../../scripts/lib/frontend-layout.mjs';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
test('retired layer panel stylesheet does not return to the shared Viewer',()=>{
  const cssSources=['assets/css/app.css','assets/css/layout/surfaces.css',
    'assets/css/components/content.css','assets/css/components/editor-shell.css',
    'assets/css/components/panels.css','assets/css/components/mobile-sheets.css']
    .map(path=>readFileSync(repositoryFrontendUrl(path),'utf8')).join('\n');
  assert.equal(buildFrontendIndex(fileURLToPath(new URL('../../',import.meta.url))).has('assets/css/features/layer-panel.css'),false);
  for(const cls of ['.surface-map','.left-panel','.layer-panel-footer','.layer-action-bar','.layer-child','.layer-folder'])
    assert.doesNotMatch(cssSources,new RegExp(cls.replace('.','\\.')));
});
test('Viewer navigation retains actual mobile review and read-only map controls',()=>{
  const html=renderProductHtml(read).web;
  for(const id of ['mobileGlobalMenu','mobileMenuBtn','mobileDisplayBtn',
    'mobileReviewBtn','reviewPanel','mapDisplaySurface','objectSearchSurface']) {
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  for(const id of ['createMenu','editorSurface','mobileEditBtn','mobileCreateBtn']) {
    assert.doesNotMatch(html,new RegExp('id="'+id+'"'));
  }
});
test('reviewed source and comparison controls replace retired GIS write/export UI',()=>{
  const html=renderProductHtml(read).web;
  for(const id of ['reviewSourceLinks','reviewBeforeMap','reviewAfterMap',
    'reviewEvidenceInput','reviewExportRequest','reviewIssueReason'])
    assert.match(html,new RegExp('id="'+id+'"'));
  for(const id of ['gisStepIndicator','gisExportFormat','convertGenericFeatureBtn'])
    assert.doesNotMatch(html,new RegExp('id="'+id+'"'));
});
