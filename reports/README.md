# 판도편집기 조사·검증 보고서

통합 `Pando` 저장소의 이 폴더가 웹·앱 사람이 읽는 조사·검증 보고서의 정본입니다. 웹 데이터는 루트 `assets/`, 앱 소스와 실행 입력·증거는 `native/`의 각 소유 위치에 둡니다. 보고서만으로 지도 반영이나 검증 통과를 뜻하지 않습니다.

| 표기 | 뜻 |
| --- | --- |
| `investigating` | 조사 중이며 원문에 표시된 검증 범위만 확인됨 |
| `historical-record` | 작성 당시의 기록. 현재 제품을 다시 검증한 결과가 아님 |
| `not-applied` | 보고서 대상 형상·자료를 아직 반영하지 않음 |
| `unverified` | 보고서만으로 현재 지도 반영 여부를 확인하지 못함 |
| `not-applicable` | 지도 데이터 반영 여부와 무관한 개발 검증 |

최신본은 수정일만으로 결정하지 않습니다. 같은 주제의 후속 보고서는 이전 보고서에 `대체됨`과 후속 보고서 ID를 적고, 아래 색인에는 유효한 판본을 먼저 배치합니다. 역사 경계 보고서의 `조사 중`은 독립적인 시대별 형상 검증 완료를 의미하지 않습니다.

## 지리·GIS

| ID | 보고서 | 원문 수정일 | 상태 | 지도 반영 |
| --- | --- | --- | --- | --- |
| `GEO-REVIEW-20261017` | [10월 17일 아침 보고서 검토 — 효력일 근거 보완·데이터 보류](geography/reviews/morning-2026-10-17.md) | 2026-10-17 회차 / 2026-10-16 UTC | `investigating` | `not-applied` |
| `GEO-LIFE-005` | [아시아 국가 존속기간 — 이라크·요르단·레바논](geography/country-lifetime-asia-middle-east-2026-10-17.md) | 2026-10-17 | `investigating` | `not-applied` |
| `GEO-LIFE-ROTATION` | [국가 존속기간 조사 지역 순환 진행기록](geography/country-lifetime-rotation-progress.md) | 2026-10-17 | `investigating` | `not-applied` |
| `GEO-TIME-001` | [2025년 중앙아시아 국경 획정 사건](geography/historical-timeline-2025-central-asia-2026-10-17.md) | 2026-10-17 | `investigating` | `not-applied` |
| `GEO-LIFE-004` | [유럽 국가 존속기간 공란 27개 — 1801년 이후 조사](geography/country-lifetime-europe-1801-plus-2026-10-15.md) | 2026-10-15 | `investigating` | `not-applied` |
| `GEO-DEU-008` | [1914 German Empire coast vs provisional modern coastline — screen-space preliminary check](geography/germany/1914-screen-delta-precheck.md) | 2026-10-09 | `investigating` | `not-applied` |
| `GEO-DEU-007` | [Official Schleswig-Holstein WMS period-map coast review — October 9, 2026](geography/germany/1914-sh-period-map-overlay-review.md) | 2026-10-09 | `investigating` | `not-applied` |
| `GEO-009` | [현행 수계 데이터 최적화 — 1단계 (2026-10-09)](geography/hydro/active-hydro-optimization-stage1.md) | 2026-10-09 | `historical-record` | `unverified` |
| `GEO-NLD-006` | [Netherlands land-reclamation rollback survey](geography/netherlands/land-reclamation-reverse-timeline.md) | 2026-10-09 | `investigating` | `not-applied` |
| `GEO-NLD-005` | [Netherlands shoreline pilot — Phase 0 canonical baseline probe](geography/netherlands/phase0-canonical-audit.md) | 2026-10-10 | `investigating` | `not-applied` |
| `GEO-058` | [Terrain integration validation](geography/terrain/app-terrain-integration-validation.md) | 2026-10-07 | `historical-record` | `unverified` |
| `GEO-059` | [P2 terrain LOD and demand validation](geography/terrain/app-terrain-p2-validation.md) | 2026-10-07 | `historical-record` | `unverified` |
| `GEO-LIFE-001` | [국가 존속기간 공란 조사 — 최상위 일반객체 A–D 32개](geography/country-lifetime-a-d-2026-10-13.md) | 2026-10-13 | `investigating` | `not-applied` |
| `GEO-023` | [Verified entity lifetime additions](geography/verified-entity-lifetimes.md) | 2026-10-08 | `historical-record` | `unverified` |

