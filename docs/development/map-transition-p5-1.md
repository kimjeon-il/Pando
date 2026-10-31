# P5-1 — 남은 병목과 Core 시점 후보 준비 계약

작성: 2026-10-31 (Asia/Seoul) · 개발 브랜치 work/ui  
기준 코드: 938054bc4581015110d4367a5da1ee922fbe8a83  
자료 고정: kimjeon-il/PandoLab-library-data @ 139941d8056418547c796068304ba8db3696fe69  
측정 증거: https://github.com/kimjeon-il/Pando/actions/runs/41204726143

## 1. P4-5 이후 실제 계측 (기능 코드는 변경하지 않음)

Playwright/Chromium WebGL2, 1280×800, Asia/Seoul 2026-10-31 고정, 동일 페이지에서 네 번의 연도 이동. 시작은 실제 DOM 클릭, 지도 완료는 기존 temporal onPresented, 후속 완료는 viewerStatus의 ready 공개 지점이다.

| 이동 | 첫 방문/재방문 | 소스 캐시 | 지도 표시(ms) | ready(ms) | source read(ms) | JSON 직렬화(ms) | SHA(ms) | Core baseline admit(ms) | Core loadBaseline(ms) | replaceSnapshot(ms) |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-10 → 2025-12 | 인접 최초 | miss | 2946 | 5643 | 88 | 384 | 17 | 472 | 1671 | 269 |
| 2025-12 → 2026-10 | 현재 재방문 | hit | 2445 | 5063 | — | — | — | 465 | 1677 | 261 |
| 2026-10 → 2016-12 | 먼 시점 최초 | miss | 12281 | 14974 | 89 | 391 | 16 | 461 | 1695 | 9579 |
| 2016-12 → 2026-10 | 먼 시점 복귀 | hit | 11721 | 14386 | — | — | — | 468 | 1675 | 9534 |

- source cache hit에서도 **Core baseline 승인·적재 ~0.47초 + Core 문서 적재 ~1.68초**가 반복된다. P5-2~P5-5에서 줄일 직접 대상이다.
- 먼 시점의 replaceSnapshot wall-time ~9.5초는 더 큰 병목이다. 이 구간은 비동기 지도·물리 지형·렌더 준비까지 포함하며 순수 C++ CPU나 GPU 시간이라고 단정할 수 없다. P5-6의 별도 세부 프로파일/표시 검증이 필요하다.
- 4개 표본만으로 p95 개선이나 일반 모바일 성능을 선언하지 않는다. 단계별 시간은 큐/왕복 포함 wall-time이며 중첩 구간을 더하지 않는다.
- JS heap 표본은 편차가 컸고 Worker는 측정 시 7개였다. GC·WASM·GPU 메모리 누수 여부는 이 측정만으로 판정하지 않는다.
- 계측 파일은 tests/helpers/map-transition-p5-1.mjs, tests/browser/map-transition-p5-1.benchmark.mjs, tests/browser/map-transition-p5-1.config.mjs. 테스트 라우팅을 통한 일시적 관찰만 했으며 생산 코드의 API·문서·형상·렌더 경로는 수정하지 않았다.

## 2. 현재 소스 경로와 금지된 지름길

현행 경로는 builtin-month-clock.selectMonth → viewer-composition.open → builtin-session.prepareProjectSource(최대 3항목/24MiB 소스 캐시) → admitPreparedProjectSource → project-domain.open/replaceAccepted → C++ storageBaselineLoad → C++ documentLoadBaseline → 렌더러 정상 프레임 공개다.

DocumentSession은 활성 Project와 SelectionState, Draft, Undo/Redo, sourceEpoch 및 epoch를 단일 소유한다. storageBaseline_ 및 storageBaselineId_는 **현재 최신 baseline을 보관하는 한 슬롯**이며 storageBaselineLoad는 이미 epoch를 변경한다. project-domain은 하나의 replacement 캡슐을 획득해 rollback/release를 책임진다. 따라서 미리 준비하기 위해 storageBaselineLoad를 호출하면 안 된다. CommandPreview의 편집 candidateId도 시점 전환 후보로 재사용하면 안 된다.

