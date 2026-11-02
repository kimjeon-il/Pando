import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bundleTemplate=()=>JSON.parse(readFileSync(new URL('../fixtures/review/e2-synthetic-review.json',import.meta.url),'utf8'));
const geo=width=>({type:'Polygon',coordinates:[[[70,30],[70+width,30],[70+width,36],[70,36],[70,30]]]});
function dataFixture(baseRevision){
  const proposal=bundleTemplate(),before=geo(4),after=geo(9);
  if(baseRevision)proposal.proposal.dataset.baseRevision=baseRevision;
  const oldVersion='geo-original',newVersion='geo-after';
  proposal.proposal.comparisonMonth='2008-10';
  proposal.proposal.changes=[{
    sourceEntityId:'state:EXAMPLE_A',kind:'geometry',field:'geometry',
    validFrom:'2008-10-14',validTo:null,
    before:{versionId:oldVersion,sha256:sha(Buffer.from(JSON.stringify(before)))},
    after:{versionId:newVersion,sha256:sha(Buffer.from(JSON.stringify(after)))},
    evidenceIds:['research-map'],
  }];
  const rawBefore=JSON.stringify({schemaVersion:2,entityId:'state:EXAMPLE_A',
    geometryVersions:[{versionId:oldVersion,geometry:before}]});
  const rawAfter=JSON.stringify({schemaVersion:2,entityId:'state:EXAMPLE_A',
    geometryVersions:[{versionId:newVersion,geometry:after}]});
  const diff={
    schemaVersion:1,dataset:structuredClone(proposal.proposal.dataset),comparisonMonth:'2008-10',
    indexChangedEntities:1,totalChangedEntities:1,scope:{batchIndex:1,batchCount:1,complete:true},
    readObjects:[
      {sourceEntityId:'state:EXAMPLE_A',revision:proposal.proposal.dataset.baseRevision,sha256:sha(Buffer.from(rawBefore))},
      {sourceEntityId:'state:EXAMPLE_A',revision:proposal.proposal.dataset.candidateRevision,sha256:sha(Buffer.from(rawAfter))},
    ],
    changes:proposal.proposal.changes.map(({evidenceIds,...row})=>row),
    issues:[],nonMapMetadata:[],selectedAtComparisonMonth:1,
  };
  const verification={schemaVersion:1,kind:'e3-source-revision-verification',
    dataset:structuredClone(diff.dataset),comparisonMonth:diff.comparisonMonth,
    sourceHashCheck:'passed',changedEntities:1,totalChangedEntities:1,scope:structuredClone(diff.scope),
    modeledChanges:1,coverage:'modeled',historicalAccuracy:'not-verified',issues:[],
    checks:[{name:'schema',outcome:'passed'},{name:'temporal',outcome:'passed'},
      {name:'source-integrity',outcome:'passed'},{name:'geometry-topology',outcome:'not-run'}]};
  const files=[['e3-source-diff.json',diff],['e3-verification.json',verification],
    ['e3-pending-proposal.json',proposal]].map(([name,value])=>({
      name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value,null,2)+'\n'),
    }));
  const manifest={schemaVersion:1,kind:'e3-generated-revision-evidence',
    dataset:structuredClone(diff.dataset),proposalId:proposal.proposal.proposalId,
    scope:structuredClone(diff.scope),files:files.map(x=>({name:x.name,sha256:sha(x.buffer),bytes:x.buffer.byteLength}))};
  files.push({name:'e3-output-manifest.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
  return {files,rawBefore,rawAfter,diff};
}

test('E4 map revision follows the actual builtin or opened project',async({page})=>{
  test.setTimeout(180000);
  const pin=JSON.parse(readFileSync(new URL('../../config/library-data.json',import.meta.url),'utf8')).revision;
  // Historical GeoPackage bytes and its JSON oracle are checked-in, immutable
  // fixtures. E4 must not instantiate the retired editor-only GPKG writer.
  const model=dataFixture(pin);
  const project=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json',import.meta.url),'utf8'));
  const projectBytes=readFileSync(new URL('../fixtures/timeline-exchange/complex.gpkg',import.meta.url));
  await ready(page);
  await page.locator('#reviewPanelBtn').click();
  await page.locator('#reviewEvidenceInput').setInputFiles(model.files);
  await expect(page.locator('#reviewMapRevision')).toContainText('변경 전');
  await page.locator('#projectFileInput').setInputFiles({name:'review-file.gpkg',mimeType:'application/geopackage+sqlite3',buffer:projectBytes});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId)).toBe(project.documentId);
  await expect(page.locator('#reviewMapRevision')).toContainText('파일 지도');
  await page.evaluate(()=>document.getElementById('builtinMapBtn').click());
  await expect(page.locator('#reviewMapRevision')).toContainText('변경 전',{timeout:120000});
});
async function ready(page){
  await page.goto('/?debug=1&renderer=canvas');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
}