## 도시·지명

| ID | 보고서 | 원문 수정일 | 상태 | 지도 반영 |
| --- | --- | --- | --- | --- |
| `GEO-051` | [P5–P7 fixed-source validation](places/app-place-integration-validation.md) | 2026-10-07 | `historical-record` | `unverified` |
| `GEO-052` | [2026-10-11: 웹·앱 지명 검수 264개 / 정식 표시 승인 163개](places/app-place-staging-snapshot.md) | 2026-10-11 | `historical-record` | `unverified` |

## 개발·검증

> OBJ 접두사는 객체 브랜치 원본의 DEV-082~088 번호가 기존 메인 보고서 번호와 충돌하여 통합 시 부여한 고유 색인입니다. 원본 소스와 검증 링크는 해당 보고서에 보존합니다.

| ID | 보고서 | 원문 수정일 | 상태 | 지도 반영 |
| --- | --- | --- | --- | --- |
| `PERF-P0-001` | [기준 코드·기존 계측 자산 통합 검토](development/testing/performance-baseline-consolidation-2026-10-17.md) | 2026-10-17 | `verified-source-and-focused-ci` | `not-applicable` |
| `OBJ-092` | [단일 접촉 공유 경계 레코드 압축 및 Worker 6MiB 절감](development/testing/soviet-singleton-edge-2026-10-17.md) | 2026-10-17 | `verified-web-paired-and-12cycle` | `not-applicable` |
| `OBJ-091` | [공유 국경선 잔여 메모리 소유 구조 3개 GC 순서별 분해](development/testing/soviet-retained-owner-graph-2026-10-17.md) | 2026-10-17 | `verified-isolated-chromium` | `not-applicable` |
| `OBJ-090` | [렌더링 선분 지연 생성 및 Worker 메모리 61MiB 추가 절감](development/testing/soviet-renderable-on-demand-2026-10-17.md) | 2026-10-17 | `verified-web-paired-and-12cycle` | `not-applicable` |
| `OBJ-089` | [공유 국경선 선분 공간 인덱스 압축: JS 힙 165MiB 절감 A/B 검증](development/testing/boundary-spatial-index-packed-2026-10-17.md) | 2026-10-17 | `verified-web-paired` | `not-applicable` |
| `OBJ-088` | [공유 국경선 Worker 메모리 실제 유지 소유자 분석](development/testing/soviet-shared-border-retained-owners-2026-10-17.md) | 2026-10-17 | `verified-web-diagnostics` | `not-applicable` |
| `OBJ-087` | [현행 main 동일 소스 소련 12회 왕복 메모리 검증](development/testing/soviet-main-12cycle-memory-2026-10-17.md) | 2026-10-17 | `verified-web-diagnostics` | `not-applicable` |
| `OBJ-085` | [소련 미리보기 build 60초 지연 원인 추적](development/testing/soviet-preview-build-attribution-2026-10-17.md) | 2026-10-17 | `verified-web-diagnostics` | `not-applicable` |
| `OBJ-084` | [소련 편집·시점 왕복 Worker/WASM 메모리 계측](development/testing/soviet-memory-retention-roundtrip-2026-10-17.md) | 2026-10-17 | `verified-web-diagnostics` | `not-applicable` |
| `OBJ-083` | [객체 시점 resolveWorld 단일화 검증](development/testing/objects-timeline-cursor-reuse-2026-10-17.md) | 2026-10-17 | `verified-web-diagnostics` | `not-applicable` |
| `OBJ-082` | [소련 시점 메모리 소유권 계측](development/testing/soviet-memory-owner-attribution-2026-10-16.md) | 2026-10-17 | `verified-web-diagnostics` | `not-applicable` |
| `DEV-086` | [1989년 소련 편집 메모리·반복 회귀 검증](development/testing/soviet-memory-lifecycle-regression-2026-10-16.md) | 2026-10-16 | `verified-web-ci-with-observability-limits` | `not-applicable` |
| `DEV-085` | [1989년 소련 대형 경계 편집 준비 지연 선분 생성 최적화](development/testing/soviet-boundary-preparation-2026-10-16.md) | 2026-10-16 | `verified-web-ci` | `not-applicable` |
| `DEV-084` | [신규 WebView 전체 세계지도 물리 자료 로딩 경량화](development/testing/web-shell-physical-startup-2026-10-16.md) | 2026-10-16 | `verified-windows-paired-30s` | `not-applicable` |
| `DEV-083` | [1989년 소련 초기 준비시간·메모리 원인 조사](development/testing/soviet-initialization-memory-2026-10-16.md) | 2026-10-16 | `verified-web-diagnostics` | `not-applicable` |
| `DEV-082` | [1989년 소련 WebGL 선택 강조선 및 빈 상호작용 패스 최적화](development/testing/soviet-render-hotpaths-2026-10-16.md) | 2026-10-16 | `verified-web` | `not-applicable` |
| `DEV-081` | [1989년 소련 지도 이동 WebGL2 메시·GPU 업로드 재사용 검증](development/testing/soviet-pan-gpu-reuse-2026-10-16.md) | 2026-10-16 | `verified-web-only` | `not-applicable` |
| `DEV-080` | [공통 웹 초기화 및 전체 세계 데이터 패키징 — 2-3A~C](development/testing/web-shell-full-world-2026-10-16.md) | 2026-10-16 | `investigating` | `not-applicable` |
| `DEV-079` | [웹·앱 공통 파일 입출력 — 2-2 구현 기록](development/testing/web-shell-file-io-2026-10-16.md) | 2026-10-16 | `investigating` | `not-applicable` |
| `DEV-078` | [Windows·Android 웹 기반 시험용 앱](development/testing/web-shell-prototype-2026-10-16.md) | 2026-10-16 | `investigating` | `not-applicable` |
| `DEV-077` | [시점별 객체 편집과 라이브러리 삽입](development/testing/temporal-editing-2026-10-16.md) | 2026-10-16 | `implemented` | `not-applicable` |
| `DEV-076` | [P6–P9 구현·검증 진행 기록](development/testing/p6-p9-execution-2026-10-16.md) | 2026-10-16 | `investigating` | `not-applicable` |
| `DEV-075` | [P5-6 — 공통 C++ 계산 소유권·앱/웹 종료 검증](development/testing/p5-6-final-verification-2026-10-15.md) | 2026-10-15 | `implemented` | `not-applicable` |
| `DEV-074` | [P4 — GIS Python 격리·원격 검증](development/testing/p4-python-gis-isolation-2026-10-14.md) | 2026-10-14 | `implemented` | `not-applicable` |
| `DEV-073` | [P2 — C++ 생성물 자동화 실행·검증](development/testing/p2-generated-artifact-automation-2026-10-14.md) | 2026-10-14 | `implemented` | `not-applicable` |
| `DEV-072` | [Info tab v9 — implementation and visual verification](development/testing/info-tab-v9-visual-validation-2026-10-06.md) | 2026-10-06 | `historical-record` | `not-applicable` |
| `DEV-071` | [P1 — 원격 개발환경 표준화·검증](development/testing/p1-remote-development-validation-2026-10-14.md) | 2026-10-14 | `implemented` | `not-applicable` |
| `DEV-070` | [P0 — 원격 개발 체계·도구 의존성·성능 기준 조사](development/testing/remote-toolchain-p0-audit-2026-10-14.md) | 2026-10-14 | `investigating` | `not-applicable` |
| `DEV-069` | [Git 대용량 이력 정리 — 격리 검증 및 PR 참조 제약](development/testing/git-history-readonly-audit-2026-10-13.md) | 2026-10-13 | `historical-record` | `not-applicable` |
| `DEV-068` | [미사용 세계지도 구버전 대용량 자산 정리 — 의존성 검증](development/testing/legacy-world-asset-retirement-2026-10-13.md) | 2026-10-13 | `historical-record` | `not-applicable` |
| `DEV-067` | [통합 저장소 현행 파일 정리 — 비활성 앱 워크플로](development/testing/current-file-cleanup-2026-10-13.md) | 2026-10-13 | `historical-record` | `not-applicable` |
| `DEV-066` | [공통 C++·WASM 코어와 앱 시작 경로 개선 — 진행 기록](development/testing/shared-core-startup-implementation-2026-10-12.md) | 2026-10-12 | `investigating` | `not-applicable` |
| `DEV-028` | [Android storage and shared UI report](development/app/android-storage-report.md) | 2026-09-17 | `historical-record` | `not-applicable` |
| `DEV-029` | [M7.7 migration release gate — open](development/app/final-parity-report.md) | 2026-09-27 | `historical-record` | `not-applicable` |
| `DEV-030` | [Flag output contract — 2026-10-04](development/app/flag-web-parity-20261004.md) | 2026-10-04 | `historical-record` | `not-applicable` |
| `DEV-031` | [M3.1 selection execution ledger](development/app/m3-selection-progress.md) | 2026-09-19 | `historical-record` | `not-applicable` |
| `DEV-032` | [M3.3 검증 대응표](development/app/m33-verification.md) | 2026-09-19 | `historical-record` | `not-applicable` |
| `DEV-033` | [M5 closure audit](development/app/m5-closure-audit.md) | 2026-09-25 | `historical-record` | `not-applicable` |
| `DEV-034` | [M5 display closure audit: labels, flags, distributions and generic objects](development/app/m5-display-closure.md) | 2026-09-26 | `historical-record` | `not-applicable` |
| `DEV-035` | [M5 map draw and chooser order verification](development/app/m5-order-verification.md) | 2026-09-25 | `historical-record` | `not-applicable` |
| `DEV-036` | [Qt v6 migration and validation status](development/app/m5-v6-validation.md) | 2026-09-24 | `historical-record` | `not-applicable` |
| `DEV-037` | [M6 progress and open acceptance gates](development/app/m6-status.md) | 2026-09-25 | `historical-record` | `not-applicable` |
| `DEV-038` | [M9.7.2 A–C controller and UI validation](development/app/m972-controller-validation.md) | 2026-10-05 | `historical-record` | `not-applicable` |
| `DEV-039` | [M9.7.2: selection value and controller integration](development/app/m972-selection-annex-progress.md) | 2026-10-04 | `historical-record` | `not-applicable` |
| `DEV-040` | [M9.7.5 recovery checkpoint (work in progress)](development/app/m975-recovery-checkpoint.md) | 2026-10-06 | `historical-record` | `not-applicable` |
| `DEV-041` | [M9.7.5 validation scope and remaining limits](development/app/m975-validation-scope.md) | 2026-10-06 | `historical-record` | `not-applicable` |
| `DEV-042` | [M9.7.7 pending-input observation slice](development/app/m977-pending-input-observations.md) | 2026-10-06 | `historical-record` | `not-applicable` |
| `DEV-043` | [M9.7.7 pending-input lifecycle tail](development/app/m977-pending-lifecycle-observations.md) | 2026-10-06 | `historical-record` | `not-applicable` |
| `DEV-044` | [M9.8 current input and restore instrumentation](development/app/m98-prepared-input-validation.md) | 2026-10-07 | `historical-record` | `not-applicable` |
| `DEV-045` | [M9.8 actual projection route preparation](development/app/m98-projection-route-validation.md) | 2026-10-07 | `historical-record` | `not-applicable` |
| `DEV-046` | [Fixed-source Windows measurement and exchange checkpoint](development/app/m98-windows-measurement-e01f0e6.md) | 2026-10-07 | `historical-record` | `not-applicable` |
| `DEV-047` | [P1–P8 / M9.8 execution follow-up](development/app/p1-p8-m98-execution-followup.md) | 2026-10-07 | `historical-record` | `not-applicable` |
| `DEV-048` | [P1–P8 and M9.8 closing report — user requested stop](development/app/p1-p8-m98-final-893e361.md) | 2026-10-07 | `historical-record` | `not-applicable` |
| `DEV-049` | [P8 historical ownership parent choices](development/app/p8-historical-parent-validation.md) | 2026-10-07 | `historical-record` | `not-applicable` |
| `DEV-050` | [P8 stroke implementation and current execution](development/app/p8-stroke-validation.md) | 2026-10-07 | `historical-record` | `not-applicable` |
| `DEV-053` | [Platform boundary refactor validation](development/app/platform-boundaries-validation.md) | 2026-10-07 | `historical-record` | `not-applicable` |
| `DEV-054` | [M7.7 physical platform evidence](development/app/platform-validation.md) | 2026-09-27 | `historical-record` | `not-applicable` |
| `DEV-055` | [Reference image main integration — 2026-10-08](development/app/reference-image-main-merge-validation.md) | 2026-10-08 | `historical-record` | `not-applicable` |
| `DEV-056` | [Reference image web parity implementation ledger](development/app/reference-image-web-parity-progress.md) | 2026-10-08 | `historical-record` | `not-applicable` |
| `DEV-057` | [참조 이미지 웹 누락 기능 검증](development/app/reference-image-web-parity-validation.md) | 2026-10-08 | `historical-record` | `not-applicable` |
| `DEV-060` | [T2-2 integration validation](development/app/timeline-integration-validation.md) | 2026-10-07 | `historical-record` | `not-applicable` |
| `DEV-061` | [T2-2 native persistence validation (2026-10-04)](development/app/timeline-persistence-validation.md) | 2026-10-04 | `historical-record` | `not-applicable` |
| `DEV-062` | [웹판 기능 조사 및 Qt 대응표](development/app/web-feature-audit.md) | 2026-09-17 | `historical-record` | `not-applicable` |
| `DEV-063` | [Windows 32px 프레임 검증 (2026-09-18)](development/app/windows-frame-validation.md) | 2026-09-18 | `historical-record` | `not-applicable` |
| `DEV-064` | [웹·앱 저장소 파일 및 Git 이력 정리 — 1~3단계](development/testing/repository-cleanup-2026-10-12.md) | 2026-10-12 | `historical-record` | `not-applicable` |
| `DEV-065` | [웹·앱 저장소 통합 — 4단계](development/testing/repository-unification-stage4-2026-10-12.md) | 2026-10-12 | `historical-record` | `not-applicable` |
| `DEV-010` | [Country lineage storage 실행 기록](development/testing/country-lineage-storage.md) | 2026-10-06 | `historical-record` | `not-applicable` |
| `DEV-003` | [기본 세계 역사 타임라인 검증](development/testing/historical-world-timeline-validation.md) | 2026-10-12 | `historical-record` | `not-applicable` |
| `DEV-002` | [러시아 상세 형상 편집: 구현 및 검증 기록](development/testing/russia-edit-responsiveness.md) | 2026-09-16 | `historical-record` | `not-applicable` |
| `DEV-001` | [검사·검증 현재 계약 검수 — 2026-10-06](development/testing/validation-audit.md) | 2026-10-06 | `historical-record` | `not-applicable` |