내장 세계지도는 시점별 국가를 선택해서 만든 스냅샷이므로 현재 프로젝트에 setTimelineCursor만 호출해도 다른 시점 국가·형상이 생기지는 않는다. JS로 별도 역사 resolver를 만들거나 기간을 연도로 내림 처리하는 것도 금지한다.

C++ Project/ProjectCodec의 원자적 문서 교체, 현행 월말 기준 역사 조회, 유효기간의 정확한 날짜와 형상 버전, 단일 Core state/read projection, 기존 selection/presentation catalog 및 복구 계약을 유지한다.

## 3. 확정할 신규 C++ API 계약 (구현은 P5-2 이후)

### 3.1 읽기 전용 불변 원본 준비 — P5-2

- 예정 RPC: core.document-temporal-source-prepare (C++ temporalSourcePrepare). 입력은 기존 WebStorageAssetSource의 sourceBytes, encoding, compressedBytes, decodedBytes, sourceMonth, baseDataset, fingerprint 및 expectedEpoch; 데이터 개정/매니페스트 SHA는 상위 호출자의 출처 계약에 포함한다.
- C++ 안에서 SHA-256, 입력 인코딩/길이(압축 최대 256MiB, 압축 해제 최대 64MiB), 원본 월, schema, geometry provenance, 국기 등 기존 검증을 반드시 통과시킨다. 같은 불변 객체에 한해서만 검증된 값을 재사용한다.
- 출력은 별도 세션 전용 sourceId, source fingerprint와 sourceMonth. storageBaselineId와 이름공간을 분리한다. **이 동작 중 활성 Project·storageBaseline_·activeBaseline_·epoch·selection·Undo/Redo·저장 상태는 불변**이다.
- 소유자는 C++ DocumentSession 내부의 유한한 불변 source registry. 실제 바이트 단위 한도는 P5-2에서 소스 크기 계측 후 설정하며 무제한 캐시/영구 원본을 만들지 않는다. 데이터 개정, 세션 종료 및 핸들 해제에 따라 무효화한다. 읽기 전용 사전 준비가 사용자 요청을 가로막지 않는다.

### 3.2 시점 후보 작성 — P5-3

- 예정 RPC: core.document-temporal-candidate-prepare (C++ temporalCandidatePrepare).
- 입력: sourceId, targetMonth, sourceFingerprint, expectedEpoch. 출력: candidateId, sourceId, targetMonth, sourceFingerprint, expectedEpoch, 검증 가능한 semantic receipt.
- Core의 Project/Timeline resolver로 **목표 월의 완결된 스냅샷**을 구성·검증한다. sourceMonth와 targetMonth의 자료 범위가 맞지 않으면 즉시 거부한다. 원본 개별 국가의 존속·소멸, 관계, 형상 버전, 기간 끝점에 대한 기존 의미를 그대로 유지한다.
- 별도 편집 후보·Undo ledger나 JS writable project를 만들지 않는다. 단일 후보 슬롯(새 요청이 옛 후보의 채택 권한을 무효화)과 명시적 소유권/바이트 상한을 갖는다. 준비 단계는 활성 문서/화면을 수정하지 않는다.
- 후보는 세션·원본·epoch·월에 묶인 단기 핸들이다. 다른 세션/문서 세대의 핸들 사용, 누락된 핸들, 오래된 월과 불일치하는 receipt는 거부한다.

### 3.3 후보 채택과 기존 트랜잭션 — P5-4

- 예정 RPC: core.document-temporal-candidate-adopt (C++ temporalCandidateAdopt). 입력 candidateId, sourceId, targetMonth, expectedEpoch, fingerprint; 바깥쪽 JS는 open request ticket, projectGeneration, 현재 자료 개정도 검증한다.
- **채택 직전** 기존 project-domain의 captureReplacement를 실행하고 단 한 캡슐 안에서 C++ 문서 교체를 수행한다. 채택 응답은 그 연산에 해당하는 state + document projection + world + selection + draft를 단일 Core epoch로 반환해 기존 읽기 모델에서 일관되게 공개한다.
- Core 채택은 기존 documentLoadBaseline과 동등한 선택 초기화·저장/dirty·epoch 변화의 의미를 지켜야 한다. 기존 기능과 결과가 다른 경우 새 경로를 사용하지 않는다.
- 새 국경·메쉬·물리 지형과 라벨·클릭 판정이 같은 targetMonth 및 렌더 세대에 해당하고 준비가 완료됐을 때만 프레임을 공개한다. 렌더/선택/Worker 오류 시 동일 캡슐로 rollback, 마지막 확정 시점 및 카메라를 복구한다.
- 새 RPC가 C++에서 이미 시작된 뒤 브라우저가 취소하더라도 계산이 중단됐다고 추정하지 않는다. 응답을 회수한 후 최신 요청 여부를 검사하고 옛 후보를 폐기한다.

