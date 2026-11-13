# 객체·시간축 규칙

**현행 의미 정본:** 날짜 이동은 C++/WASM 프로젝트·타임라인을 통해 판정합니다. 프로젝트 저장/편집의 객체 ID와 원본 GIS·형상 버전·지명 ID를 임의로 같은 ID로 취급하지 않습니다.

| 책임 | 현행 문서·코드 | 역사 기록 경계 |
| --- | --- | --- |
| 공통 객체 종류·부모 관계 | [TerritorialEntity 계약](../architecture/territorial-entity-contract.md), [프로젝트 저장 소유자](../../src/document/project-state.js) | 객체 계약 문서의 2026-10 단계별 스키마는 현재 입력 형식이 아님 |
| 타임라인 의미 | [시간 의미 계약](../timeline-contract.md), [JS–C++ 어댑터](../../src/document/temporal.js), [네이티브 시간 계산](../../src/document/native/src/temporal.cpp) | 과거 독립 Web/App 검증 대상과 분리 |
| 기록·존속기간·부모 관계 | [실제 레코드 계약](../../src/document/timeline-records.js), [시점별 조회](../../src/document/timeline-resolver.js) | [T2-1 시점 기록](../timeline-records.md)은 역사 구현 이력 |
| 프로젝트·스키마 번호 | [버전 상수](../../src/runtime/version-contract.js), [버전·교환 문서](../architecture/versioning-migrations-exchange.md) | 과거 9/10/13 스키마와 현재 스키마를 구별 |
| 원본의 날짜·귀속·명칭 | [영토 출처 계약](../territorial-source-contract.md) | 옛 교환 fixture·원본 SHA와 현행 API 구분 |
| 저장·복원 당시 단계 | [타임라인 저장 기록](../timeline-storage.md), [영속성 검증 이력](../timeline-persistence.md) | 그때의 미완료/테스트 상태를 현재 결함 또는 성공으로 소급하지 않음 |

**검증 계약:** `check-group:object-contracts`, `check-group:project-file-contracts`, `check-group:territorial-storage`. 코드 버전 상수와 문서상의 과거 숫자가 다르면 현재 코드 계약을 검사하되 과거 예제는 그대로 보존합니다.

## 추가 저장·명령·객체 규범

- [프로젝트 GPKG 저장·복원 호환성](../project-persistence-compatibility.md): 스키마 14, 정본 JSON과 공간 표현 파생물 분리, 출처 ID 보존, 문서별 보기 상태 격리 및 원본 손상 입력 거부를 별도 규칙으로 취급합니다.
- [Generic Feature 및 출처 보존](../architecture/generic-feature-provenance.md): Generic은 알 수 없는 외부 형상의 fallback이며 새 표준 영역 유형이나 자유 생성 객체가 아닙니다.
- [공통 Core 명령 경계](../architecture/shared-core-command-boundary.md): `src/document/native/` 기준의 검증·커밋·히스토리 일관성을 지키고 옛 Web/App 이중 명령 경계를 복원하지 않습니다.
- [하천·호수의 기간별 형상](../hydro-timeline.md): C++ `timelineRecords`와 수계의 시점별 형상/표시 자격은 별도 규칙입니다. 아랄해의 특수 표시 구간은 모든 수계의 일반 기간 규칙이 아닙니다.
