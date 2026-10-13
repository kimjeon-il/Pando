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
| `GEO-DEU-008` | [1914 German Empire coast vs provisional modern coastline — screen-space preliminary check](geography/germany/1914-screen-delta-precheck.md) | 2026-10-09 | `investigating` | `not-applied` |
| `GEO-DEU-007` | [Official Schleswig-Holstein WMS period-map coast review — October 9, 2026](geography/germany/1914-sh-period-map-overlay-review.md) | 2026-10-09 | `investigating` | `not-applied` |
| `GEO-009` | [현행 수계 데이터 최적화 — 1단계 (2026-10-09)](geography/hydro/active-hydro-optimization-stage1.md) | 2026-10-09 | `historical-record` | `unverified` |
| `GEO-NLD-006` | [Netherlands land-reclamation rollback survey](geography/netherlands/land-reclamation-reverse-timeline.md) | 2026-10-09 | `investigating` | `not-applied` |
| `GEO-NLD-005` | [Netherlands shoreline pilot — Phase 0 canonical baseline probe](geography/netherlands/phase0-canonical-audit.md) | 2026-10-10 | `investigating` | `not-applied` |
| `GEO-058` | [Terrain integration validation](geography/terrain/app-terrain-integration-validation.md) | 2026-10-07 | `historical-record` | `unverified` |
| `GEO-059` | [P2 terrain LOD and demand validation](geography/terrain/app-terrain-p2-validation.md) | 2026-10-07 | `historical-record` | `unverified` |
| `GEO-023` | [Verified entity lifetime additions](geography/verified-entity-lifetimes.md) | 2026-10-08 | `historical-record` | `unverified` |

## 도시·지명

| ID | 보고서 | 원문 수정일 | 상태 | 지도 반영 |
| --- | --- | --- | --- | --- |
| `GEO-051` | [P5–P7 fixed-source validation](places/app-place-integration-validation.md) | 2026-10-07 | `historical-record` | `unverified` |
| `GEO-052` | [2026-10-11: 웹·앱 지명 검수 264개 / 정식 표시 승인 163개](places/app-place-staging-snapshot.md) | 2026-10-11 | `historical-record` | `unverified` |

## 개발·검증

| ID | 보고서 | 원문 수정일 | 상태 | 지도 반영 |
| --- | --- | --- | --- | --- |
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

## 과거 실행 기록

