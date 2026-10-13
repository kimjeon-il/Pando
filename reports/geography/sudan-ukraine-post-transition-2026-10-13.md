# 수단 분리·우크라이나 크림반도 전환 이후 역사 형상 연결

> 보고서 ID: `GEO-LIFE-003` · 상태: `investigating` · 지도 반영: `not-applied` (`main` 미병합) · 작성 2026-10-13  
> 선행 보고서: [GEO-LIFE-002](country-geometry-identity-consolidation-2026-10-13.md) · 작업 브랜치 `work/objects`  
> 기초 지도: Natural Earth Admin-0 Countries 5.1.1, 현행 자료 기준일 `2026-10-06`

## 목적과 기간 전환

이 작업은 이전 GEO-LIFE-002가 확인한 역사형상 공백을 **수단·남수단과 우크라이나**에서 연결한다. 각 국가의 객체 정체성은 유지하고, 당시 정치적 사건의 날짜를 경계로 새로운 geometry version을 추가한다.

| 국가 | 기존 형상(변경 없음) | 추가하는 잠정 형상 | 현행 형상 |
| --- | --- | --- | --- |
| `state:SDN` 수단 | 1956-01-01~**2011-07-08** (남부 포함) | **2011-07-09~2026-10-05** (남부 제외) | 2026-10-06~ |
| `state:SDS` 남수단 | 해당 없음 | **2011-07-09~2026-10-05** (독립국) | 2026-10-06~ |
| `state:UKR` 우크라이나 | 1991-08-24~**2014-03-17** (크림 포함) | **2014-03-18~2026-10-05** (크림 제외) | 2026-10-06~ |

기간의 양끝은 모두 inclusive. 화면 월말 시점에서 **2011년 6월/7월** 및 **2014년 2월/3월** 사이에 형상이 변경된다. 국가의 존재기간(`lifetime`) 자체를 끊지 않으며, 남수단의 독립국 객체는 수단과 별개로 유지한다.

## 정치적 사건의 출처