test('E4 can compare again after cancelling an in-flight source request',async({page})=>{
  test.setTimeout(180000);
  const model=dataFixture();
  let releaseFirst;
  const firstRequest=new Promise(resolve=>{releaseFirst=resolve;});
  let requested;
  const requestStarted=new Promise(resolve=>{requested=resolve;});
  let first=true;
  await page.route('https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/**',async route=>{
    if(first){first=false;requested();await firstRequest;}
    const body=route.request().url().includes(model.diff.readObjects[0].sha256)?model.rawBefore:model.rawAfter;
    await route.fulfill({status:200,contentType:'application/json',body,headers:{'access-control-allow-origin':'*'}}).catch(()=>{});
  });
  await ready(page);
  await page.locator('#reviewPanelBtn').click();
  // The E4 panel is a lazy import; wait for event handlers before setting files.
  await expect(page.locator('#reviewPanel')).toBeVisible();
  await page.locator('#reviewEvidenceInput').setInputFiles(model.files);
  await expect(page.locator('#reviewLoadStatus')).toContainText('검수 자료 읽기 완료');
  await page.locator('#reviewFetchGeometry').click();
  await requestStarted;
  await expect(page.locator('#reviewFetchGeometry')).toBeDisabled();
  await page.locator('#reviewChangeList button').first().click();
  releaseFirst();
  await expect(page.locator('#reviewFetchGeometry')).toBeEnabled();
  await page.locator('#reviewFetchGeometry').click();
  await expect(page.locator('#reviewCompareStatus')).toContainText('원본 SHA-256 검증 완료',{timeout:20000});
});

test('E4 review opens matching immutable revisions, draws verified source previews, exports correction without writing the map',async({page})=>{
  test.setTimeout(180000);
  const model=dataFixture(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/**',async route=>{
    const url=route.request().url(),body=url.includes(model.diff.readObjects[0].sha256)?model.rawBefore:model.rawAfter;
    await route.fulfill({status:200,contentType:'application/json',body,
      headers:{'access-control-allow-origin':'*'}});
  });
  await ready(page);
  const old=await page.evaluate(()=>JSON.stringify(window.__PANDOLAB_VIEWER__.documentSnapshot()));
  await page.locator('#reviewPanelBtn').click();
  await expect(page.locator('#reviewPanel')).toBeVisible();
  await expect(page.locator('#reviewPanelBtn')).toHaveAttribute('aria-expanded','true');
  await page.locator('#reviewEvidenceInput').setInputFiles(model.files);
  await expect(page.locator('#reviewLoadStatus')).toContainText('검수 자료 읽기 완료');
  await expect(page.locator('#reviewCounts')).toHaveText('1개 / 1건');
  await expect(page.locator('#reviewState')).toContainText('pending');
  await expect(page.locator('#reviewChecks')).toContainText('geometry-topology : not-run');
  await expect(page.locator('#reviewTrustNotice')).toContainText('SHA-256 일치');
  await expect(page.locator('#reviewSelectedObject')).toHaveText('state:EXAMPLE_A');
  await expect(page.locator('#reviewFocusBtn')).toBeDisabled();
  await expect(page.locator('#reviewSourceLinks a').first()).toHaveAttribute('href',
    /github\.com\/kimjeon-il\/PandoLab-library-data\/blob\/c{40}\/reports\/borders\//);
  await page.locator('#reviewFetchGeometry').click();
  await expect(page.locator('#reviewCompareStatus')).toContainText('원본 SHA-256 검증 완료',{timeout:20000});
  await expect(page.locator('#reviewGeometryPreviews')).toBeVisible();
  const before=await page.locator('#reviewBeforeMap path').getAttribute('d');
  const after=await page.locator('#reviewAfterMap path').getAttribute('d');
  expect(before?.length).toBeGreaterThan(10);expect(after?.length).toBeGreaterThan(10);
  expect(before).not.toEqual(after);
  await page.locator('#reviewIssueKind').selectOption('geometry');
  await page.locator('#reviewIssueReason').fill('외교 문서의 효력일과 도형 변경 적용일이 서로 다른지 재검증 바랍니다.');
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#reviewExportRequest').click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^pando-review-correction-/);
  await expect(page.locator('#reviewCorrectionStatus')).toContainText('로컬 수정 요청서');
  const tampered={...model.diff,schemaVersion:900,dataset:{...model.diff.dataset,candidateRevision:'f'.repeat(40)}};
  await page.locator('#reviewEvidenceInput').setInputFiles([
    {name:'e3-source-diff.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(tampered))},
  ]);
  await expect(page.locator('#reviewLoadStatus')).toContainText('적용하지 않았습니다');
  await expect(page.locator('#reviewSelectedObject')).toHaveText('state:EXAMPLE_A');
  expect(await page.evaluate(()=>JSON.stringify(window.__PANDOLAB_VIEWER__.documentSnapshot()))).toEqual(old);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#reviewPanel')).toBeHidden();
  await expect(page.locator('#reviewPanelBtn')).toHaveAttribute('aria-expanded','false');
  expect(errors).toEqual([]);
});

test('E4 review remains a bounded responsive panel and never claims an unverified preview',async({page})=>{
  test.setTimeout(180000);
  await page.setViewportSize({width:390,height:844});
  const model=dataFixture(),errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  await ready(page);
  // The desktop action remains in the DOM; the dedicated mobile menu owns its
  // own trigger and does not instantiate a second review owner.
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mobileReviewBtn')).toBeVisible();
  await page.locator('#mobileReviewBtn').click();
  await expect(page.locator('#reviewPanel')).toBeVisible();
  const viewport=page.viewportSize(),rect=await page.locator('#reviewPanel').boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x+rect.width).toBeLessThanOrEqual(viewport.width+1);
  await page.locator('#reviewEvidenceInput').setInputFiles(model.files.slice(0,3));
  await expect(page.locator('#reviewTrustNotice')).toContainText('산출물 목록 SHA 검증 없음');
  await expect(page.locator('#reviewGeometryPreviews')).toBeHidden();
  await page.locator('#reviewFetchGeometry').click();
  await expect(page.locator('#reviewCompareStatus')).toContainText('형상 비교 불가',{timeout:20000});
  await expect(page.locator('#reviewGeometryPreviews')).toBeHidden();
  await page.locator('#reviewCloseBtn').click();
  await expect(page.locator('#reviewPanel')).toBeHidden();
  expect(errors).toEqual([]);
});
