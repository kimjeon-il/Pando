import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';
import {auditReviewCss,validateReviewUi} from '../../scripts/lib/reviewer-ui-contracts.mjs';

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
