# OBJ-097 — 1989 소련 실제 경계 확정의 Core 후보 준비 지연 귀속

> 기록: 2026-10-18 (KST) · 상태: `verified-deep-cxx-parent-containment-bottleneck / product-unchanged`
> 조사 브랜치: `work/perf-core-candidate-diagnostics-20261018`
> 기준 제품: `work/perf-soviet-edit-acceptance-20261017` (`OBJ-092~095` 포함)
> 지도 원본·제품 JS/C++/WASM·`main` **영구 변경 없음**.
> 계측은 GitHub Actions의 폐기 가능한 checkout에서만 임시 소스를 패치하며, 30초 제한시간 해제는 진단 실행에만 적용된다.

## 1. 실제 문제

[OBJ-096](soviet-real-edit-cpu-reference-2026-10-17.md)에서 1989-06 소련 해안선 실제 UI 정점 이동 후
`map-edit-worker`의 `boundary-move` **30.8ms**, `territorial-edit` **1,236.7ms**가 정상 응답했다.
`territorial-edit`의 미리보기 검증 차단 플래그는 `false`였으나
뒤이은 `core.document-prepare`는 30,000ms 기본 RPC 제한시간 내 완료되지 않았고
UI는 `PL-TERRITORIAL-EDIT` 오류를 표시했다.

## 2. 기본 제품 C++ 처리 경로 (정적 소스 확인)

`app-territorial-drafts.js`의 `previewTerritorialEdit()`은 `territorial.patch`
단일 하위 작업을 담은 `territorial.edit` 명령을 `projectDomain.prepareCommand()`에 전달한다.

1. `project-domain.js`: 기존 명령 큐 완료를 기다린 후 `commandOwner.prepare()` 호출.
2. `core-document-client.js`: `core.document-prepare` RPC를 Core Worker로 전송(제품 기본 제한시간 30초).
3. `core-worker-runtime.js`: Core Worker 문서 직렬 실행 큐에 등록.
4. `core-document-runtime.js`: WASM `DocumentSession.prepareCommand(envelope)` 동기 호출.
5. `shared/wasm/session-bindings.cpp`: `territorial.edit`이 `isWebGeometryBatchCommand`이므로
   `typedRequest()`로 개별 `territorial.patch` 입력을 C++ 형태로 복원하고 `DocumentSession::prepareBatch()`로 진입.
6. `shared/core/src/commandbatch.cpp`: 단일 입력이어도 `CommandProcessor::prepareRequest()`를
   수행하고 결과 후보를 최종 `DocumentState`로 다시 구성한 뒤
   `calculateChangeImpact()`를 호출한다.
7. `shared/core/src/commands.cpp`: `WebTerritorialEdit`에서는
   `validateRequest`→`applyWebTerritorialEdit`→`semanticallyEqual`→
   `reconcileGeometryProvenance`→`candidateState` 순서로 진행된다.
   `applyWebTerritorialEdit` 내부에서도 타임라인 정규화와 부모 관계 검증이 수행된다.
8. Core 호출이 성공하면 **그제야** `project-domain.js`에서 `candidateProjection()`을
   별도로 요청하고 현재 화면용 preview를 채택한다.

입력 형상 복사, C++ 후보 검증, 최종 영향 계산에는 중복 검증 및
대형 지오메트리 반복 탐색 가능성이 있다. 이 **가능성은 함수별 계측 전 원인 확정이 아니다**.

## 3. Worker 큐 지연 vs 동기 WASM 계산: 직접 실측

