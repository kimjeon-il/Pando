import assert from 'node:assert/strict';
import test from 'node:test';

import { compactNotificationMessage } from '../../assets/js/modules/notification-copy.js';

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
