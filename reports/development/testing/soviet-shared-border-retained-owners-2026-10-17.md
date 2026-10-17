# OBJ-088 — 소련 시점 왕복 후 공유 국경선 Worker 360MiB JS 힙 참조 소유권 분해

> 보고서 ID: OBJ-088 · 상태: verified-web-diagnostics · 지도 반영: not-applicable · 색인일: 2026-10-17  
> 원문 최종 수정: 2026-10-17 · 제품 코드 기준: main e85b3e158d5c02e4aa028283db5b83a1750f4b1a  
> 검사/계측만 변경: work/integration-ui-objects-20261016 · 소스 구성은 pinned main 제품 파일과 동일 · Qt 앱, Android, Windows WebView2, GIS 데이터 수정 없음  
> 성공한 Chromium 1차 참조 소유권 검사: [Actions #39003118598](https://github.com/kimjeon-il/Pando/actions/runs/39003118598) · [원시 artifact #12090057528](https://github.com/kimjeon-il/Pando/actions/runs/39003118598/artifacts/12090057528)  
> 성공한 Chromium 세부 파생 구조 검사: [Actions #39003624922](https://github.com/kimjeon-il/Pando/actions/runs/39003624922) · [원시 artifact #12090580298](https://github.com/kimjeon-il/Pando/actions/runs/39003624922/artifacts/12090580298)

## 조사 대상·재현 및 계측 기준

이전 [OBJ-087](soviet-main-12cycle-memory-2026-10-17.md)은 같은 월로 왕복하는 12회 실험에서 공유 국경선 Worker JS 힙이 현대 시점 약 360MiB로 안정화한다는 사실을 보였지만, 왜 그렇게 큰지 판단하지 못했다. 이번에는 실제 소련 1989-06에서 현대 세계로 복귀하고 공유 국경선 계산 종료 및 추가 18초 무입력 상태를 확인한 다음, 별도 Chromium 컨텍스트에서 참조를 **하나씩 해제**한 뒤 Worker별 CDP GC와 Runtime.getHeapUsage를 반복했다.

- 제품 Worker 원본: [country-shared-boundary-worker.js](https://github.com/kimjeon-il/Pando/blob/e85b3e158d5c02e4aa028283db5b83a1750f4b1a/assets/js/workers/country-shared-boundary-worker.js).
- 내부 소유 구조: [country-shared-boundary-packet.js](https://github.com/kimjeon-il/Pando/blob/e85b3e158d5c02e4aa028283db5b83a1750f4b1a/assets/js/modules/country-shared-boundary-packet.js), [boundary-topology.js](https://github.com/kimjeon-il/Pando/blob/e85b3e158d5c02e4aa028283db5b83a1750f4b1a/assets/js/modules/boundary-topology.js), [boundary-spatial-index.js](https://github.com/kimjeon-il/Pando/blob/e85b3e158d5c02e4aa028283db5b83a1750f4b1a/assets/js/modules/boundary-spatial-index.js).
- 실험은 GitHub Ubuntu 24.04 Chromium, WebGL2/SwiftShader, 1440×900. 실제 제품 코드에 진단용 임시 전역 API를 추가하지 않았으며, **독립된 테스트 컨텍스트 속 기존 Worker의 lexical binding만 변경**했다. 컨텍스트는 매 시나리오 후 폐기한다.
- 참조 제거 후의 V8 used heap 차이이므로 결과는 해당 **조건·순서에서 관측한 해제 효과**다. 정식 Chrome heap snapshot의 dominator/retained size, 객체별 독점 용량, 프로세스 PSS, C++ WASM 실제 힙, GPU VRAM과 동일하지 않다. 공유 참조는 마지막 root가 해제될 때 GC될 수 있다.

## 입력 및 파생 자료의 실제 개수

| 항목 | 현대 세계의 값 |
| --- | ---: |
| 마지막 국가 형상 입력 | 254개 |
| preparedStore에 보유한 준비 국가 형상 | 254개 |
| 양쪽에서 참조가 같은 geometry 객체 | **254/254** |
| 원본 좌표쌍 | **548,454개** |
| 인덱스 대상 원본 선분 | **544,163개** |
| 렌더링용 선분 | **543,386개** |
| 공유 경계 선분 | **68,616개** |
| 국가 간 접촉 관계 | **339건** |

입력 254개 geometry 객체 모두 마지막 메시지와 준비 상태 사이에서 참조를 공유한다. preparedStore는 원본 입력에 대한 단순 복제가 아니라 선분 정보, renderableSegments, 개별 공간 인덱스 및 전체 접촉 관계를 추가로 유지한다.

## 1차: 최상위 retaining root 두 개의 해제 순서

| 독립된 컨텍스트 | 변경 전 Worker JS | 첫 root 해제 후 | 두 root 해제 후 |
| --- | ---: | ---: | ---: |
| latestMessage → boundaryState | 360.05 MiB | 360.04 MiB | **1.20 MiB** |
| boundaryState → latestMessage | 360.05 MiB | 33.16 MiB | **1.20 MiB** |

최상위 root 둘을 모두 없애면 대략 **358.85MiB**가 사라졌다. latestMessage만 먼저 없앨 때 약 0.01MiB만 줄어드는 것은 준비 상태도 같은 원본 geometry 객체를 계속 보유하기 때문이다. 반대로 boundaryState를 먼저 없앨 때 **326.89MiB**가 해제되고, latestMessage를 마지막으로 없앨 때 원본 형상 등 약 **31.96MiB**가 추가로 해제됐다. 따라서 latestMessage의 32MiB를 평상시 독립적인 중복 낭비 32MiB로 오해하면 안 된다.

다시 실행한 [#39003624922](https://github.com/kimjeon-il/Pando/actions/runs/39003624922)에서도 root 순서별 약 358.84~358.86MiB 합계가 재현됐다. 각 실험의 WASM 선형 메모리는 시작부터 종료까지 **57.63MiB로 동일**했으므로 JS 객체 참조 소유권과 WASM의 확장된 선형 버퍼는 분리해서 취급한다.

## 2차: preparedStore 구성요소별 해제 효과

두 독립 컨텍스트 모두 latestMessage를 먼저 해제한 후, 준비 상태의 주요 필드를 서로 다른 순서로 비우고 매 단계 Worker GC를 두 번 요청했다.

| 파생 구조 및 단계 | renderable→spatial→source 순서의 해제량 | source→spatial→renderable 순서의 해제량 |
| --- | ---: | ---: |
| latestMessage | 0.01 MiB | 0.02 MiB |
| 렌더링용 선분 배열(renderableSegments) | **61.32 MiB** | **61.33 MiB** |
| 국가별 공간 인덱스(spatialIndex) | **167.37 MiB** | **190.19 MiB** |
| 인덱스 대상 원본 선분 목록(segments) | **25.47 MiB** | **2.64 MiB** |
| 준비 객체의 feature·geometry 필드 | 3.96 MiB | 3.95 MiB |
| 나머지 boundaryState 전체 해제 | **100.71 MiB** | **100.71 MiB** |
| 최종 전체 GC 해제 효과(360MiB 대비) | **358.84 MiB** | **358.84 MiB** |

**공간 인덱스+원본 선분 목록은 두 순서 모두 약 192.83~192.84MiB**를 점유한다는 해제 기반 증거가 나왔다. 인덱스가 원본 선분 객체를 참조하므로 먼저 제거하는 항목이 그 객체들을 회수할 수 있고, 각 개별 감소량은 합산용 독립 용량이 아니다.

약 **61.3MiB**는 renderableSegments 복제·분할 선분 배열로 해제됐으며 두 순서에서 재현됐다. 마지막 **100.71MiB**는 전체 preparedStore 소유의 추가 정보, 상위 공간 인덱스 및 contacts·edges·원본 geometry 등의 잔여 그래프 전체가 함께 해제된 것이다. **이 100.71MiB를 contacts 단독 사용량이라고 할 수 없다.** 마지막 남은 이 영역은 실제 V8 heap snapshot / closure scope retaining graph가 필요하다.

전체 테스트는 소련→현대 왕복을 포함한 **4개 격리 Chromium 컨텍스트**를 실행하며 두 원본 root 순서 및 두 파생 필드 순서를 검사했다. [Actions #39003624922](https://github.com/kimjeon-il/Pando/actions/runs/39003624922): ESLint·문법 검사 및 실제 Playwright **2/2 성공**, 브라우저 pageerror 없음, WASM 선형 버퍼 불변, 테스트 완료 후 모든 컨텍스트 종료. 전체 Chromium PSS는 Worker JS 힙 감소와 함께 변화하지만 이 효과를 GPU나 개별 Worker PSS로 정량 분배하지 않는다.

## 최적화 우선순위와 구현 시 계약

1. **최우선 — 개별 원본 선분 공간 인덱스 압축(약 193MiB 그룹):** 현재 boundary-spatial-index.js는 각 선분마다 JS Map/Set/격자 문자열 키를 다수 보유한다. 별도 병렬 구현을 늘리지 말고 기존 createBoundarySpatialIndex를 소유자로 유지한 채, 선분 ID/정수형 셀·밀집된 버퍼/typed array를 활용한 표현 변경을 검토한다. 각 선분의 역참조·후보 조회 정확성, 경계 편집 스냅·국가 접촉 계산 동등성 및 접근 시간을 함께 테스트한다.
2. **그다음 — 렌더링용 선분 배열 약 61MiB:** 미리보기/화면 패킷 준비 이후 매번 개별 좌표쌍을 복제해 보유할 필요가 있는지 검증하고, 원본 지오메트리 기반 참조 또는 준비 시점 한정 버퍼 수명으로 축소한다. 단순히 삭제하여 매 프레임 재계산이 증가하지 않도록 pan/zoom 업로드 0 계약을 보존한다.
3. **남은 약 101MiB — 전체 접촉 정보·상위 공간 인덱스·원본 형상:** 실제 Chrome heap snapshot으로 root graph와 detached 이후 잔여 Map/Set/Array의 dominator를 확인한다. contacts만 101MiB라고 추정하여 지우지 않는다.
4. **메모리/속도 공동 회귀:** 현행 main의 동일 소련 1989-06↔현대 12회 왕복, 국가 254개·접촉 339건, 공유 선분 68,616개, 이전 파생 선분 544,163개 입력에 대해 준비시간 중앙값·p95, JS 힙, WASM 선형 메모리, renderer PSS, GPU stroke 재업로드, Worker 작업 큐가 제품 개편 전후 동등하거나 개선되는지 확인한다.

## 범위·판정·후속

- **확인됨:** 현대 세계 공유 국경선 Worker의 약 360MiB JS 힙 중 주요 유지 소유자는 boundaryState; 특히 개별 선분 공간 인덱스+원본 선분의 **약 193MiB**, 렌더링용 선분의 **약 61MiB**가 해제 순서 교차 검증으로 정량 확인됐다.
- **아직 미확인:** 마지막 약 100.71MiB의 독립 객체 retained size, 공간 인덱스 자료구조 압축 시 성능·편집 동등성, WebView2/Android 실기기·물리 GPU 메모리. 실험의 필드 해제는 제품에서 곧바로 적용할 수 있는 안전한 라이프사이클 변경이 아니라 **파괴적인 격리 계측**이다.
- **이번 변경 범위:** 테스트 코드와 CI 워크플로는 이미 존재하는 통합 브랜치에만 반영했고, 본 보고서·색인만 work/objects에 추가한다. 공유 Worker/앱 JS, shared C++/WASM, 제품 main, 지도 자료, 배포·Qt 앱은 변경하지 않았다. 이후 실제 최적화는 별도 작업으로 설계·계측·회귀 검증한다.
