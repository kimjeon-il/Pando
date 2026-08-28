import assert from 'node:assert/strict';
import test from 'node:test';

import { compactNotificationMessage } from '../../assets/js/modules/notification-copy.js';

test('short notification copy is preserved', () => {
  assert.equal(compactNotificationMessage('저장했습니다.'), '저장했습니다.');
});

test('mobile error copy keeps the operation and error code within one line', () => {
  const result = compactNotificationMessage(
    '파일을 불러오지 못했습니다. 파일 형식과 구성을 확인하세요. 다시 시도해도 문제가 계속되면 오류 코드 PL-GIS-001를 확인하세요.',
    { tone: 'error', maxLength: 22 },
  );
  assert.equal(result, '파일 작업 실패 · PL-GIS-001');
  assert.ok(result.length <= 22);
});

test('dynamic success copy falls back to a complete short message', () => {
  const result = compactNotificationMessage(
    'PandoLab-East-Prussia-1900.json의 전체 geometry를 보존해 1개 행정구역을 가져왔습니다.',
    { tone: 'success', maxLength: 22 },
  );
  assert.equal(result, '행정구역을 가져왔습니다.');
  assert.ok(result.length <= 22);
});

test('actionable errors prefer the corrective instruction', () => {
  const result = compactNotificationMessage(
    '국가를 편집할 수 없습니다. 국가 레이어 잠금을 해제하세요.',
    { tone: 'error', maxLength: 22 },
  );
  assert.equal(result, '국가를 편집할 수 없습니다.');
});
