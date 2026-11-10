# GIS·역사 공간자료 규칙

**유효 범위:** 조사·원본 선정·일자 확인·역사 국경 복원. 화면 표시 LOD와 조사 대상 선별은 별도 규칙입니다.

| 업무 | 찾아볼 원문 | 판정 |
| --- | --- | --- |
| 역사적 국경·영토·해안 복원 | [공통 역사 국경 복원 규칙](../historical-border-reconstruction-policy.md) | 조사 사건·생략·사료·일반화의 상위 기준 |
| 기존 SHP·GPKG·GeoJSON 우선 탐색 | [역사 벡터 원본 조사 절차](../historical-vector-source-workflow.md) | 위 복원 규칙의 하위 절차 |
| 기본 정치체 지도 표시 | [기본 정치체 정책](../builtin-territory-policy.md) | [표시 정책 구현](../../tools/gis/builtin-display-policy.mjs)과 원본·표시를 구별 |
| 과거 간척·해안선 조사 시범 | [역사 해안선 시범 절차](../historical-coastline-change-workflow.md) | 명시적으로 연구·시범, 런타임 적용 근거 아님 |
| 하천·수계 시점 | [수계 타임라인](../hydro-timeline.md) | GIS 원자료/표시 계약의 적용 단계를 확인 |
| 지형·DEM | [지형 원본](../terrain-dem.md), [미리보기 기록](../terrain-preview.md) | 원자료와 당시 미리보기 구현 이력 구분 |

**서로 다른 기준:** 역사 국경 조사에서의 Natural Earth 1:10M·사건 규모 선별과 벡터 표시의 [동적 LOD](map-rendering.md)는 동일 정책이 아닙니다. 조사 범위를 확대하는 것으로 표시 해상도 정책이 자동 바뀌지 않습니다.

**검증 계약:** `check-group:gis-contracts`, `check-group:country-validity`, `check-group:current-world`. 이 그룹은 공간 연산·게시 자료의 기술 검증이며 역사적 귀속을 자동 인증하지 않습니다.
