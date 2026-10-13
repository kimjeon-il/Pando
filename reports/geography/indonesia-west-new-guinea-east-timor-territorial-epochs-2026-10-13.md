# 인도네시아 영토 시계열 복원 — 서뉴기니 1963·동티모르 1975–2002

> 보고서 ID: `GEO-IDN-001` · 상태: `investigating` · 지도 반영: `not-applied` (`main` 미병합) · 조사·수정일: 2026-10-13  
> 작업 브랜치: `work/objects` · 대상: `state:IDN` 인도네시아, `state:TLS` 동티모르  
> 선행: [GEO-LIFE-002](country-geometry-identity-consolidation-2026-10-13.md) · [GEO-LIFE-003](sudan-ukraine-post-transition-2026-10-13.md)

## 핵심 원칙

정치체제의 변화나 영토 확장·축소로 인도네시아 국가 객체를 분리하지 않는다. 기존 `state:IDN`을 유지하고 `geometryVersions`만 시간별로 구성한다. 동티모르는 독립국이 성립한 **2002년 5월 20일부터만** 별도 `state:TLS`의 독립국 기간을 인정한다. 1999~2002년의 유엔 과도행정 기간은 독립국 존속기간과 혼동하지 않는다.

## 인도네시아의 영토 변화

| 기간 (시작·끝 포함) | 서뉴기니 | 동티모르 | 형상과 신뢰도 |
| --- | --- | --- | --- |
| 1945-08-17 ~ 1963-04-30 | 제외 | 제외 | 현행 인도네시아 264개 폴리곤에서 파푸아 행정구역 25개 구성요소 제외, `low` |
| 1963-05-01 ~ 1975-12-06 | 포함 | 제외 | 현행 IDN 근사, `low` |
| 1975-12-07 ~ 1999-10-24 | 포함 | 점령 영역으로 포함 | 기존 역사 IDN+TLS 합집합 형상 원본 보존, 날짜 재판정, `low` |
| 1999-10-25 ~ 2026-10-05 | 포함 | 제외 | 현행 IDN 근사, `low` |
| 2026-10-06 ~ | 포함 | 제외 | 기존 정본 Natural Earth 5.1.1 현행 다각형 |

동티모르는 `2002-05-20`부터 유효한 별도 독립국으로 등록한다. 2002~2026년은 현재 TLS 형상을 잠정 재사용하고 2026년 10월 6일부터는 기존 현행형상을 사용한다.

## 사건 날짜의 근거