[OBJ-097 isolated worker stage #39072836861](https://github.com/kimjeon-il/Pando/actions/runs/39072836861)
(진단 checkout에만 30초 RPC deadline 해제)의 실제 Chromium 실험:

- 세계: 1989-06, 소련 국가 `state:soviet-union`의 사용자 UI 해안선 정점
  `[132.404714,45.146496]`를 실제 포인터로 이동.
- `boundary-move` : **59.4ms**, 정상 응답.
- `territorial-edit`: **1,944.3ms**, 정상 응답.
- `core.document-prepare` 요청 확인, Core Worker 실행 큐 진입 지연
  약 **0.1ms**, 문서 내부 실행 큐 진입 지연 약 **0ms**.
- `core-document-runtime`에서 동기 `core.prepareCommand(...)` 호출
  **직전 지점의 계측 이벤트 확인**.
- 같은 실험에서 진단상 관측 대기를 **135초**로 늘렸지만
  `wasm-call-return` 계측 이벤트는 끝내 기록되지 않았다.
  해당 실험은 기대한 135초 이내 반환이 없어 실패 종료했으며, 이것이
  소스 코드 회귀의 실패를 의미하지는 않는다.

**현재까지 확정 가능한 결론:** 단순 메시지 큐나 Core Worker 디스패치
지연이 아니라, WASM API의 동기 호출 구간(`embind` 변환 +
C++ `prepareBatch` + 응답 처리)에서 상당한 시간이 쓰인다.
실험상 Core 후보는 30초보다 훨씬 긴 시간에도 반환되지 않았다.

**후속 C++ 계측 결과(아래 5절):** 지연은 `applyWebTerritorialEdit`의
`validateTimelineParentChanges`가 호출하는 `geometryContains`에서
재현됐다. `semanticallyEqual`, `calculateChangeImpact`는 이번
실험에서 호출되지 않았으므로 현재 차단의 원인이 아니다.

## 4. 첫 C++ 심층 결과: 정확한 차단 함수

[Disposable compiled WASM run #39073158556](https://github.com/kimjeon-il/Pando/actions/runs/39073158556)는
GitHub Actions 호스팅 Chromium에서 **실제 Soviet 정점 이동**
`[132.404714,45.146496]`을 반복했다.
배포된 제품 자산 대신 Emscripten 4.0.20 동일 도구체인으로
진단 함수 타이머만 추가한 임시 WASM을 사용했다.

| C++ 구간 | 계측 완료값 | 판정 |
| --- | ---: | --- |
| `binding.decodeJsTerritorialRequest` | **30.7ms** | 성공 |
| `batch.typedRequest` (위 입력 해석 포함) | **31.5ms** | 성공 |
| `request.validateRequest` | **0.6ms** | 성공 |
| **`request.applyWebTerritorialEdit`** | **135초 추가 관찰에도 종료 신호 없음** | **차단 함수 확인** |
| `request.semanticEqual`, `request.reconcileProvenance` | 미도달 | 원인으로 확인되지 않음 |
| `request.validatedCandidateState`, `batch.finalChangeImpact` | 미도달 | 원인으로 확인되지 않음 |

이 결과는 입력 역직렬화(약 31ms)와 일반 명령 validation(0.6ms)이
기존 30초 초과의 원인이 아님을 구분한다.
`applyWebTerritorialEdit()` **내부**의 활성 세계 투영,
현재월 source row 병합, 지오메트리 버전/타임라인 바인딩 처리,
정규화·부모 포함관계 검사 중 어느 것이 느린지는
아직 이 실행만으로 구분할 수 없다.

이 결과가 수집된 테스트는 초과 관측 조건을 만족하지 못해 **실패 종료**했다.
실제 변경 확정·Undo/Redo가 완료됐다고 해석하면 안 된다.

## 5. 최종 내부 원인: 소련과 구성 공화국의 지리적 포함관계 검사

[OBJ-097 deep compiled WASM #39073832159](https://github.com/kimjeon-il/Pando/actions/runs/39073832159)
(소련 `1989-06`, 실제 해안선 정점 `[132.404714,45.146496]`, 임시
Emscripten 4.0.20 WASM)에서 다음과 같이 기록됐다.

| 호출 단계 | 실제 계측 |
| --- | ---: |
| 명령 변환 `typedRequest` | 31.3ms (그중 개별 변환 31.0ms) |
| `request.validateRequest` | 0.6ms |
| `web.activeFrame` | 21.8ms |
| `web.changedRows` | 0.4ms |
| `web.candidateDocumentCopy` | 0.4ms |
| `web.applyMonth` | 3.2ms |
| `web.projectTimelineView` | 11.1ms |
| `web.captureTimelinePropertyChanges` | 3.1ms |
| `web.normalizeTimelineRecords` | 9.1ms |
| **`containment.start` 아르메니아 SSR** | **47,012.5ms**, 완료 |
| **`containment.start` 아제르바이잔 SSR** | **47,146.0ms**, 완료 |
| `containment.start` 벨라루스 SSR | 시작 확인, 135초 관측 종료까지 미완료 |
| `web.validateTimelineParentChanges` | 미완료 |
| 최종 문서 검증 및 `calculateChangeImpact` | 미도달 |

위 첫 묶음의 준비 단계들은 최초 로딩/소스 입장 시에도 일부 실행되므로,
핵심 비교는 `territorial.edit` 요청 이후에 기록된 값이다.
해당 요청에서 `applyMonth` 등은 밀리초 단위로 완료됐고
`validateTimelineParentChanges`에 진입한 뒤
`geometryContains(*outer,*inner)`가 각 구성 공화국에 대해 장시간 실행됐다.

**직접 원인:**
`shared/core/src/timeline-view.cpp`의 `validateTimelineParentChanges()`는
변경된 부모 소련의 `geometryRef`가 이전과 다르므로 구성 공화국의
부모–자식 포함관계 검증을 다시 수행한다.
`shared/core/src/geometrypredicates.cpp`의 `geometryContains()`는
날짜변경선/180° 분리 등에서 `geographicContains()`를 호출한다.
그 안의 `edges(subject)`와 `periodicCuts(container,...)` 및
`periodicLocation()`은 선분마다 상대 지오메트리의 경계를
반복 탐색한다. 큰 소련 윤곽을 작은 구성 공화국별로
반복하는 구조에는 **선분 후보 공간 인덱스가 없다.**

이를 통해 기존 사용자 지연이 단순 Web Worker 대기나 WASM 로딩,
전달 직렬화, 최종 `calculateChangeImpact`가 아니라
**원본 소련의 타임라인 하위 단위 포함관계에 대한
대형 지리적 폴리곤 술어의 반복 평가**임을 확인했다.

주의: 함수별 관측은 GitHub-hosted Chromium/SwiftShader 및
진단용 C++ 타이머가 들어간 임시 WASM 기준이다.
`geographicContains` 내부의 각 하위 함수별 사이클 점유,
실제 전체 완료시간, Windows/Android 및 물리 GPU 결과까지
추론하지 않는다. 135초 실험의 실패는 의도된 관측 한계
`wasm-call-return` 미발생으로, 실제 미리보기/Undo 성공을 뜻하지 않는다.

### 안전한 다음 최적화 지점

1. `geometryContains`의 **완전 탐색 후보 선분**을 지리적 주기(±360°),
   날짜변경선, hole, 폴리곤별 winding을 존중하는
   **읽기 전용 공간 후보 인덱스**로 줄인다. 최종 교차 판정과
   점 위치 분류의 기존 정밀도·포함 의미는 바꾸지 않는다.
2. 한 `validateTimelineParentChanges` 호출 안에서 변경되지 않은
   부모·자식 geometry 버전 관계는 보존하고, 참조당 반복 계산을
   정확하게 제거하는 방식도 독립적으로 검증한다.
   단, 단순한 bounding box 불포함/동일 버전만으로 부모 포함관계를
   통과시키거나 안전 검사를 삭제하지 않는다.
3. 같은 입력으로 **원형 소련+SSR**, 날짜변경선, 극지, 구멍,
   다중폴리곤, 완전히 포함/경계 접촉/실제로 바깥으로 벗어나는
   변경을 포함한 C++/WASM/브라우저 결과 동등성과 성능 A/B를
   얻은 후에만 제품 코드에 반영한다.
4. 그 다음 실제 UI **미리보기 취소 → 확정 → Undo→Redo→Undo**,
   Worker 및 전체 Chromium 메모리 수렴성을 재검증한다.
   **30초 RPC 제한을 늘리는 것은 최적화가 아니다.**

이번 조사에서는 제품 C++/WASM/JS와 지도 데이터, `main`을
수정하지 않았다. 보고서·CI·테스트용 임시 컴파일 스크립트만
별도 브랜치에 보관했다.

## 6. 최종 결론

**원인 규명 완료, 제품 CPU 최적화 및 실제 Core 확정 회귀는 미완료.**

`applyWebTerritorialEdit` 내부의 `validateTimelineParentChanges`가
소련 구성 공화국 각각에 대해 수행하는 `geometryContains`의
반복 지리적 포함관계 판정이 135초 이상의 지연을 유발한다.
기존 30초 타임아웃을 늘릴 이유가 아니라,
정확한 폴리곤 술어의 후보 탐색 비용을 줄일 이유가 확인됐다.

