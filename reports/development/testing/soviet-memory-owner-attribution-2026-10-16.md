# OBJ-082 — 소련 시점 왕복 메모리 소유권 계측

> 상태: `verified-web-diagnostics` · 2026-10-16 · 대상: `work/objects` `62bc9cc43f6566c87b9b7755d5043482fb79baf4` · 변경 범위: **테스트 및 계측만**
>
> 검증: [GitHub Actions #38921610426](https://github.com/kimjeon-il/Pando/actions/runs/38921610426), 단위 검사 3/3·ESLint·실제 Chromium Playwright 1/1 성공. [원시 JSON 아티팩트](https://github.com/kimjeon-il/Pando/actions/runs/38921610426/artifacts/12055760425) (보관 14일).
> 기존 Qt 앱, 지도 원본, 제품 JS/C++/WASM, `main` 배포는 수정하지 않았음.

## 계측 방식과 해석 한계

- GitHub-hosted Ubuntu Chromium WebGL2/SwiftShader, 뷰포트 1440×900. 실제 Windows WebView2/Android/물리 GPU VRAM 실측은 아님.
- 메인 JS: CDP `Runtime.getHeapUsage`. Worker별 JS: 별도 CDP `Target` 세션을 열어 `Runtime.getHeapUsage` 수집. 모든 비교 구간에 Worker 및 메인 V8 GC 요청.
- Worker별 WASM: 최초 `Runtime.queryObjects(WebAssembly.Memory.prototype)`로 살아 있는 메모리를 찾고 **약한 참조(WeakRef)**로 동일 인스턴스의 `buffer.byteLength`를 추적. 그 크기는 할당된 선형 WASM 메모리이지 C++ 실사용 힙, OS RSS/PSS가 아님. 기존 Worker 및 Emscripten 출력물에는 어떤 추적 코드도 추가하지 않음. 최초 계측 이후 새 WASM 메모리 인스턴스가 생성된다면 이 방식은 자동으로 발견하지 못할 수 있음.
- Chromium PSS: `/proc/[pid]/smaps_rollup` 합계 및 browser/renderer/gpu/utility 역할별 분해. **개별 Worker PSS는 식별 불가**. 공유 메모리 안분·그래픽 드라이버 내부 할당과 브라우저 할당기는 별도 한계.
- GPU 사용: 앱의 `meshVariantBytes`, `stroke.activeBufferBytes`, `selection`, `polygonOverlay`, `terrainCacheBytes`, `hydroCacheBytes`. 추적치 합계는 자원 집합이 겹칠 수 있으며 스텐실·스테이징·VRAM 전체가 누락되어 실제 GPU 총량 아님. PSS와 더하거나 빼서 잔여 사용량을 계산하지 말 것.
- 시점 복귀 후 프로젝트 미리보기 Worker 종료는 확인했지만, **공유 국경선 Worker의 모든 내부 계산 종료까지 확인한 엄밀한 시스템 유휴 측정은 아님**. 따라서 시점 복귀 직후 높은 수치는 진행 중 계산/할당이 혼재됐을 가능성이 있음.

## 실제 1989년 소련 재현 및 GC 후 결과

재현: 현재 기본 세계 → 1989-06 소련 선택 → 해안선 편집 진입 → 취소 → 현대(2026-10)로 복귀 3회, 사이에 소련 시점 재진입 2회.

| 단계 | Chromium PSS MiB | 메인 JS MiB | Worker JS 합계 MiB | Worker WASM 선형 MiB | GPU 자원 추적 MiB |
|---|---:|---:|---:|---:|---:|
| 기본 세계 시작 | 1,587.2 | 76.1 | 117.4 | 361.9 | 95.3 |
| 소련 선택 | 1,798.3 | 144.4 | 83.9 | 361.9 | 100.8 |
| 소련 편집 진입 | 1,789.0 | 163.1 | 138.3 | 361.9 | 100.8 |
| 소련 편집 취소 | 1,741.5 | 121.8 | 138.3 | 361.9 | 100.8 |
| 현대 복귀 1회 | 2,421.3 | 244.4 | 534.6 | 403.5 | 104.6 |
| 소련 재진입 1회 | 1,962.4 | 145.3 | 212.1 | 403.5 | 104.6 |
| 현대 복귀 2회 | 2,613.4 | 230.2 | 567.6 | 403.5 | 110.7 |
| 소련 재진입 2회 | 2,258.1 | 202.0 | 212.2 | 403.5 | 110.7 |
| 현대 복귀 3회 | 2,512.9 | 229.9 | 534.7 | 403.5 | 116.9 |

단일 성공 실행의 수치로, 최초 진입 및 역사 세계 전체 시점 변경의 메모리 변화를 비교하는 **진단 표본**이다. PSS는 현대 복귀 1→2회 증가한 뒤 3회에 감소했다. 증가 일변도의 누수라고 판단할 수 없다.

## 소유자별 핵심 결과

### 1. 공유 국경선 Worker — 현재 최우선 메모리 추적 대상

`country-shared-boundary-worker.js`의 V8 JS 힙은 소련 시점 약 **37.6MiB**, 현대 복귀 1회 **360.1MiB**, 현대 복귀 2회 **393.0MiB**, 현대 복귀 3회 **360.1MiB**로 측정됐다. 현대에서 공유 국경선 세그먼트는 **68,616개**, 소련에서는 **43개**가 표시되어 작업 규모 차이가 크다.

현대 복귀의 높은 Chromium PSS는 이 Worker의 JS 점유뿐 아니라 메인 JS 증가와 동시에 나타났다. 다만 Worker별 PSS 분해와 retained object graph 캡처는 수행하지 않았으므로 **객체 누수 원인으로 단정하지 않는다**. 먼저 `country-shared-boundary-worker.js`의 마지막 전체 입력(`latestMessage`)과 `boundaryState`의 참조 관계, 프레임 완성 후 준비 메모리 수명, 캐시 항목 실제 바이트를 검사할 것.

### 2. 메인 스레드와 편집 Worker

소련 편집 취소 후 메인 JS 힙은 **121.8MiB**, 현대 첫 복귀에서는 **244.4MiB**로 증가했다. 전체 Worker JS는 138.3→534.6MiB, 전체 Chromium PSS는 1,741.5→2,421.3MiB(+679.8MiB)였다.

`map-edit-worker.js`의 JS 힙은 편집 진입·취소 시 약 **90MiB**, 현대 복귀 후 약 **130MiB**로 늘어난 뒤 소련으로 재진입해도 상당 부분 유지되었다. 프로젝트에 필요한 최신 데이터 보유인지 오래된 형상 보유인지 분리해야 한다.

### 3. WASM 선형 메모리

최초 Worker 7개, 그중 Core document Worker WASM은 약 **297.9MiB**. 초기 전체 Worker WASM 선형 메모리는 **361.9MiB**, 최초 현대 복귀 이후 **403.5MiB**로 증가한 다음 세 번째 복귀까지 동일했다. 증가 약 41.6MiB는 공유 국경선 Worker가 16.0→57.6MiB로 확장한 것과 일치한다.

WASM 버퍼 크기가 커진 것은 곧바로 C++ 누수를 뜻하지 않는다. 메모리 확장 후 실제 객체 해제가 이루어져도 Emscripten 선형 메모리 버퍼 크기가 줄지 않을 수 있다.

### 4. 반복 복귀 시 GPU Stroke 자원 유지

현대 복귀 1·2·3회에서 `gpu.stroke.activeBufferBytes`는 각각 **19.8 / 26.0 / 32.1MiB**였고, 같은 시점 GPU 전체 추적치는 **104.6 / 110.7 / 116.9MiB**였다. 기본 메시와 지형 캐시는 사실상 일정했다. `gpu-stroke-renderer.js`는 96MiB 기본 바이트 예산을 가진 자원 유지 정책을 쓰므로, 당장 누수라기보다 기존 활성 프레임이 아닌 리소스가 예산 내에서 남는지부터 검사해야 한다.

현대 복귀 1→3회 PSS는 **+91.6MiB**이며, 같은 구간 메인 JS는 약 14.5MiB 감소, Worker JS는 사실상 일정, Worker WASM 선형 메모리는 일정, GPU 추적치는 약 **+12.3MiB**였다. 이 차액은 별도 실험 없이 'GPU 메모리 누수'나 다른 단일 계층으로 배분할 수 없다.

## 검증 및 후속 측정 순서

1. 공유 국경선 Worker에 `replace`/`patch` 완료 및 캐시 정리 후 진정한 idle 신호를 추가하고, 완료 직후·6초·30초 동일 GC 조건에서 Worker JS, WASM, renderer PSS를 비교한다.
2. `country-shared-boundary-worker.js`의 마지막 요청 전체 입력 참조, `boundaryState` 및 `preparedStore`에서 메모리가 오래 유지되는 이유를 객체 할당 프로파일로 분석한다.
3. GPU stroke는 revision/key별 살아 있는 자원의 `active/protected/inactive` 바이트와 제거 수를 계측해 3회 이상 반복 시 96MiB 예산으로 수렴하는지 확인한다.
4. `map-edit-worker.js`의 편집 취소 이후 90→130MiB가 현재 세계 입력 전환에 따른 정상 상태인지 원본 형상 중복 보유인지 구분한다.
5. 시점만 변경해도 `pandolab-autosave-full` 전체 저장이 반복됨을 다시 확인했다(6회, 각 4.9~7.1초). 날짜만 바꾸는 작업에서 저장 호출을 분리하는 최적화는 다음 단계에서 수행한다.

## 실패 기록 구분

첫 실행 [#38920334061](https://github.com/kimjeon-il/Pando/actions/runs/38920334061)은 실제 9단계 계측과 원시 JSON 보존에는 성공했으나, 300MiB 이상 JS 힙을 가진 공유 국경선 Worker에서 매번 `Runtime.queryObjects`를 호출하면 CDP 시간 초과가 발생하여 계측 완전성 검사가 실패했다. 이를 **약한 참조 기반 반복 측정**으로 보완한 [#38921610426](https://github.com/kimjeon-il/Pando/actions/runs/38921610426)에서 정적 검사, 단위 검사, 브라우저 진단이 모두 성공했다. 두 실행 사이의 절대 메모리 차이를 성능 개선으로 해석하지 않는다.
