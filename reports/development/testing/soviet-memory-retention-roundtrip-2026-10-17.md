# OBJ-084 — 1989년 소련 편집·시점 왕복 Worker·WASM 메모리 잔류 계측

> 보고서 ID: `OBJ-084` · 상태: `verified-web-diagnostics` · 지도 반영: `not-applicable` · 색인일: 2026-10-17  
> 원문 최종 수정: 2026-10-17 · 대상: `work/objects` · WebGL2/Worker/WASM (Qt 앱 제외)  
> 테스트 구현: [`fcd3990`](https://github.com/kimjeon-il/Pando/commit/fcd39905623cda2f6de3bcfba5cc760296351091) → [`a3e2a2a`](https://github.com/kimjeon-il/Pando/commit/a3e2a2ac437dc873e1b0180d7cc020ad3051405c)  
> 최종 검증: [Actions #38982808991](https://github.com/kimjeon-il/Pando/actions/runs/38982808991) · ESLint 성공, 단위 3/3, 실제 Chromium Playwright 1/1 성공  
> 원시 증거: [measurement.json ZIP artifact #12081614264](https://github.com/kimjeon-il/Pando/actions/runs/38982808991/artifacts/12081614264) · 보관 기한은 Actions 정책 적용

## 대상 및 재현

이전 [OBJ-082](soviet-memory-owner-attribution-2026-10-16.md)는 소련 시점 왕복 시 Chromium PSS 잔류와 공유 국경선 Worker JS 힙·WASM 증가를 관측했지만, 지연된 미리보기 작업을 완전히 배제하지 못했다. 이번에는 동일 분기를 기준으로 **1989-06 소련 선택 → 해안선 편집 진입 → 취소 → 2026-10 복귀**를 3회 반복하고, 매회 복귀 직후·추가 약 6초·약 30초 뒤에 측정했다. 세 번째 복귀 후 프로젝트 미리보기 Worker의 종료까지 기다려 GC 이후 한 번 더 계측했다.

- Chromium WebGL2(소프트웨어 SwiftShader), GitHub-hosted Ubuntu, 뷰포트 1440×900. `?perf=1&renderer=webgl2` 사용. Windows WebView2·Android 실기기·물리 GPU VRAM은 측정하지 않았다.
- Chromium CDP `Runtime.getHeapUsage`를 메인 스레드와 각각의 Worker 타깃에서 실행하며 가능한 시점에 V8 GC를 요청했다. 기존 Worker 안의 JavaScript lexical binding(`latestMessage`, `draining`, `queued`, `boundaryState.stats()`, `editSources`, `pendingResults` 등)은 **읽기 전용 CDP 평가**로 계측했다. 제품 Worker 코드·C++·WASM·지도 데이터는 변경하지 않았다.
- Worker WASM은 최초 발견한 `WebAssembly.Memory` 인스턴스를 WeakRef로 추적한 `buffer.byteLength` 합계다. 이는 **예약/확장된 선형 메모리 크기**이며 C++ 살아 있는 할당 객체 바이트가 아니다. 최초 캡처 이후 새로 생긴 인스턴스를 발견하지 못할 수 있다.
- Linux `/proc/*/smaps_rollup` PSS는 Chromium 프로세스별 안분 메모리다. 개별 Worker PSS를 분리할 수 없고, WebGL 앱 캐시 계수는 실제 VRAM과 동일하지 않다. 서로 다른 계층의 합계를 차감하여 원인을 추정하지 않는다.

## 반복 실험 — 주요 관측 수치

| 구간 | Chromium 총 PSS MiB | 메인 V8 JS MiB | 상주 Worker JS 합계 MiB | 상주 Worker WASM 선형 MiB | 앱 GPU 추적 MiB | 미리보기 Worker |
|---|---:|---:|---:|---:|---:|---|
| 현대 세계 초기 | 1,586.29 | 76.1 | 117.4 | 361.9 | 95.3 | 없음 |
| 소련 첫 편집 진입 | 1,774.03 | 163.1 | 138.2 | 361.9 | 100.8 | 없음 |
| 소련 첫 편집 취소 | 1,726.51 | 121.8 | 138.2 | 361.9 | 100.8 | 없음 |
| 현대 복귀 1회 | 2,511.69 | 240.5 | 534.5 | 403.5 | 104.6 | 없음 |
| 현대 복귀 1회, 약 30초 후 | 2,773.39 | 294.8 | 미계측 | 미계측 | 104.6 | **실행 중** |
| 소련 편집 취소 2회 | 1,813.36 | 122.3 | 150.3 | 403.5 | 107.3 | 없음 |
| 현대 복귀 2회 | 2,506.89 | 229.8 | 534.5 | 403.5 | 110.7 | 없음 |
| 현대 복귀 2회, 약 30초 후 | 2,799.63 | 295.2 | 미계측 | 미계측 | 110.7 | **실행 중** |
| 소련 편집 취소 3회 | 1,845.67 | 122.7 | 150.4 | 403.5 | 113.5 | 없음 |
| 현대 복귀 3회 | 2,550.70 | 230.0 | 534.5 | 403.5 | 116.9 | 없음 |
| 현대 복귀 3회, 약 30초 후 | 2,833.20 | 295.4 | 미계측 | 미계측 | 116.9 | **실행 중** |
| **미리보기 Worker 종료 및 GC 후** | **2,334.08** | **196.5** | **534.5** | **403.5** | **116.9** | **종료** |

메모리 미계측은 값 0이 아니라 CPU 점유가 높은 `project-preview-worker.js`에 보낸 CDP `HeapProfiler.collectGarbage` 명령이 제한시간 안에 응답하지 못하여 **Worker 전체 집계가 불완전한 구간**을 뜻한다. 상주 공유 국경선·편집 Worker 각각의 계측은 이 구간에도 정상적이었다. 6초/30초는 테스트 코드의 추가 대기 지점이며 계측 자체 소요시간도 있어 엄격한 작업 완료 후 유휴 시간 기준은 아니다.

## 소유자별 판정

### 1. 프로젝트 미리보기 Worker: 반복되는 일시적 고점

- 세 차례 무거운 Worker의 수명은 **65.803초, 65.310초, 66.817초**였다. `project-preview-cache.js`는 각 Worker 작업에 **60초 제한시간**과 종료 처리를 갖고 있다. 수명이 제한시간 근처인 사실은 확인되지만 각 작업이 정확히 어떤 단계에서 끝났는지/시간 초과 여부까지 확정하지 않았다.
- 현대 복귀 약 30초 후 PSS는 **2,773.39 → 2,799.63 → 2,833.20 MiB**로 증가했다(+59.81MiB). 다만 이 세 샘플에는 미리보기 Worker가 모두 남아 있었다. 따라서 같은 기준 상태의 `idle-after-GC` 증가를 의미하지 않는다.
- 마지막 미리보기 Worker 종료 후 총 PSS **2,833.20 → 2,334.08 MiB(-499.12MiB)**, 메인 V8 JS **295.4 → 196.5MiB**로 감소했다. 같은 구간 Chromium renderer PSS도 약 2,124→1,625MiB로 줄었다. Worker별 독립 PSS가 없어 이 감소분 전체를 특정 Worker 객체에 귀속할 수는 없지만 **미리보기 실행과 높은 PSS의 동시성**은 강하다.
- 미리보기 Worker 생성·수명·종료가 데이터로 기록됐다. Workload의 원인은 프로젝트 자동저장·미리보기의 비동기 경로 및 현재 브랜치의 작업 예약을 우선 추적할 필요가 있다. 통합 브랜치의 다른 최적화 적용 여부는 이번에 비교하지 않았다.

### 2. 공유 국경선 Worker: 큰 정상 보유 상태가 반복됨

- 소련 뷰의 Worker JS 힙은 약 **37.6~37.7MiB**, 현대 뷰는 복귀 세 번 모두 약 **360.1MiB**였다. 편집 취소·복귀를 거치며 현대에서 단계적으로 계속 늘어나는 현상은 관측되지 않았다.
- 현대에서 `latestMessage.features`는 **254개**, 소련에서는 **5개**였다. 모든 비교 가능한 해당 Worker 진단에서 `queued=false`, `draining=false`, `pendingCache=null`이었고 현대 국경 접촉 건수(`contactCount`)는 **339개**로 일정했다. 다만 마지막 입력(`latestMessage`)과 `boundaryState.preparedStore`가 서로 중복해서 큰 형상을 보유하는지는 retained-object graph 없이 확정할 수 없다.
- 이 Worker의 WASM 선형 메모리는 첫 현대 복귀 때 **16.0→57.6MiB(+41.6MiB)**로 확장한 후 모든 반복 구간에 동일했다. Emscripten WASM 버퍼 성장 후 비축된 공간은 살아 있는 C++ 객체 누수와 구분한다.

### 3. 편집 Worker·Core WASM·GPU

- `map-edit-worker.js`는 현대에서 JS 약 **130.0MiB**, 소련에서 편집 첫 회 약 89.9MiB·2~3회 약 101.8~101.9MiB였다. 현대의 `editSourceCount` 254, 소련의 5는 현재 세계 모델의 규모와 일치한다. `pendingResults`, `cutSources`, `validatedPreviews`는 검사 시 0이었다. 원본 형상의 중복 보유 여부는 힙 스냅샷 없이 판정하지 않는다.
- Core document Worker WASM 선형 메모리는 약 **297.9MiB**로 일정했다. 전체 Worker WASM은 시작 **361.9MiB**, 최초 현대 복귀 이후 **403.5MiB**로 고정되었다.
- 앱 GPU 추적 계수는 현대 복귀별 **104.6 → 110.7 → 116.9MiB**(+12.3MiB). 주로 stroke 자원 증가와 동반하지만 96MiB 유지 예산 안의 inactive/retained 자원인지, 실제 VRAM 증가인지는 이번 검사로 단정할 수 없다.

## 검증 결과 및 범위

- 최종 [GitHub Actions #38982808991](https://github.com/kimjeon-il/Pando/actions/runs/38982808991) **성공**: ESLint, Node 단위 3/3, 실제 Chromium Playwright 1/1. 총 **20개 단계**, 모든 3회 편집 취소 후 정점 0개, 최종 미리보기 Worker 종료, 최종 상주 Worker JS/WASM 수집 완전, 브라우저 page error 없음.
- 직전 [#38982013373](https://github.com/kimjeon-il/Pando/actions/runs/38982013373)은 19개 동작 단계를 끝내고 원시 JSON을 보존했으나 바쁜 미리보기 Worker의 GC 응답 시간 초과 때문에 전체 Worker 완전성 검사가 실패했다. 이후 시험은 누락값을 0으로 변환하지 않고 **최종 Worker 종료 후의 완전한 샘플**을 추가하여 통과했다. 두 실행의 절대 PSS 차이를 제품 개선이라고 해석하지 않는다.
- **판정**: 3회 반복에서 7개 상주 Worker의 JS 및 WASM 사용량에 일방향 증가 누수는 확인되지 않았다. 메모리 급증에 미리보기 Worker의 지연 계산이 크게 관여하는 것으로 관측됐다. 렌더러의 높은 최종 PSS 2,334.08MiB 및 공유 국경선 JS 360.1MiB가 **최소 필요치인지**는 아직 미확정. 단일 CI 환경·3회 반복만으로 장기 누수 부재를 증명하지 않는다.

## 다음 조사 및 최적화 순서

1. **우선순위 1 — 미리보기**: 시점 변경/자동저장/미리보기 예약 및 취소 시점, 60초 구간의 단계별 CPU·힙, 비동기 종료 실제 시점을 계측한다. 수정은 `project-preview-cache.js`의 기존 단일 소유 구조 안에서 수행하며 다른 Worker 경로를 새로 만들지 않는다. 특히 `work/integration-ui-objects-20261016`의 미리보기 중복 제거와 비교 후 중복 작업을 피한다.
2. **우선순위 2 — 국경선 Worker 보유 객체**: `latestMessage` 원본 입력·preparedStore·contacts 참조 그래프 및 실제 유지 바이트를 heap snapshot으로 확인한다. 크기가 안정돼 있다는 사실과 크기가 필요하다는 주장은 다르다.
3. **우선순위 3 — 편집 Worker 보유 및 GPU stroke**: 시점 복귀 후 `editSources`의 현행/구형 형상 참조, GPU stroke `active/protected/inactive` 바이트와 폐기 수를 분리하여 정상 캐시 상한 수렴성을 확인한다.
4. **우선순위 4 — 장기 분포**: Windows WebView2/물리 GPU에서 같은 시점과 재현법으로 반복 10회 이상, CPU idle·Worker 종료 후 PSS 측정을 추가한다. Android 실기기는 현 단계에서 제외한다.

## 변경·보존 범위

- 코드는 **브라우저 테스트 1개, 계측 헬퍼 1개, 단위 테스트 1개만** 변경했고, 본 보고서와 보고서 색인을 추가했다. Qt 앱, 지도 자료·역사 형상, 제품 JS/C++/WASM, `main` 배포는 수정하지 않았다.
- 관련 이전 보고서: [OBJ-082](soviet-memory-owner-attribution-2026-10-16.md) · 시점 계산 최적화 [OBJ-083](objects-timeline-cursor-reuse-2026-10-17.md). 이전 표본은 역사 기록으로 보존하며, 이 문서가 세 차례 편집 반복과 미리보기 종료 후 검증의 최신 판본이다.