## 과거 실행 기록 (통합)

| 기록 ID | 보존한 요약 및 원문 | 상태 |
| --- | --- | --- |
| `ARC-004, 011~019, 024~026` | [웹·앱 데이터 버전 관리 13건](archive/data-versioning/README.md) | `historical-record` / `unverified` |
| `ARC-020~022, 027` | [수계 구버전 정리 4건](archive/hydro/README.md) | `historical-record` / `unverified` |

## 2026-10-13 보고서 통합 정리 추가 자료

이 단락은 파일 보관 경로를 안내합니다. 조사 완료·지도 반영·실행 검증이 추가로 확인되었다는 뜻은 아닙니다.

| 분야 | 현재 보고서·증거 정본 |
| --- | --- |
| 시아첸 지리 조사 | [연구 개요](research/siachen/README.md), [산등성이 원자료 검토](research/siachen/REVIEW_SALTORO_MULTI_SOURCE_2026-10-08.md) |
| 독일제국 1914년 북슐레스비히 | [사료 검토](geography/germany/north-schleswig/german-denmark-1914-north-schleswig-001-026.review.md) |
| 네덜란드 간척·해안 | [현행 국가·수역 표현 조사](geography/netherlands/phase0-current-representation-inventory.json), [기존 검증 기록](geography/netherlands/phase0-canonical-audit.md) |
| 세르비아 역사 경계 | [세르비아 1914년 QA](geography/serbia/serbia-1914-qa.md) |
| 국가 색상 연구 | [근거 정리](research/country-default-colors.md), [연구 색상표](research/country-default-colors.json) |
| 지명 조사 원문 | [감사 결과](places/place-data-audit.md), [검토 요약](places/place-candidate-review.md), [ID별 근거 JSON](places/candidate-review-summary.json), [출처 매니페스트](places/source-manifest.json) |
| 앱 UI·배포 기록 | [UI 통합 검증](development/app/common-ui-integration.md), [경계 분리 배포 근거](development/app/platform-boundaries-deployment.md) |
| 앱 참조 이미지 | [앱 검증 증거](development/app/evidence/reference-image-web-parity/review.md) |
| 역사 수계 조사 | [r152~r194 조사 데이터](hydro-names/reconstruction-2026-10-09/) |