### 3.4 후보 해제·실패 의미

- 예정 RPC: core.document-temporal-candidate-discard. 세션 소유의 미채택 후보만 해제한다. 중복 폐기는 무해하고, 다른 후보·현재 원본·활성 문서/선택/저장·GPU에는 영향이 없다.
- 사용자 파일 열기·자료 개정 변경·최신 연도 요청·종료·에러 시 후보 폐기. 준비 실패는 활성 상태 불변; 채택 실패는 기존 rollback; GPU/물리 컨텍스트 불일치는 공개 차단. 오류를 조용한 성공으로 처리하지 않는다.
- 최적화로 인해 조건이 불명확해지면 **기존 검증된 전체 준비/채택 경로로 되돌린다.** 삭제·선택 해제·검색 새 시점 갱신 규칙은 P4-3/P4-4 계약을 그대로 사용한다.

## 4. 실제 파일 소유자와 다음 실행 단위

| 단계 | 파일 소유자 | 범위 및 종료 조건 |
|---|---|---|
| P5-2 | shared/core/include/pandoeditor/document-session.h, shared/core/src/document-session.cpp, shared/core/src/webstorage.cpp | 불변 source 등록/검증/해제, C++ 활성 상태 불변, 용량 상한. 기존 storageBaselineLoad의 쓰기 동작은 바꾸지 않음 |
| P5-3 | 동일 C++ owner, 기존 Project 및 timeline resolver | 후보 작성·세대 검증·국가/형상/속성/기간 동일성. 준비 중 저장·선택·Undo 상태 불변 |
| P5-4 | DocumentSession과 project-domain의 기존 rollback 경계 | 후보 채택/폐기·오류 주입, 단일 Core 교체 캡슐 사용. 출처/세대 불일치 거부 |
| P5-5 | shared/wasm/session-bindings.cpp 및 shared/frontend/js/modules/core-document-runtime.js, core-worker-runtime.js, core-document-client.js, product-mode-policy.js | typed ABI·Worker/JS 소유권·viewer 허용 연산·native/WASM 동일 오류 계약 |
| P5-6 | builtin-session.js, project-domain.js, viewer-composition.js, 물리 지형·렌더러 소유자 | 실제 웹 전환 채택, 새 요청 우선, 캐시·데이터개정 무효화. 2016년 전환의 9.5초 replaceSnapshot은 따로 세분화 계측 후 필요한 범위만 개선 |
| P5-7 | 실제 C++ native/WASM 및 브라우저 집중 회귀 | 새 경로와 기존 경로의 국가 ID 집합, 이름·깃발·색, 좌표/버전/공유 경계, 부모, 유효기간, 월, 선택·검색·저장 상태 일치 |

P5-2~P5-7은 사용자가 지시하는 **한 단계씩** 실행한다. 새로운 C++ API는 P5-1에서는 추가하지 않는다. 기존의 긴 P0 회귀 타임아웃 2건은 사용자가 승인한 유예로 유지하되 새 정확성 회귀는 유예 대상이 아니다.

## 5. 검증 및 배포 경계

P5-1: test-only 계측 단위 4개 통과, CI 실제 브라우저 계측 1개 통과. 데이터 정합성, 돌아오기 SHA, 카메라, dirty/Undo/Redo 상태 동일성 확인. 측정 표본은 CI artifact에 보관하며 전역 P0 20회 벤치마크나 기타 장시간 회귀 검사는 반복하지 않는다.

이번 단계에서 실제 엔진·WASM·뷰어 구현·역사 자료는 변경하지 않는다. main 병합 및 실제 사이트 배포는 하지 않는다.