- **1963-05-01** — [유엔 서뉴기니 임시행정부·유엔 보안군 이력](https://peacekeeping.un.org/sites/default/files/past/unsfbackgr.html): UNTEA가 서뉴기니 행정권을 인도네시아로 이양. 1962년 10월부터의 UNTEA 통치는 인도네시아의 행정권으로 소급하지 않음.
- **1975-12-07** — [유엔 동티모르 연혁](https://peacekeeping.un.org/sites/default/files/past/etimor/Untaetchrono.html): 인도네시아 침공의 시작. [유엔 총회 제3485호 결의](https://digitallibrary.un.org/record/650109)는 당시 군사개입을 기록. **동티모르 전역에 하루 만에 실효 지배가 성립했다는 증거는 아니므로, 월별 지도에서의 점령 영토 근사값**으로만 사용.
- **1976년** — [유엔 동티모르 파견단 역사](https://peacekeeping.un.org/sites/default/files/past/unmiset/background.html): 인도네시아가 제27주로 편입했으나 유엔은 승인하지 않았음. 이는 1975년 점령 *개시*와 구분됨.
- **1999-10-25** — [유엔 UNTAET](https://peacekeeping.un.org/sites/default/files/past/etimor/etimor.htm): 동티모르 유엔 과도행정부 설립. 인도네시아 의회의 1999-10-19 주민투표 승인 및 잔여 병력의 1999-11-01 철수와는 다른 사건. 월말 기준으로 10월부터 제외.
- **2002-05-20** — 같은 [유엔 기록](https://peacekeeping.un.org/sites/default/files/past/etimor/etimor.htm): 동티모르 독립 및 UNTAET 종료.

## 서뉴기니 폴리곤 근거

판도편집기의 현재 인도네시아 `MultiPolygon`은 **264개 독립 구성요소**를 포함한다. [Natural Earth 5.1.1 Admin-1](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.1/geojson/ne_10m_admin_1_states_provinces.geojson) 자료에서 파푸아(`ID-PA`)와 서파푸아(`ID-PB`)를 합친 형상과 교차시키는 독립 GIS 검사를 실행했다. 25개 구성요소는 모두 해당 행정지역에 포함됨. 검증용 선택 목록은 [`west-new-guinea-component-mask-v5.1.1.json`](../../tools/historical-library/sources/indonesia/west-new-guinea-component-mask-v5.1.1.json)에 보관.

이 방식은 서뉴기니 본섬 외에도 라자암팟·비악·야펜 등의 구성요소를 포함하여 제외하며, 주변 말루쿠·아루제도를 잘못 제거하지 않는다. 폴리곤 좌표나 선을 새로 그리지 않고 기존 원본 구성요소를 정확히 보존·선별한다.

## 미검증·의도적으로 제외한 범위

- **1945~1949 인도네시아 독립전쟁**: 1945년 독립선언 후 실제 통치 지역 변화를 연도별로 재현하지 않으며, 정치적·영토적 실효 지배의 근사값임.
- **1975~1976 동티모르 전쟁**: 1975년 12월 침공부터 1976년 편입 주장 전까지 실제 점령선이 수시로 움직임. 단일 동티모르 전체 폴리곤은 그 기간에 대한 *대체 근사*, 실제 매월 점령 경계를 검증한 자료 아님.
- **동티모르 합병의 법적 지위**: 유엔은 인도네시아의 편입을 인정하지 않음. 동티모르를 인도네시아에 포함하는 구간은 실효 지배 지도에 한정함.
- **1999~2002 유엔 과도행정**: 본 작업은 `state:IDN`과 독립국 `state:TLS`만 다루므로 과도행정부를 대신 표시하는 객체를 생성하지 않음. 별도 일반객체가 필요하다면 후속 자료 조사 대상.
- **독립국 이후의 국경 세부**: 현행 Natural Earth 지도를 옛 시점에 복제한 도형은 모두 `certainty: low`, `datePrecision: approximate` 및 원본 참조날짜 메타데이터를 명시. 2026 현재 영토의 정밀 역사증명 아님.

## 실행 및 검증 결과

**완료 — 2026-10-13, `work/objects`**

- 구현 커밋: [`7d18b3c`](https://github.com/kimjeon-il/Pando/commit/7d18b3c752d23b2df95f507e799f0140a6724cc0). 다른 작업의 `work/objects` 커밋과 충돌하지 않도록 **비강제 rebase 후 푸시**.
- [GitHub Actions 최종 실행 성공](https://github.com/kimjeon-il/Pando/actions/runs/38355364545). 첫 시도 [38354798140](https://github.com/kimjeon-il/Pando/actions/runs/38354798140)는 **모든 검증이 통과했으나** 다른 커밋의 선행 푸시로 비강제 push가 거절됨. 최종 재시도에서 커밋까지 성공.
- 라이브러리 **281개 객체 / 262개 국가계보 유지**, 형상 버전 **290 → 294개**. 인도네시아 `IDN` 5개, 동티모르 `TLS` 2개. 다른 279개 국가·지역 gzip chunk는 이 작업 직전 기준 커밋 `1519f609bd69`와 바이트 동일.
- 서뉴기니 제거용 mask: 현행 IDN 264개 폴리곤 중 25개가 Papua(`ID-PA`)·West Papua(`ID-PB`) Admin-1 v5.1.1에 **100% 포함**됨을 Shapely 2.1.2로 검사. 1945~1963 근사 다각형은 239개이며 기존 순서·좌표 그대로 보존. 아루·말루쿠의 임의 제거 없음.
- 동티모르 점령용 기존 합집합 폴리곤의 기하 좌표·레거시 `versionId = state:indonesia:1945-2002-r1`는 참조 안정성을 위해 보존하되, **실제 유효기간은 1975-12-07~1999-10-24로 수정**. ID 문구의 과거 연도 표기를 현재 시간 범위로 오인하지 않는다. 구간 수정 이전 원본 날짜를 `historicalProvenance.originalInterval`에 남김.
- `state:TLS`의 `lifetime.validFrom = 2002-05-20` 입력. 1999~2002 UNTAET는 이 독립국의 존속기간에 소급 포함하지 않음.
- 검사 성공: **Node 집중 테스트 13/13**, **Python 라이브러리 10/10**, `node tools/build-territorial-entity-chunks.mjs --check`, `node tools/build-historical-world-timeline.mjs --check`, `node native/tools/sync-historical-world-timeline.mjs --web-root . --check`, `node scripts/check-territorial-library.mjs`, `node scripts/check-version.mjs`.
- 월말 참조 확인: `1963-04` 서뉴기니 제외 → `1963-05` 포함; `1975-11` 동티모르 제외 → `1975-12` 점령기 포함; `1999-09` 포함 → `1999-10` 제외; `2002-04` 동티모르 독립국 비활성 → `2002-05` `TLS` 별도 국가 활성.
- Web 및 Native 역사 프로젝트 SHA-256 완전 일치: `6f0932d02afcf55e2aceebc7e4aa524e84a868443e3d2f4036786262e59a0ddc`.

**한계:** 위 통과는 GIS 형상·기간·정본 계약에 대한 집중 검증이다. 실제 UI 브라우저·Qt/C++ 빌드·현장 기기 테스트와 `main` 병합·Pages 배포는 미실행. 네이티브 CMake의 선행 소스 누락 문제는 [GEO-LIFE-003](sudan-ukraine-post-transition-2026-10-13.md)에 기록된 별도 장애다.
