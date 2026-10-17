# OBJ-095 — 장기 보유 공유 국경 원본 선분의 링 메타데이터 압축

> 조사·구현: 2026-10-17 · 상태: `verified-web-paired-and-12cycle` · 지도·GIS 원본 데이터 수정: 없음
> baseline: `work/perf-contact-wire-lifetime-20261017` `0059af35094609390d8ce03f76339e5ef8c27948` (OBJ-094)
> candidate: `work/perf-source-row-owners-20261017`, 제품 소스: `assets/js/modules/boundary-topology.js`, `assets/js/modules/country-contact-core.js`
> CI: [68개 집중 테스트 + 동일 러너 Worker 메모리 A/B #39038555583](https://github.com/kimjeon-il/Pando/actions/runs/39038555583) · [실제 인접 국가 CPU A/B #39038607376](https://github.com/kimjeon-il/Pando/actions/runs/39038607376) · [12회 왕복 및 순수 pan #39038672944](https://github.com/kimjeon-il/Pando/actions/runs/39038672944)

## 목표, 실제 소유권, 변경하지 않은 것

[OBJ-093](soviet-prepared-source-owners-2026-10-17.md)에서 독립 Chromium 3개의
GC 해제 순서를 교차했을 때 국가별 source-row 객체 배열과 per-country index의
**합산** 해제 효과가 약 27.48~27.49MiB였다.
이는 모두 중복 낭비된 객체 바이트가 아니라, 실제 source-ref / 편집 후보 조회에 필요한
행 객체와 공간 인덱스 참조가 공유하는 retained graph다. OBJ-094는 별도의
C++ 변환 배열 상주 약 23.8MiB를 이미 제거한 기준이다.

`prepareBoundaryFeature()`가 보유하는 source edge 각각은 원래
`featureId`, `polygonIndex`, `ringIndex`, `segmentIndex`,
`endVertexIndex`, `a`, `b`, `interiorSide` 필드를 갖는 JS 객체였다.
동일 원본 폴리곤 링에 속하는 선분들은 첫 세 메타데이터와 `interiorSide`를
**완전히 공유**하며, `a`, `b`는 이미 원본 geometry의 좌표 배열을 가리킨다.

이번 후보는 공유 국경선 Worker 준비 경로만
`boundarySourceSegments(feature, 0, { compactPrepared: true })`를 사용한다.
각 링에 `{featureId,polygonIndex,ringIndex,interiorSide}` 메타데이터
prototype 객체를 **한 번** 생성하고, 개별 원본 source row에는
`{segmentIndex,endVertexIndex,a,b}`만 직접 보관한다.
좌표·날짜변경선·극점·원본 ring 순서·경계 내부 방향·원본 source object identity는
입력 소스 그대로이다. 다른 편집 Worker가 호출하는
`boundarySourceSegments(feature)`의 8개 필드가 모두 직접 포함된
기존 객체 형태를 **변경하지 않는다**.

후속 계산 또는 C++ source-ref가 독립적으로 살아야 할 때는
`country-contact-core.js`와 `buildBoundaryTopologyFromSegments()`가
상속된 메타데이터를 가진 새 완전한 스냅샷을 만든다.
캐시에서 원본 참조를 다시 연결하는 경우에는 기존 source row의
**동일한** 참조를 유지하며, 렌더 패킷에 Worker source refs를 복제하지 않는다.
`createBoundarySpatialIndex().loadPacked()`의 TypedArray 구조,
현대 세계 원본 geometry, 원본 경계 자료, C++/WASM ABI를 수정하지 않았다.

## 집중 기능 계약

[CI #39038555583](https://github.com/kimjeon-il/Pando/actions/runs/39038555583)의
집중 Node 계약 검증 **68/68, 실패 0**.
신규 계약 3건은 MultiPolygon·hole·날짜변경선 및 링별 source metadata 공유,
원본 a/b 배열 참조와 인덱스 조회의 객체 identity,
C++ 접촉 출력의 자기 소유 source-ref 스냅샷을 검증한다.
기존 계약은 국가 접촉/C++-JS 동등성, source-ref 정렬, 캐시 seed,
정적/동적 인덱스, patch/replace, 경계 편집 결과를 포함한다.

## 동일 러너 현대 복귀 메모리 A/B

Ubuntu 24.04 Chromium 151 WebGL2/SwiftShader, 1440×900,
1989-06 소련 → 2026-10 현대 복귀 후 Worker idle 및 CDP GC 두 차례.
baseline OBJ-094 `0059af35`, candidate 제품 `8fafe62d`.

| 지표 | baseline | compact | 차이 |
| --- | ---: | ---: | ---: |
| 공유 국경 Worker V8 used heap | **103.58MiB** | **96.68MiB** | **−6.90MiB (−6.7%)** |
| 해당 Worker WASM 선형 메모리 | 57.63MiB | 57.63MiB | 0 |
| 전체 Worker WASM 선형 메모리 | 403.5MiB | 403.5MiB | 0 |
| Chromium 전체 PSS | 1752.85MiB | 1750.09MiB | −2.76MiB (통계적 귀속 불가) |
| 국가 / source rows | 254 / 544,163 | 254 / 544,163 | 0 |
| 공유 edge / contact | 68,616 / 339 | 68,616 / 339 | 0 |
| packed 국가 인덱스 / postings | 194 / 562,927 | 194 / 562,927 | 0 |
| 준비 횟수 | 513 | 513 | 0 |

Worker V8 used heap 감소는 동일 runner, 같은 소스 입력, 같은 Worker 및 GC
조건의 직접 관측값이며 PSS는 여러 Chromium 프로세스를 포함한다.
`toModernMs`는 5366→125ms로 실행 간 초기 준비/비동기 캐시
타이밍 편차가 매우 커서 이 변경의 CPU 속도 향상이라고 주장하지 않는다.

## 실제 국경 접촉 CPU

같은 환경에서 **러시아–중국** 쌍의 원본 source rows **50,594개**,
공유 선분 **1,369개**, source-ref **2,738개**를 확인하고 동일 쌍으로
다섯 번씩 C++ 접촉을 반복했다.

| 지표 | baseline | compact |
| --- | ---: | ---: |
| 반복 호출 중앙값 | 472.8ms | 495.1ms |
| 변경 | — | +22.3ms (**+4.7%**) |
| 출력 접촉 / source refs | 1,369 / 2,738 | 1,369 / 2,738 |

한 쌍/다섯 번의 결과로 Windows WebView2, 여러 국가를 동시에 수정하는
실제 UX p95를 확정하지 않는다. CPU 증가의 일부가 브라우저/GC 편차인지
prototype 기반 조회 비용인지는 추가 계측해야 한다.
그럼에도 이번 단계의 직접 목적인 **V8 보유량 6.90MiB 절감 및 결과 동등성**은
확인됐다.

## 미완료 및 다음 단계

[12회 왕복 및 순수 pan 게이트 #39038672944](https://github.com/kimjeon-il/Pando/actions/runs/39038672944)가
**모두 성공**했다. 실제 소련 선택 및 현대 복귀 **12/12회**,
완전한 유휴 Worker 샘플 **12/12회**, 페이지 오류 0건,
전체 자동저장 증가 0회, 미리보기 Worker 0개였다.

| Worker / 브라우저 계측 | 초반 4회 현대 복귀 중앙값 | 후반 4회 중앙값 |
| --- | ---: | ---: |
| 공유 국경 Worker V8 JS | 113.22MiB | **96.84MiB** |
| 전체 Worker JS | 167.83MiB | 151.52MiB |
| 전체 Worker WASM 선형 | 403.50MiB | 403.50MiB |
| Chromium 전체 PSS | 1823.28MiB | 1821.50MiB |

마지막 **30초 유휴 + GC**에서 공유 국경 Worker V8 **96.84MiB**,
전체 Chromium PSS **1805.45MiB**가 기록됐다.
중간 시점의 Worker V8이 약 96.8/129.7MiB로 오가는 양상은
GC·Worker 유지 시점의 차이에 부합하며, 이 12회에서 단조 증가 JS 누수
근거는 없었다. PSS는 여러 Chromium 프로세스를 포함하며
독립적인 공유 국경 Worker 물리 RAM이 아니다.

실제 1989년 소련 선택 후 순수 카메라 이동에서 Stroke GPU
buildCount **9→9**, 업로드 **16,030,056→16,030,056B**,
폴리곤 GPU buildCount **33→33**, 공유 경계 requestId **3→3**으로
불변이었다. 순수 pan에 의한 버퍼 추가 업로드 **0B**.

[일반 P3 검증 #39038555574](https://github.com/kimjeon-il/Pando/actions/runs/39038555574)는
통과했다. [이전 P2 #39038555571](https://github.com/kimjeon-il/Pando/actions/runs/39038555571)은
테스트 실패가 아니라, 병렬 보고서/CI 커밋으로 작업 브랜치 HEAD가 이동해
게시 전 안전 가드 `P2_REMOTE_BRANCH_CHANGED`가 적용되어 중단됐다.
최종 제품 브랜치 헤드가 고정된 뒤 P2 소스 일치 생성물 게시를
별도 확인해야 한다. `main` 병합은 아직 실행하지 않았다.

추가 압축은 `endVertexIndex`를 링 길이에서 도출하거나
source row 자체를 더 느슨한 자료구조로 바꾸는 방향이 가능하지만,
**C++ source-ref 정체성과 편집 후보 조회 성능**을 훼손할 수 있다.
기존 GC의 27.5MiB 전체를 즉시 회수 가능한 예산으로 간주하지 않는다.