- [유엔 남수단 국가 정보](https://www.un.org/en/node/122910): 남수단이 2011-07-09 수단에서 분리·독립.
- [유엔 UNMIS: 수단-남수단 국경](https://unmis.unmissions.org/en/unmis-0/more-borderline): 분리 시점 북남 경계의 미획정 부분과 기준선.
- [유엔 UNMIS: 아비에이](https://www.unmissions.org/en/unmis-0/security-council-establishes-abyei-mission): 2011-06 아비에이 관리·분쟁 상황.
- [유럽인권재판소 Ukraine v Russia (Crimea)](https://hudoc.echr.coe.int/?i=002-14347): 러시아의 실효 지배는 2014-02-27부터, 2014-03-18은 병합 조약 체결일.
- [유엔 총회 68/262](https://press.un.org/en/2014/ga11493.doc.htm): 2014-03-27 크림반도의 우크라이나 주권과 영토보전 재확인, 영토 변경 비승인.
- [Natural Earth 5.1.1](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/): 실효 지배 기반의 현행 국경 베이스라인이며 2011년/2014년 조사 결과가 아님.

## 형상의 정확도 및 범위

**역사적 측량 자료를 새로 확보한 것은 아님.** 원본 과거 형상(크림 포함·남수단 포함)과 현행 형상(크림 제외·남수단 제외)을 모두 유지하고, 현행 다각형을 2011년·2014년 직후에 해당하는 **잠정 시간 버전**으로 복제한다. 모든 새 버전은 `certainty: low`, `datePrecision: approximate`, `historicalProvenance.verifiedHistoricalGeometry: false`로 표시한다.

따라서 해당 구간에 지도 객체가 사라지지 않도록 만들지만, **2011년 아비에이 귀속·경계, 2014년 우크라이나 동부 전선, 2022년 이후 러시아의 추가 점령·국경 주장 등은 정확히 반영했다고 주장하지 않는다.** 현대 Natural Earth 경계 전체를 과거로 소급한 근사 자료임.

특히 우크라이나의 '2014-03-18 크림 제외'는 **러시아의 병합 조약 시점을 선택한 실효 지배 시각화**이며, 러시아에 대한 합법적 영토 양도를 의미하지 않는다. 러시아 `RUS`의 2014년 역사 형상은 본 작업에 포함되지 않으므로 크림이 러시아 전체 객체로 자동 편입·표시되는 것은 아니다.

## 구현·검증 항목

- 같은 국가의 `entityId` 유지: `state:SDN`, `state:SDS`, `state:UKR`.
- 다른 278개 국가·지역의 도형과 다른 역사형상의 좌표·유효기간 유지.
- 객체 총수 281개 및 국가계보 262개 유지. 기하 버전 287개 → **290개**.
- `2011-06` 수단은 주바까지 포함하고 남수단 객체는 없음. `2011-07` 수단은 주바 제외, 남수단은 주바 포함.
- `2014-02` 우크라이나는 크림·키이우 포함, `2014-03` 우크라이나는 크림 제외·키이우 포함.
- 웹 라이브러리 시점별 선택과 웹/앱 공용 세계 프로젝트의 실제 지오메트리·정체성·manifest를 별도 검증.
- `main`, GitHub Pages 배포, 미관련 국가의 이력 및 전 구간 정밀 역사 국경 재구성은 작업 범위 밖.

## 결과 상태

**실제 실행 완료 — 2026-10-13 (`work/objects`, 커밋 [`6ac4251`](https://github.com/kimjeon-il/Pando/commit/6ac425127264b297b558bd451de767db7a0eef11))**

- 원본 국가계보 262개, 객체 **281개 유지**, geometry version **287 → 290개**. 세 국가의 새 근사 버전만 추가했고 이전 국가 ID·좌표 및 278개 변경 없는 압축 청크는 보존.
- `node tools/build-territorial-entity-chunks.mjs --check`: 통과.
- `node tools/build-historical-world-timeline.mjs --check`: 통과.
- `node native/tools/sync-historical-world-timeline.mjs --web-root . --check`: 통과.
- `node --test`의 국가계보 보존·월말 시점·실제 좌표 point-in-polygon·웹 역사 프로젝트 결정성 집중 검사: 통과.
- `node scripts/check-territorial-library.mjs`, `node scripts/check-version.mjs`: 통과.
- [전체 실행 로그](https://github.com/kimjeon-il/Pando/actions/runs/38350818362). 웹/앱 공통 역사 프로젝트 SHA-256: `dccc11ce2368cf2b271a69e8927074b8300ea8d4b4e2e63d1730d945e8572767` (manifest 일치).
- 타임라인 확인: `2011-06` 수단 SDN만, `2011-07` 수단 SDN·남수단 SDS 모두; `2014-02` 우크라이나 UKR에서 크림 확인점 포함, `2014-03` 같은 UKR 객체에서 크림만 제외. 2015-10에도 우크라이나 UKR 표시는 유지.
- **미실행:** 웹 실제 브라우저, native C++/Qt 빌드·실기기 테스트, `main` 병합, Pages 배포. **미해결:** `RUS`의 2014년 크림 실효 지배 지도와 우크라이나 동부/수단 아비에이 지역의 정밀 시계열 형상.

새 근사 버전의 `certainty: low` 및 역사 국경 미검증 표시는 검증 성공 이후에도 유지한다.

### 별도 네이티브 빌드의 기존 장애

- 기존 [Objects timeline native parity CI](https://github.com/kimjeon-il/Pando/actions/runs/38351270915)는 **실패**: CMake 구성 단계에서 `shared/tests/core-session-tests.cpp` 원본 파일이 없어 `core_session_tests` 타깃 생성이 중단됨. 이 작업이 수정한 Qt 테스트는 실행되지 않았다.
- 변경 전 `main` 기준 [선행 CI](https://github.com/kimjeon-il/Pando/actions/runs/38347089991)도 **동일한 경로 누락으로 실패**해 이번 역사 형상 수정으로 발생한 새 회귀로 볼 수 없다.
- 위 장애와 무관하게 Web 및 native 역사 프로젝트의 생성 파일/manifest 해시 일치는 집중 검사에서 확인했다. 네이티브 빌드 회귀 해결·실행 성공으로 표기하지 않는다.
