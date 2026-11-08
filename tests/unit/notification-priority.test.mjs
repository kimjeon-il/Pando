import { describe as contractSuite } from 'node:test';
import * as __contract_dep0 from "node:test";
import * as __contract_dep1 from "node:assert/strict";
import * as __contract_dep2 from "../../shared/frontend/js/modules/notification-presentation.js";
import * as __contract_dep3 from "node:assert/strict";
import * as __contract_dep4 from "node:test";
import * as __contract_dep5 from "../../shared/frontend/js/modules/notification-copy.js";
contractSuite("notification-priority", () => {
const test = __contract_dep0.default;
const assert = __contract_dep1.default;
const { createNotificationPresentation } = __contract_dep2;

function fixture(protectErrorNotices){
  const tokens=new Set(['hidden','ready']);
  const classList={
    add(...items){for(const name of items)tokens.add(name);},
    remove(...items){for(const name of items)tokens.delete(name);},
    contains(value){return tokens.has(value);},
  };
  const label={textContent:''};
  const notice={classList,dataset:{},aria:{},
    setAttribute(name,value){this.aria[name]=value;},
    querySelector(name){return name==='strong'?label:null;}};
  const body={classList:{add(){},remove(){}}};
  const presentation=createNotificationPresentation({document:{body},
    getElement:id=>id==='actionStatus'?notice:null,isMobile:()=>false,protectErrorNotices});
  return {presentation,notice,label};
}
test('E4 viewer keeps a user file-error alert visible over background Canvas success',()=>{
  const f=fixture(true);
  try{
    f.presentation.reportOperationError(new Error('invalid GPKG'),
      '프로젝트를 열지 못했습니다.','PL-FILE-IMPORT',4400);
    assert.ok(f.notice.classList.contains('error'));
    const prior=f.label.textContent;
    f.presentation.setActionStatus('Canvas 대체 지도를 표시했습니다.','success',1800);
    assert.ok(f.notice.classList.contains('error'));
    assert.equal(f.label.textContent,prior);
    assert.equal(f.notice.aria.role,'alert');
    f.presentation.clearErrorNotification();
    f.presentation.setActionStatus('정상적으로 프로젝트를 불러왔습니다.','success',1800);
    assert.ok(f.notice.classList.contains('success'));
  }finally{f.presentation.dispose();}
});
test('forced user-facing success can explicitly replace a pending viewer error',()=>{
  const f=fixture(true);
  try{
    f.presentation.setActionStatus('파일 오류','error',4400);
    f.presentation.setActionStatus('새 프로젝트 확인','success',1800,{forceVisible:true});
    assert.ok(f.notice.classList.contains('success'));
  }finally{f.presentation.dispose();}
});
});
contractSuite("notification-copy", () => {
const assert = __contract_dep3.default;
const test = __contract_dep4.default;
const { compactNotificationMessage } = __contract_dep5;


test('short notification copy is preserved', () => {
  assert.equal(compactNotificationMessage('저장했습니다.'), '저장했습니다.');
});

test('error copy keeps a complete short title and diagnostic code', () => {
  const result = compactNotificationMessage(
    '파일을 불러오지 못했습니다. 파일 형식과 구성을 확인하세요. 다시 시도해도 문제가 계속되면 오류 코드 PL-GIS-001를 확인하세요.',
    { tone: 'error', maxLength: 36 },
  );
  assert.equal(result, '파일을 불러오지 못했습니다 · PL-GIS-001');
  assert.ok(result.length <= 36);
});

test('dynamic success copy falls back to a complete short message', () => {
  const result = compactNotificationMessage(
    'PandoLab-East-Prussia-1900.json의 전체 geometry를 보존해 1개 행정구역을 가져왔습니다.',
    { tone: 'success', maxLength: 22 },
  );
  assert.equal(result, '하위단위를 가져왔습니다.');
  assert.ok(result.length <= 22);
});

test('long actionable errors use a complete short title and code', () => {
  const result = compactNotificationMessage(
    '국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요. · PL-LOCK-001',
    { tone: 'error', maxLength: 28 },
  );
  assert.equal(result, '국가를 편집할 수 없습니다 · PL-LOCK-001');
  assert.ok(result.length <= 28);
});

test('unknown long warnings and errors retain their diagnostic code', () => {
  for (const tone of ['warning', 'error']) {
    const message = 'Unrecognized coordinate system: choose the source CRS before importing. · PL-GIS-001';
    const result = compactNotificationMessage(message, { tone, maxLength: 22 });
    assert.equal(result, 'GIS 작업 오류 · PL-GIS-001');
    assert.ok(result.length <= 22);
  }
});

for (const tone of ['error', 'warning']) {
  test(`${tone} copy keeps an existing diagnostic code once and preserves the actionable sentence`, () => {
    const message = '파일을 불러오지 못했습니다. 파일 형식과 구성을 확인하세요. 다시 시도해도 문제가 계속되면 오류 코드 PL-GIS-001를 확인하세요.';
    for (const maxLength of [48, 55]) {
      const result = compactNotificationMessage(message, { tone, maxLength });
      assert.equal(result, '파일을 불러오지 못했습니다. 파일을 확인하세요. 오류 PL-GIS-001');
      assert.equal(result.match(/PL-GIS-001/gu)?.length, 1);
      assert.ok(result.length <= maxLength);
    }
  });

  test(`${tone} failures never fall through to success wording`, () => {
    const result = compactNotificationMessage(
      '자동저장 작업에서 예상하지 못한 문제가 발생해 저장하지 못했습니다. 저장 공간을 확인한 후 다시 시도하세요. · PL-SAVE-001',
      { tone, maxLength: 28 },
    );
    assert.equal(result, '자동저장 실패 · PL-SAVE-001');
    assert.doesNotMatch(result, /저장했습니다|완료했습니다/u);
    assert.ok(result.length <= 28);
  });
}

test('short errors preserve their code and tight budgets use the generic error title', () => {
  const short = '오류 · PL-GIS-001';
  assert.equal(compactNotificationMessage(short, { tone: 'error' }), short);
  const message = '파일을 불러오지 못했습니다. 파일 형식과 구성을 확인하세요. · PL-GIS-001';
  const result = compactNotificationMessage(message, { tone: 'error', maxLength: 22 });
  assert.equal(result, short);
  assert.ok(result.length <= 22);
});

test('working copy reports progress rather than completion', () => {
  const result = compactNotificationMessage(
    '프로젝트의 모든 객체와 지형 데이터를 안전하게 저장하기 위해 현재 저장 파일을 생성하는 중입니다',
    { tone: 'working', maxLength: 22 },
  );
  assert.equal(result, '저장 중…');
  assert.doesNotMatch(result, /했습니다/u);
});
});