| ID | 보고서 | 원문 수정일 | 상태 | 지도 반영 |
| --- | --- | --- | --- | --- |
| `ARC-024` | [데이터 버전 관리 1단계 — 앱 GIS 자산 및 웹 출처 기준선](archive/data-versioning/app-data-versioning-phase1-inventory.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-025` | [데이터 버전 관리 4단계 — 앱 출처·동기화 계약 개편](archive/data-versioning/app-data-versioning-phase4.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-026` | [데이터 버전 관리 5단계 — 웹·앱 역사 라이브러리 출처·의미 교차검증](archive/data-versioning/app-data-versioning-phase5.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-004` | [데이터 버전 관리 구조 개선 — 진행 기록](archive/data-versioning/progress.md) | 2026-10-09 | `historical-record` | `unverified` |
| `ARC-011` | [데이터 버전 관리 1단계 — 웹 GIS 자산 및 참조 기준선](archive/data-versioning/web-data-versioning-phase1-inventory.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-012` | [데이터 버전 관리 10단계 — Pages 전환·구버전 삭제·main 선별 병합 실행 준비](archive/data-versioning/web-data-versioning-phase10.md) | 2026-10-09 | `historical-record` | `unverified` |
| `ARC-013` | [데이터 버전 관리 11단계 — 구버전 URL 보존 의무 해제 및 지형 v0.12.0 실제 삭제](archive/data-versioning/web-data-versioning-phase11.md) | 2026-10-09 | `historical-record` | `unverified` |
| `ARC-014` | [데이터 버전 관리 2단계 — 웹 독립 데이터 번들 생성 경로](archive/data-versioning/web-data-versioning-phase2.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-015` | [데이터 버전 관리 3단계 — 웹 런타임·캐시·검증기 전환](archive/data-versioning/web-data-versioning-phase3.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-016` | [데이터 버전 관리 6단계 — GIS 구버전 자산 참조 감사·보관 대상 확정](archive/data-versioning/web-data-versioning-phase6.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-017` | [데이터 버전 관리 7단계 — 공개 배포 URL·기존 앱 릴리스·전체 브랜치 보관 안전성](archive/data-versioning/web-data-versioning-phase7.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-018` | [데이터 버전 관리 8단계 — 기존 URL 보존형 배포 전환 및 전체 브랜치 일괄 정리 사전검증](archive/data-versioning/web-data-versioning-phase8.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-019` | [데이터 버전 관리 9단계 — GitHub Pages 게시 산출물 1GB 타당성 실검증](archive/data-versioning/web-data-versioning-phase9.md) | 2026-10-08 | `historical-record` | `unverified` |
| `ARC-027` | [수계 v0.13.2 2파일 패키지 — 웹·앱 전체 브랜치 적용 기록](archive/hydro/app-hydro-two-file-branch-rollout-2026-10-09.md) | 2026-10-09 | `historical-record` | `unverified` |
| `ARC-020` | [수계 v0.13.2 2파일 통합 및 v0.13.0/1 퇴역 — 최종 4단계 보고서](archive/hydro/hydro-v0132-retirement-stage4.md) | 2026-10-09 | `historical-record` | `unverified` |
| `ARC-021` | [구형 수계 v0.12.2~v0.12.6 — 2단계 삭제 준비 조사](archive/hydro/legacy-hydro-stage2.md) | 2026-10-09 | `historical-record` | `unverified` |
| `ARC-022` | [구형 수계 전체 정리 — 3단계 실행·복원·배포 검증](archive/hydro/legacy-hydro-stage3.md) | 2026-10-09 | `historical-record` | `unverified` |

## 기존 원본·생성 자료

- [수계 보정](hydro-calibration/README.md), [연결성](hydro-connectivity/README.md), [v0.12.3](hydro-v0.12.3/README.md), [v0.12.4](hydro-v0.12.4/README.md), [v0.13.0](hydro-v0.13.0/README.md)의 보고서·도판은 증거 묶음의 상대 경로를 유지합니다.
- [수계 지명 현황](hydro-names/current-web-2026-10-08/README.md)과 [수계 지명 재구성 배치](hydro-names/reconstruction-2026-10-09/)는 원본 출처·검토 자료와 함께 관리합니다.
- [영토 객체 통합 검증](territorial-integration/final-gate.md)은 검사 결과와 함께 기존 위치에 둡니다.
- [지명 검토 JSON](places/candidate-review-summary.json), [도시 좌표 교정](places/coordinate-corrections.json), [생성된 도시 후보 감사](../docs/place-data-audit.md), [생성된 ID별 검토](../docs/place-candidate-review.md)는 도구 입력·생성물이라 이동하지 않습니다.
- [네덜란드 사건·출처 목록](../tools/historical-library/sources/netherlands/change-events.json), [독일 해안선 사건·출처 목록](../tools/historical-library/sources/german-coastline/change-events.json), 역사 도판·probe JSON은 기존 위치의 원본 증거입니다.
- 앱의 [참조 이미지 검증 실행 증거](https://github.com/kimjeon-il/PandoEditor/tree/f535673993f45957b82d125ff766ed1e18233170/docs/evidence/reference-image-web-parity)는 앱 저장소에 남깁니다.

## 새 보고서 작성

[보고서 양식](TEMPLATE.md)에 ID, 조사 상태, 지도 반영 상태, 출처 커밋과 날짜, 실제 실행·미실행 검증을 분리해 기록합니다. 해당 분야의 `work/*` 브랜치에서 작성하고, 검증된 최종본을 승인된 통합 절차에 따라 `main`에 반영합니다. 지도·앱 코드 변경은 별도 변경으로 검증합니다. [이관 목록](MIGRATION.md)에서 과거 경로를 찾을 수 있습니다.
