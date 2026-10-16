# DEV-081 — 1989년 소련 초기 준비시간·메모리 원인 조사

> 조사 상태: `verified-web-diagnostics` · 지도 자료 반영: `not-applicable` · 2026-10-16
> 대상: `kimjeon-il/Pando`의 `work/objects` · 조사 실행 소스 SHA: `f45c096b9224906c318a809c6a1bbb51f2d8d43c`, `d3528a0db64bf8eeef690e552f4790db0ce33116`, `cadf96f57bb43804c556d5cabb00a9bb466ff4ef`
> **Qt 앱은 조사·수정·성능 검증에서 제외.** 브라우저 웹 및 신규 Windows/Android WebView 웹 UI 앱의 공통 렌더링·저장 경로만 분석함.

## 결론

대형 객체의 느린 초기 준비시간과 메모리 사용은 단일 GPU 메시보다 **시점 변경에 따른 전체 프로젝트 자동 저장, 그 후속 전체 프로젝트 미리보기 검사/재직렬화, 역사적 경계선 편집 준비**가 서로 겹치는 구조로 설명된다. 소련 선택 GPU 버퍼 자체는 2.73MiB이며 단순 지도 이동에서 증분 재업로드되지 않는다. 현재의 장기간 잔류 메모리를 **누수로 확정하지 않는다**. 전체 Chromium PSS에는 다수 Worker, WASM, 브라우저 내부, software GPU 실행 비용 등이 포함되고 Worker별 WASM heap은 직접 분리되지 않았다.

## 실행 대상과 신뢰 범위

- 실제 역사 세계 정본 프로젝트의 `1989-06`, `state:soviet-union`을 사용. 진입·선택·GPU 활성·편집 모드, 시점 복귀까지 확인.
- GitHub-hosted Ubuntu 24.04 Playwright Chromium WebGL2, 뷰포트 1440×900. 실제 렌더러 신원은 ANGLE/Vulkan **SwiftShader software GPU**. Windows WebView2/Android WebView 물리 GPU·VRAM 실측 아님.
- Main JS 메모리는 CDP `Runtime.getHeapUsage` 또는 `performance.memory`; Chromium 전체 메모리는 Linux `/proc/*/smaps_rollup` **PSS 합계**(공유 물리 페이지 안분). 양자는 범위가 다름. 메인 페이지 GC는 전용 Worker·WASM·GPU 리소스를 전부 회수한다고 보장하지 않음.
- CDP CPU Profiler의 symbol self time은 **메인 스레드 표본**. `(program)`·`(idle)`·Worker/C++ 내부 시간을 정확히 함수별로 분리하지 못하므로 profile time을 전체 벽시계 시간으로 합산하거나 비율로 해석하지 않음.

## 1. 초기 시점 전환 및 GPU 선택 준비

