# P6 — 프로젝트 저장·복원 및 호환성 경계

> **현행 정본·당시 검증의 구분:** 지원하는 프로젝트 스키마는 코드의 [`src/runtime/version-contract.js`](../src/runtime/version-contract.js)와 [프로젝트 읽기·검증](../src/document/project-state.js)에서 확인한다. 아래 GPKG/정본·출처 보존 제한은 [객체·시간축](policies/objects-time.md) 및 [프로젝트·자료](policies/data-projects.md) 색인에서 찾을 수 있다. `work/objects` P6 테스트 명령·범위와 결과는 당시 검증 계획으로 보존하며 현재 저장/복원 기능의 전체 인수검사를 인증하지 않는다.

기준: `work/objects` P0–P5 후속 작업, 2026-11-06. 이 문서는 현재 지원 범위를 기록하며 이전 버전의 마이그레이션을 약속하지 않는다.

## 정본과 버전

- 현재 파일은 `.gpkg`의 `pandolab_project_settings.project_state`에 담긴 `pandolab-project-state`, **schemaVersion 14**다. 버전 13 이하 또는 알 수 없는 미래 스키마, `pandolab-autosave-*`를 파일로 위장한 자료는 명시적으로 거부한다. 스키마를 자동 상향·하향하거나 기존 객체 ID를 새로 발급하지 않는다.
- `documentId`, 프로젝트 시작 설정, 영역 정체성, 전체 `timelineRecords`와 `geometries` archive, 작성된 지명·하천·호수, 분포 자료 및 `sourceInfo`는 정본 JSON과 C++ document owner가 소유한다. GPKG 공간 레이어는 표시·교환용 파생물이며 이를 역으로 읽어 정본 형상/날짜/관계를 덮어쓰지 않는다.
- `sourceEntityId`, `sourceGeometryVersion`, `metadata.libraryOrigin`의 `libraryId`·`sourceVersion` 등은 프로젝트에 기재된 **원본 출처 식별자**다. 최신 외부 라이브러리 ID/버전으로 묵시적 재연결·교체하지 않는다. 외부 라이브러리 자료 핀과 원본 GIS 자료는 이번 단계에서 변경하지 않는다.

## GPKG 별도 표의 처리

- `pandolab_source_info`는 정본 `sourceInfo`와 일치하는지만 검사한다. 현재 writer가 정본 `null`을 `{}`로 직렬화하는 경우는 동등하게 취급하며, 표가 없으면 정본 JSON으로 충분하다.
- `pandolab_country_assets`는 정본에 국기가 **없는 경우에 한해** 별도 저장한 국기를 복구한다. 정본에 동일한 국기가 이미 있으면 중복 복구하지 않으며, 서로 다른 국기 값·중복 ID·존재하지 않는 객체 ID·부적절한 인코딩은 오류로 처리한다. 별도 표로 프로젝트의 기존 출처·국기·형상을 변경하지 않는다.
- 검증 실패, 손상된 Worker 응답, 읽기 실패는 기존 프로젝트를 교체하기 전 가져오기 작업을 중단한다. 정상적인 GPKG의 공간 레이어 유무는 날짜별 형상 archive 보존과 무관하다.

## 저장 수명주기

- Viewer는 현재 읽기 전용이다. **Viewer의 IndexedDB 저장은 프로젝트 파일이나 편집 자동저장이 아니라 보기 상태**이며, 기존 DB 버전 2·키 `viewKey:documentId`를 유지한다. 저장 레코드의 `documentId`가 키와 다르면 다른 프로젝트의 표시 상태를 복구하지 않는다.
- 파일 저장은 정본 C++에서 동일 epoch의 프로젝트 JSON과 공간 투영을 받아 인코딩한다. 파일 기록 중 편집이 진행되면 구 epoch의 저장 완료를 최신 문서의 저장 완료로 간주하지 않는다.
- 기존 편집 경로의 자동저장 계약은 `pandolab-autosave-full` 전체 snapshot(영역 정체성·타임라인·형상 archive 포함)이다. 과거 delta 계약을 읽어야 한다면 `baseDataset` 및 정확한 `baseDatasetFingerprint`가 일치할 때만 복원하며, 불일치 시 기존 문서를 유지하고 오류를 반환한다. Viewer에 별도 자동저장 writer나 두 번째 프로젝트 소유자를 추가하지 않는다.

## P6 당시 최소 회귀 검증 기준

- `tests/unit/data/project-persistence.test.mjs`: 정본 버전·문서 ID·출처 일치, 국기 sidecar 무손실/충돌 거부, IndexedDB 문서별 격리.
- `tests/unit/core-gpkg-file-boundary.test.mjs`: 정적·복합 타임라인 C++ export → 실제 GPKG → import 후 정본 전체 일치.
- `tests/unit/project-opening.test.mjs`, `tests/unit/document/project-lifecycle.test.mjs`, `tests/unit/document/core-project-file-save-wasm.test.mjs`: 교체 실패 원자성, 저장 중 최신 편집 보호.
- `tests/unit/project-serializer.test.mjs`: full/delta archive 및 원본 fingerprint 계약. 모든 검증은 관련 범위에 한정하며 전체 GIS·전체 프로젝트 검사는 별도 승인 범위다.
