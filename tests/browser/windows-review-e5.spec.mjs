import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=()=>JSON.parse(readFileSync(new URL('../fixtures/review/e2-synthetic-review.json',import.meta.url),'utf8'));

test('E5 Windows E4 review is flat, read-only, searchable and exports only a local correction draft',async({page})=>{
  test.setTimeout(180000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    Object.defineProperty(window,'PANDOLAB_NATIVE_REVIEW',{value:true,writable:false,configurable:false});
    const calls=[];
    window.__E5NativeSaveCalls=calls;
    window.__TAURI_INTERNALS__={
      invoke:async(command,payload)=>{
        calls.push({command,payload});
        if(command==='save_review_correction')return {cancelled:false};
        throw new Error('Native review has no permission for '+command);
      },
    };
  });
  await page.goto('/review.html?debug=1&renderer=canvas');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
  await expect(page.locator('#reviewPanel')).toBeVisible({timeout:20000});
  await expect(page.locator('#reviewPanelBtn')).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#editorSurface')).toHaveCount(0);
  const runtime=await page.evaluate(()=>({
    projection:window.__PANDOLAB_VIEWER__.mapProjection(),
    readOnly:window.__PANDOLAB_VIEWER__.readOnly,
    state:window.__PANDOLAB_VIEWER__.documentState(),
  }));
  expect(runtime.projection).toBe('flat');
  expect(runtime.readOnly).toBe(true);
  expect(runtime.state.canUndo).toBe(false);
  const bundle=fixture();
  const diff={schemaVersion:1,dataset:structuredClone(bundle.proposal.dataset),
    comparisonMonth:bundle.proposal.comparisonMonth,indexChangedEntities:2,totalChangedEntities:2,
    scope:{batchIndex:1,batchCount:1,complete:true},
    selectedAtComparisonMonth:5,issues:[],nonMapMetadata:[],readObjects:[],
    changes:bundle.proposal.changes.map(({evidenceIds,...change})=>change),
  };
  const files=[['e3-source-diff.json',diff],['e3-pending-proposal.json',bundle]].map(([name,value])=>({
    name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value)),
  }));
  await page.locator('#reviewEvidenceInput').setInputFiles(files);
  await expect(page.locator('#reviewLoadStatus')).toContainText('검수 자료 읽기 완료',{timeout:25000});
  await expect(page.locator('#reviewState')).toContainText('pending');
  await expect(page.locator('#reviewSelectedObject')).toHaveText('state:EXAMPLE_A');
  await page.locator('#reviewKindFilter').selectOption('geometry');
  await expect(page.locator('#reviewObjectList')).toContainText('state:EXAMPLE_A');
  await page.locator('#reviewIssueKind').selectOption('geometry');
  await page.locator('#reviewIssueReason').fill('국경 적용 일자와 연구 보고서의 근거를 다시 검수해 주세요.');
  await page.locator('#reviewExportRequest').click();
  await expect(page.locator('#reviewCorrectionStatus')).toContainText('Windows에 수정 요청서를 저장했습니다.');
  const records=await page.evaluate(()=>window.__E5NativeSaveCalls);
  expect(records).toHaveLength(1);
  expect(records[0].command).toBe('save_review_correction');
  expect(records[0].payload.draft.kind).toBe('pandolab-review-correction-draft');
  expect(records[0].payload.draft.status).toBe('local-draft');
  expect(records[0].payload.draft.sourceEntityId).toBe('state:EXAMPLE_A');
  const state=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
  expect(state.canUndo).toBe(false);
  expect(errors).toEqual([]);
});

test('E5 leaves public web viewer globe and manual review behavior unchanged',async({page})=>{
  test.setTimeout(150000);
  await page.goto('/?debug=1&renderer=canvas');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.mapProjection())).toBe('globe');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.readOnly)).toBe(true);
  await expect(page.locator('#reviewPanel')).toBeHidden();
  await page.locator('#reviewPanelBtn').click();
  await expect(page.locator('#reviewPanel')).toBeVisible();
  await page.locator('#reviewCloseBtn').click();
  await expect(page.locator('#reviewPanel')).toBeHidden();
});
