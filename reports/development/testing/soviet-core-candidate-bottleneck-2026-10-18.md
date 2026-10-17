# OBJ-097 — 1989 소련 실제 경계 확정의 Core 후보 준비 지연 귀속

> 기록: 2026-10-18 (KST) · 상태: `C++-applyWebTerritorialEdit-block-confirmed / nested-source-stage-running`
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

**미확정:** C++ `applyWebTerritorialEdit`, `candidateState`,
`semanticallyEqual`, `calculateChangeImpact`, WASM `typedRequest`
중 가장 큰 부분. C++ 내부 함수의 CPU 시간은 별도 컴파일 계측 필요.

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

## 5. 추가 심층 계측 — C++ 함수 내부 단계



[OBJ-097 isolated compiled C++ profiling workflow](https://github.com/kimjeon-il/Pando/actions/workflows/soviet-core-candidate-cpp.yml)는
출시 자산과 분리된 임시 Emscripten 4.0.20 빌드에서 함수별 경과시간을 기록한다.
`shared/wasm/session-bindings.cpp`, `shared/core/src/commandbatch.cpp`,
`shared/core/src/commands.cpp`에 **진단 전용 타이머**를 배치하며
진단 후 checkout은 버린다. 정본 생성물 해시가 변경된 배포용 WASM은
커밋하거나 게시하지 않는다.

기록 대상: `typedRequest` 입력 복원, `prepareRequest` →
세부 `applyWebTerritorialEdit`/의미 비교/후보 검증,
최종 문서 검증, `calculateChangeImpact`, WASM 반환 변환.

## 6. 추후 개선 판단 기준

- 가장 긴 C++ 단계의 **실측**을 먼저 확보한다.
- 원본 프로젝트 수정 전에는 C++ 정본의 의미·역사 타임라인·
  출처 참조·Undo/Redo 계약을 유지한다.
- 단순히 제품의 30초 제한시간을 늘려 문제를 숨기지 않는다.
- 원인 수정 후 **동일 소련 실제 UI 정점 이동 → 취소 / 변경 확정 →
  Undo→Redo→Undo**를 다시 통과시키고 제품·Worker V8/WASM/PSS 및
  물리적으로 계측되지 않은 VRAM을 구분한다.
