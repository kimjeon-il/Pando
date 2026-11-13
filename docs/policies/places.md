# 도시·지명 정책

**원칙:** 후보 선정, 원본 검수/게시 승인, 지도 표시 등급, 시대별 이름, 도시 라벨 자격은 **독립된 결정**입니다. 서로 하나의 등급표로 합치지 않습니다.

| 판단 | 현행 소유자 | 구분 |
| --- | --- | --- |
| GeoNames 후보 포괄·제외 | [후보 선별 코드](../../tools/lib/geonames-policy.mjs) | 수록 가능성 판단. 기존 후보 선정 임계값 보존 |
| 조사·게시 승인 | [지명 자료·검증 기록](../place-runtime.md), [지명 승인·동기화 계약](../place-sync-contract.md) | 조사 통과와 자동 런타임 게시를 혼동하지 않음 |
| 도시 5등급 표시 | [인구·공간 점수 구현](../../tools/build/place-display-rank.mjs), [정책 적용 기록](../place-runtime.md) | 인구 우선, 주변 밀집 감점·고립 가점. 과거 계수 원문은 미복원; 임시 보정값 |
| 지명 식별자·이름·타일 | [지명 코드 계약](../../src/document/place-contract.js), [PLAC v3 고정 검증 예제](../../tests/fixtures/places/plac-v3.json), [코덱](../../src/data/place-codec.js) | 실행 형식은 코드 정본, JSON은 검증용 고정 예제. 미사용 v2는 현재 트리에서 제거 |
| 역사명 선택 | [지명 이름 규칙 코드](../../src/data/place-name-policy.js) | 역사적 이름 변화와 도시 등급은 별개 |
| 도시 라벨 가능 기간 | [라벨 유효기간 코드](../../src/data/place-lifetime-policy.js) | 지명·취락의 물리적 존재 전체를 뜻하지 않음 |
| 조회·화면 | [지명 Worker 저장소](../../src/data/place-worker-store.js) | 화면 수치·우선순위는 승인된 실제 게시 자료 기준 |

외부 라이브러리의 [역사명 편집 정책](https://github.com/kimjeon-il/PandoLab-library/blob/main/reports/places/historical-display-policy.json)과 [한국어 지도 표기 정책](https://github.com/kimjeon-il/PandoLab-library/blob/main/reports/places/korean-map-label-policy.json)은 **스테이징** 판본일 수 있습니다. 문서에 적힌 편집 규칙이 현재 런타임에 모두 적용된다고 가정하지 않습니다. 정확한 도시에 대한 자료 핀·승인 상태를 확인해야 합니다.

**검증 계약:** `check-group:place-contracts`, `check-group:places-runtime`. 현재 관련 스크립트는 `check-script:check:places`; 이력 문서의 `pnpm check:place-sync`는 현재 등록된 명령으로 간주하지 않습니다.

## 다른 파일에 포함된 검수 규칙

[대량 지명 조사·배치 절차](../place-batch-pipeline.md)에 도시 ID 중복 검수, 역사명별 실제 효력일, 증거 없는 `fromDate` 금지, 지역별 공용어 확인, 검수 미완료 도시 자동 게시 금지, 현대 GeoNames 인구로 역사 도시 등급을 확정하지 않는 규칙이 있습니다. 이는 현재 후보 함수나 인구 기반 **표시 등급**을 새로 정의하지 않으며, 당시 배치 처리 완료·검증 결과와 구분해 해석해야 합니다.