## 기존 원본·생성 자료

- [수계 보정](hydro-calibration/README.md), [연결성](hydro-connectivity/README.md), [v0.12.3](hydro-v0.12.3/README.md), [v0.12.4](hydro-v0.12.4/README.md), [v0.13.0](hydro-v0.13.0/README.md)의 보고서·도판은 증거 묶음의 상대 경로를 유지합니다.
- [수계 지명 현황](hydro-names/current-web-2026-10-08/README.md)과 [수계 지명 재구성 배치](hydro-names/reconstruction-2026-10-09/)는 원본 출처·검토 자료와 함께 관리합니다.
- [영토 객체 통합 검증](territorial-integration/final-gate.md)은 검사 결과와 함께 기존 위치에 둡니다.
- [지명 검토 JSON](places/candidate-review-summary.json), [도시 좌표 교정](places/coordinate-corrections.json), [생성된 도시 후보 감사](places/place-data-audit.md), [생성된 검토 요약](places/place-candidate-review.md), [ID별 근거](places/candidate-review-summary.json)는 `reports/places/` 정본이며, 생성기와 검증기도 이 경로를 사용합니다.
- [네덜란드 사건·출처 목록](../tools/historical-library/sources/netherlands/change-events.json), [독일 해안선 사건·출처 목록](../tools/historical-library/sources/german-coastline/change-events.json), 역사 도판·probe JSON은 기존 위치의 원본 증거입니다.
- 앱의 [참조 이미지 검증 실행 증거](https://github.com/kimjeon-il/PandoEditor/tree/f535673993f45957b82d125ff766ed1e18233170/docs/evidence/reference-image-web-parity)는 앱 저장소에 남깁니다.

## 세부 조사·검증 원자료

[독일제국 북슐레스비히](geography/germany/north-schleswig/), [수계 지명 조사 배치별 기록](hydro-names/reconstruction-2026-10-09/), [시아첸 연구·위성도판](research/siachen/)에 개별 파일이 보존되어 있음. 수계 배치별 `README.md`·`review/README.md`에서 출처 및 미완료 사항을 추적함. 파일 존재는 현재 반영·재검증을 의미하지 않음.

## 새 보고서 작성

[보고서 양식](TEMPLATE.md)에 ID, 조사 상태, 지도 반영 상태, 출처 커밋과 날짜, 실제 실행·미실행 검증을 분리해 기록합니다. 해당 분야의 `work/*` 브랜치에서 작성하고, 검증된 최종본을 승인된 통합 절차에 따라 `main`에 반영합니다. 지도·앱 코드 변경은 별도 변경으로 검증합니다. [이관 목록](MIGRATION.md)에서 과거 경로를 찾을 수 있습니다.