첫 계측 [38864035010](https://github.com/kimjeon-il/Pando/actions/runs/38864035010) Playwright 1/1 성공:

| 작업 | 측정 |
| --- | ---: |
| 기본 세계에서 1989-06 시점으로 전환 후 소련 엔터티 확인 | 2,456.0ms |
| 소련 선택 명령 반환 | 355.9ms |
| 선택 시작부터 GPU 강조선 준비 및 SVG fallback 0 확인(선택 명령 포함) | 1,166.7ms |
| 소련 GPU 선택 경계 세그먼트 | 39,819개 |
| 소련 선택 시 추가된 GPU stroke resident bytes | 2,867,160B (약 2.73MiB) |
| 웹 overlay polygon CPU cache | 1,855,204B (시점 전환·선택 중 안정) |

위 시간은 비동기 업로드·메인 스레드 혼잡에 좌우되는 단일 실행 값이며 세 구간을 합산하면 안 된다. 앞선 [DEV-079](soviet-pan-gpu-reuse-2026-10-16.md), [DEV-080](soviet-render-hotpaths-2026-10-16.md)의 결론과 동일하게 **지도 이동만으로 정본 메시·GPU stroke를 다시 만드는 증거는 없다**.

같은 실행의 전체 Chromium PSS는 기본 세계 약 2,182MiB → 1989년 안정화 약 2,515MiB(+333MiB)였다. 소련 선택 버퍼 약 2.73MiB만으로는 이 차이를 설명할 수 없다. 이후 메인 페이지 GC 요청 시 전체 Chromium PSS가 약 298MiB 줄었다. 회수 위치·소유자는 이 값만으로 특정할 수 없다.

## 2. 가장 확실한 중복 작업 — 날짜만 바꿔도 전체 자동 저장

CPU/메모리 추가 계측 [38864838187](https://github.com/kimjeon-il/Pando/actions/runs/38864838187) 성공. 실제 `__PANDOLAB_PERFORMANCE_REPORT__()`가 아래 autosave 결과를 기록했다.

| 자동 저장 트리거 | 전체 persist | Core 저장 데이터 생성·JS 변환(build) | IndexedDB 쓰기 | 실제 형식 |
| --- | ---: | ---: | ---: | --- |
| 1989년 시점 전환 뒤 | 4,201.1ms | 3,528.9ms | 671.5ms | `pandolab-autosave-full` |
| 현대로 다시 전환한 뒤 | 4,966.8ms | 4,685.0ms | 281.1ms | `pandolab-autosave-full` |

호출 체인: `assets/js/modules/app-domain-assembly.js`의 `setTimelineMonth()` 1214~1218행 → `persistenceService.queueProject(650,{scope:'session',markDirty:false})` → `persistence-service.js` `buildAutosave()` → `project-domain.js` `exportReceipt()`에서 C++ 전체 `storageJson` 반환 후 `JSON.parse` → `browser-project-storage.js`에서 IndexedDB `put(project)`로 구조화 복제.

이것은 **편집으로 자료가 수정되지 않은 시점 변경만으로 전체 저장 데이터가 반복 생성·기록되는 것**을 소스와 실행 기록 모두로 확인한 결과다. 저장 단계가 비동기여도 메인 스레드 직렬화 및 구조화 복제, C++ Worker 계산은 지도 사용과 시간상 겹칠 수 있다. 측정된 4~5초가 그대로 화면 프레임을 4~5초 막았다는 뜻은 아니다.

## 3. 자동 저장의 후속 작업 — 전체 프로젝트 미리보기 준비

`persistence-service.js` 119행은 자동 저장 뒤 `previewCache.schedule(autosaveProject)`를 실행한다. `project-preview-cache.js`는 자료 검사/키/미리보기 생성을 예약하고 필요 시 별도 `project-preview-worker.js`를 생성한다. 이 Worker는 완료 후 사용자가 아닌 캐시 소유자가 종료시킨다.

`app-history-assembly.js` 50~59행의 `previewGeometry`는 필요 시 **`buildAutosave()`를 또 실행**하며, `previewProjection`은 `projectDomain.inspectImport()`를 호출한다. `inspectImport()`는 저장된 프로젝트 전체를 `JSON.stringify`로 C++ Worker에 전달하고, 반환 받은 데이터를 `createCoreDocumentReadModel()`로 다시 읽는다. 이 과정의 `createGeometryVersionStore()`에는 전체 형상 객체의 `structuredClone`·검증·동결이 포함된다.

실제 CPU 프로파일에서 자동 저장 이후 편집과 겹친 상태에 `createCoreDocumentReadModel` 443ms, `geometry-version-store.geometry` 408ms가 나타났다. 반대로 미리보기 Worker가 사라진 뒤 편집에 진입했을 때 이 둘은 상위 CPU 병목 목록에서 사라졌다. 따라서 **자동 저장 후 미리보기 검사를 독립적으로 다루는 것이 정확한 성능 귀속에 필수**다. 단, 서로 다른 CI 실행 간의 차이를 통제된 인과적 절감량으로 해석해서는 안 된다.

같은 [38864838187](https://github.com/kimjeon-il/Pando/actions/runs/38864838187) 실행에서 메인 페이지 GC 후 전체 Chromium PSS는 기본 세계 1,808MiB → 소련 선택 2,117MiB → 현대 복귀 및 12초 경과 2,776MiB로 증가했다. 끝 시점에는 별도 `project-preview-worker.js`가 다시 나타났다. PSS 잔류 968MiB는 **장시간 점유·별도 Worker/캐시** 문제를 보여주지만 Worker별 GC·프로세스 분해가 완전하지 않아 메모리 누수로 확정하지 않는다.

## 4. 실제 해안선 편집 초기 준비 (자동 저장 격리)

첫 테스트 [38865251277](https://github.com/kimjeon-il/Pando/actions/runs/38865251277)는 소련 편집 진입 5,982.9ms였으나 직전 저장의 미리보기 Worker가 겹칠 수 있었다.

재검증 [38865608170](https://github.com/kimjeon-il/Pando/actions/runs/38865608170) Playwright 1/1 성공: 자동 저장·프로젝트 미리보기 Worker가 모두 조용해진 뒤 1989년 소련의 실제 해안선 편집 도구를 시작했다. **편집 진입 후 341개 정점 DOM 표시까지 4,838.6ms**가 걸렸다. `previewWorkerQuiescent=true`, 열기·취소 성공, 페이지 오류 0. 40,054개 원본 좌표 모두를 1개씩 DOM 요소로 만들지는 않으며 화면 범위 인덱스 및 희소 핸들 표시가 동작한다.

해당 실행의 프로파일 주요 이름 확인값: `adoptBoundaryRenderPacketAsync` 232.3ms, Worker RPC `handleMessage` 181.0ms, Worker 전송 가드 `guardedWorkerPostMessage` 52.9ms, `renderVertices` 9.8ms, `thinVisibleCoastHandles` 10.9ms. 나머지 `(program)` 표본 3.7초는 함수별 인과·Worker 실행시간으로 단정 불가. **독립적인 `boundary-prepare` Worker 계산과 대형 응답 패킷 전달/동결을 다음 세부 계측 지점**으로 지정한다.

동일 실행 Chromium PSS(단위 MiB)는 편집 전(기존 작업의 GC 이전) 2,423.8 → 편집 진입 직후 2,558.8 → 메인 GC 요청 후 1,919.7 → 취소 및 GC 후 1,878.0. 편집 중 GPU stroke resident 메모리는 약 13.6MiB로 사실상 유지됐고, 편집 취소 시 정점 DOM이 341개에서 0개로 돌아왔다. 전후 GC 조건이 달라 **초기 135MiB PSS 증가 전부를 편집 고유의 retained allocation으로 계산하면 안 된다**.

## 개선 우선순위 (아직 제품 코드 변경하지 않음)

1. **최우선 — 시점 변경 저장 경량화**: 실제 도형/속성/관계 편집이 없는 `setTimelineMonth`에서 `pandolab-autosave-full` 생성·IndexedDB `put`을 반복하지 않도록 세션 월 저장 경로를 분리한다. 파일 재열기 및 자동 저장 복원에서 마지막 조회월을 유지해야 한다. 저장 파일 형식과 시간대·Undo의 정본 계약은 보존한다.
2. **최우선 — 미리보기 캐시의 자료 변경 판정**: 시점·카메라 변화는 저장용 프로젝트 미리보기 재구축과 구분한다. 콘텐츠/geometry revision이 동일하면 `inspectImport`, `buildAutosave` 재호출, preview Worker 재생성을 피한다.
3. **중요 — 대형 편집 패킷 계측**: `boundary-prepare` Worker의 후보 탐색/공유 경계 준비/핸들 생성/전송 및 `adoptBoundaryRenderPacketAsync` 단계를 ms와 실제 payload bytes로 분리한다. 고정밀 원본 보존, 취소·최신 요청 계약은 변경하지 않는다.
4. **중요 — 중복 JS 형상 물질화 억제**: immutable geometry version store의 clone/recursive freeze와 detached import의 `createCoreDocumentReadModel` 재생성을 요청 목적에 맞게 제한한다. 한 C++ 정본 아래 같은 지오메트리 ID/버전이 공유되도록 하는 것이 원칙이다.
5. **후속 — 메모리의 소유권별 통계**: Core/geometry/boundary/preview Worker의 WASM heap, 응답 typed-array, JS 힙, GPU 캐시/driver 메모리를 별도 기록하고 1989→현재 왕복/반복 사이클의 GC·Worker 종료 확인을 병행한다. 캐시는 항목 수뿐 아니라 실제 bytes 예산을 반영한다.
6. **후속 — SVG 준비 과도기**: 처음 소련을 선택할 때 약 180만 자의 SVG fallback 경로가 일시 생성될 수 있다. GPU 안정화 후 fallback 0은 확인됐으므로 초기 1회 문자열 생성·할당만 대상으로 측정·최적화한다.

## 자료·검증의 한계

- [38864035010](https://github.com/kimjeon-il/Pando/actions/runs/38864035010) 시작/선택 메모리 진단, [38864838187](https://github.com/kimjeon-il/Pando/actions/runs/38864838187) CPU/자동 저장 및 12초 잔류 비교, [38865608170](https://github.com/kimjeon-il/Pando/actions/runs/38865608170) 실제 편집 진입 재검증은 **서로 독립된 단일 실행**이다. 서로의 절대값을 성능 개선율로 비교하지 않는다.
- 브라우저의 7개 기본 Worker, 필요 시 8번째 미리보기 Worker가 확인됐다. 개별 Worker별 C++/WASM memory ownership/CPU 시간과 시스템 GPU VRAM, 사용자 실제 Windows WebView2/Android WebView에서의 대형 역사 세계 실행은 미검증.
- 수초간 편집 준비에 불필요한 주기적 메시 생성·업로드가 원인이라는 증거는 없다. 앞선 DEV-079/080의 메시 재사용 검증은 그대로 유효하다.
- 해당 조사에서 **제품 런타임·GIS 지도 원본·Qt 앱·main 배포를 수정하지 않았다**. 전용 Playwright 진단 테스트와 CI 워크플로만 `work/objects`에 추가했다.

## 실측 원본

- [초기 표시/선택/메모리 실측](https://github.com/kimjeon-il/Pando/actions/runs/38864035010), artifact `soviet-initialization-memory-*`의 `measurement.json`
- [CPU/전체 저장/GC 후 잔류 실측](https://github.com/kimjeon-il/Pando/actions/runs/38864838187), artifact `soviet-cpu-attribution-*`의 `measurement.json`
- [자동 저장과 겹친 최초 편집 실측](https://github.com/kimjeon-il/Pando/actions/runs/38865251277)
- [자동 저장 및 미리보기 Worker 격리 편집 실측](https://github.com/kimjeon-il/Pando/actions/runs/38865608170), artifact `soviet-edit-preparation-*`의 `measurement.json`
