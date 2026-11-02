import assert from 'node:assert/strict';
import test from 'node:test';
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';
import {readFileSync} from 'node:fs';
import {validateReviewUi} from '../../scripts/lib/reviewer-ui-contracts.mjs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const source=renderProductHtml(read).web;
for(const kind of ['architecture','components','information','layering']) {
 test('R1 '+kind+' targets the current Viewer/Windows reviewer',()=>{
   assert.deepEqual(validateReviewUi(kind),[]);
 });
}
test('R1 fails closed when the review panel or controls disappear',()=>{
  assert.ok(validateReviewUi('information',{html:source.replace('id="reviewDetail"','id="retiredReviewDetail"')})
    .some(reason=>reason.includes('reviewDetail')));
  assert.ok(validateReviewUi('components',{html:source.replace('aria-controls="reviewPanel"','aria-controls="retiredEditor"')})
    .some(reason=>reason.includes('reviewPanelBtn')));
});
test('R1 explicitly rejects a returned graphical-editor entrypoint',()=>{
  const mutated=source.replace('id="viewerCanvas"','id="viewerCanvas" data-test="x"')+
    '<button id="modeDraftInsertBtn">edit</button>';
  assert.ok(validateReviewUi('architecture',{html:mutated})
    .some(reason=>reason.includes('Retired editor control')));
});
