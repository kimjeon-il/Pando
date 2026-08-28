const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const stripEnd = value => normalize(value).replace(/[.!?…]+$/u, '');

const COPY_REPLACEMENTS = Object.freeze([
  [/무손실 편집 데이터/gu, '편집 데이터'],
  [/영토를 가져올 국가/gu, '원본 국가'],
  [/현재 프로젝트/gu, '프로젝트'],
  [/파일 형식과 구성을 확인하세요/gu, '파일을 확인하세요'],
  [/페이지를 새로고침하거나 잠시 후 다시 시도하세요/gu, '새로고침하세요'],
  [/다시 시도해도 문제가 계속되면 오류 코드 (PL-[A-Z0-9-]+)를 확인하세요/gu, '오류 $1'],
  [/지도에 표시된 다른 국가/gu, '다른 국가'],
  [/선택 영역의 반대쪽 경계/gu, '반대쪽 경계'],
]);

function firstSentence(value) {
  return normalize(value).split(/(?<=[.!?])\s+/u)[0] || '';
}

function fallbackCopy(value, tone, code) {
  const suffix = code ? ` · ${code}` : '';
  if (tone === 'working') {
    if (/저장/u.test(value)) return '저장 중…';
    if (/내보|GeoJSON|GeoPackage/u.test(value)) return '파일 생성 중…';
    if (/불러|파일.*검사|레이어.*검사/u.test(value)) return '파일 확인 중…';
    if (/미리보기/u.test(value)) return '미리보기 계산 중…';
    if (/지도|렌더/u.test(value)) return '지도 준비 중…';
    return '작업 중…';
  }
  if (tone === 'error') {
    if (/자동저장/u.test(value)) return '자동저장 실패. 직접 저장하세요.';
    if (/잠금/u.test(value)) return '잠금을 해제하세요.';
    if (/상위 영역|부모/u.test(value)) return '상위 영역을 확인하세요.';
    if (/소속 국가|국가.*선택|원본 국가/u.test(value)) return '국가를 다시 선택하세요.';
    if (/파일|불러|저장|내보|GeoJSON|GeoPackage/u.test(value)) return `파일 작업 실패${suffix}`;
    if (/형상|geometry|경계|국경/u.test(value)) return '형상을 확인하세요.';
    return `작업 실패${suffix}`;
  }
  if (/저장/u.test(value)) return '저장했습니다.';
  if (/행정구역.*가져|가져.*행정구역/u.test(value)) return '행정구역을 가져왔습니다.';
  if (/지역.*가져|가져.*지역/u.test(value)) return '지역을 가져왔습니다.';
  if (/불러|가져/u.test(value)) return '가져왔습니다.';
  if (/내보|GeoJSON|GeoPackage|다운로드|파일.*만들/u.test(value)) return '파일을 만들었습니다.';
  if (/삭제/u.test(value)) return '삭제했습니다.';
  if (/추가/u.test(value)) return '추가했습니다.';
  if (/변경|수정|조정|이동/u.test(value)) return '변경했습니다.';
  if (/취소/u.test(value)) return '취소했습니다.';
  if (/복원/u.test(value)) return '복원했습니다.';
  return '완료했습니다.';
}

export function compactNotificationMessage(message, { tone = 'success', maxLength = 22 } = {}) {
  const full = normalize(message);
  if (!full || full.length <= maxLength) return full;
  const code = full.match(/PL-[A-Z0-9-]+/u)?.[0] || '';
  let compact = full;
  for (const [pattern, replacement] of COPY_REPLACEMENTS) compact = compact.replace(pattern, replacement);
  compact = normalize(compact);
  if (compact.length <= maxLength) return compact;

  const first = firstSentence(compact);
  if (code) {
    const withCode = `${stripEnd(first)} · ${code}`;
    if (withCode.length <= maxLength) return withCode;
    const fallback = fallbackCopy(compact, tone, code);
    if (fallback.length <= maxLength) return fallback;
    return `오류 ${code}`;
  }
  if (first.length <= maxLength) return first;
  return fallbackCopy(compact, tone, code);
}
