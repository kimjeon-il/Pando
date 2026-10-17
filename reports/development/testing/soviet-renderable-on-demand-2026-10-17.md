# OBJ-090 — 공유 국경선 렌더링 선분 지연 생성 및 Worker 메모리 A/B

> 2026-10-17 · 상태: verified-web-paired-and-12cycle · 지도 반영: not-applicable
> 변경 전 기준 제품: `main` `6b0c501dd09029ef237e90c1ef55fdb82bdf315f` (OBJ-089 packed source index 적용)
> 변경 브랜치: `work/perf-renderable-on-demand-20261017` · 제품 변경: **3개 JavaScript 모듈**, 원본 GIS/역사 경계·C++/WASM 변경 없음
> 실측: [동일 러너 A/B #39030467405](https://github.com/kimjeon-il/Pando/actions/runs/39030467405) · [지리/접촉/편집 집중 검증 #39030167527](https://github.com/kimjeon-il/Pando/actions/runs/39030167527)

## 1. 원인과 변경된 소유 경계

과거 [OBJ-088](soviet-shared-border-retained-owners-2026-10-17.md)에서는 현대 공유 경계 Worker의
`preparedStore.values()[].renderableSegments`를 별도로 제거할 때 JS 힙 약 **61.32MiB**가 해제되는 것이 관측됐다.
원래 `prepareBoundaryFeature()`는 모든 254개 국가에 대해
`buildRenderableBoundarySegments(feature.geometry)`를 호출하고,
총 약 **543,386개**의 렌더링용 선분을 중첩 JS 배열 형태로 상시 보유했다.

실제 유일한 제품 소비 경로는 `prepareCountrySharedBoundaryPacket()`의
**상위 국가(root) 외곽선 차감**이다. 단순 카메라 pan/zoom에는 국가별 전 선분 배열이 필요하지 않다.

- `geographic-boundary.js`: 기존 `appendGeometry/appendEdge`의 정본을 그대로 사용해
  `forEachRenderableBoundarySegment()` 방문 방식 추가. 지구 날짜변경선 분할, 인공 극점, 폐곡선·구멍 처리 변경 없음.
- `boundary-topology.js`: 국가 준비 객체에 **지연 iterable/view**만 유지.
  필요 시 `length`와 레거시 iteration 제공. 500k개 배열을 생성해 보관하지 않는다.
- `country-shared-boundary-packet.js`: 외곽선이 실제 필요한 root에 대해서만
  선분을 방문하여 기존 `pendingOutlines`에 전달하고 **같은 C++ 클리핑** 실행.
  스트리밍은 GPU 카메라 이동에서 호출하지 않으며 기존 준비된 패킷은 그대로 재사용한다.

레거시 view를 직접 iteration하면 임시 배열을 만들 수는 있으나,
실제 Worker 패킷 경로는 **streaming visitor**를 사용하여 그 전체 배열을 거치지 않는다.
렌더러의 클리핑 작업에 필요한 `pendingOutlines`의 일시적 작업 메모리는 이번 최적화 범위에 남는다.

## 2. 단일 러너, 동일 현대 세계 A/B

동일 GitHub Actions Ubuntu 24.04 Chromium WebGL2 SwiftShader, 화면 1440×900,
`1989-06` 소련 → `2026-10` 현대 복귀, 공유 국경선 계산·유휴·CDP Worker GC를 거쳐 비교.
변경 전 `6b0c501`, 변경 후 측정 소스 `677875626`.
두 브라우저 시나리오 1/1씩 성공했고 입력/접촉 동일성 검사도 성공했다.

| 지표 | 변경 전 | 지연 생성 후 | 차이 |
| --- | ---: | ---: | ---: |
| 공유 국경선 Worker JS used heap | **194.67MiB** | **133.41MiB** | **−61.26MiB, −31.47%** |
| 해당 Worker WASM 선형 메모리 | 57.63MiB | 57.63MiB | 0 |
| 전체 Worker WASM 선형 메모리 | 403.50MiB | 403.50MiB | 0 |
| Chromium 전체 PSS | 1852.20MiB | 1802.96MiB | −49.24MiB |
| 소련 시점 준비 | 3641ms | 3997ms | +356ms |
| 현대 복귀 | 3276ms | 1667ms | −1609ms |

원본 입력 **254국가·544,163 source segment·68,616 shared segment·339 contact**,
압축 국가 인덱스 **194개**, 원본 compressed source segment **540,989개**, postings **562,927개**,
준비 횟수 `513` 및 WASM 선형 메모리가 일치한다.

같은 러너 한 쌍의 Worker별 V8 used heap 감소는 직접 관측이지만, Chromium PSS는 **전체 프로세스 합계**이고
각 Worker의 고유 PSS가 아니다. 브라우저 시작·캐시·GC 편차가 있으므로 PSS −49.24MiB를
모두 이 변경의 독립 효과라고 주장하지 않는다. CPU 시간값도 한 쌍의 관측으로 p95 개선을 입증하지 않는다.
앞선 첫 A/B에서도 Worker JS 194.68→133.41MiB가 재현됐지만
전체 Worker WASM이 403.5→387.5MiB로 달라져, **전체 Worker WASM 동일성**을 요구하던 CI 계약은
잘못된 비교였다. 수정된 두 번째 A/B에서는 403.5MiB로 같았으며 검증 성공.

## 3. 기능 검증·제외 범위

- [기본 단위/실제 국가 접촉·편집 #39030167527](https://github.com/kimjeon-il/Pando/actions/runs/39030167527) 성공:
  새 지리 streaming 계약 3건 및 원본 C++ 접촉/경계 수정 테스트.
- 과거 일반 GIS unit은 `INVALID_POLYGON_RING` 부정 입력에서
  오류 결과에 `PL-WORKER-RPC-OPERATION` 코드 필드가 추가되는 기존 불일치가 있다.
  **변경 전 main `6b0c501`의 GIS 테스트를 별도 실행해 동일 실패임을 증명**;
  제품 렌더링 스트리밍의 회귀로 판정하지 않는다.
- [P2 #39030020066](https://github.com/kimjeon-il/Pando/actions/runs/39030020066) 소스 일치 생성물 게시 성공.
  지도/역사/메시/공유 국경선 정적 출력 **10개 계열의 출력 지문 동일**, 빌드 메타데이터만 갱신.
- [P3 #39030020172](https://github.com/kimjeon-il/Pando/actions/runs/39030020172) Web 회귀 성공.
- 대상은 **웹 WebGL2/Chromium**이며 Windows WebView2 메모리, Android 실기기 및 Qt 렌더러는 검증하지 않았다.
  GPU Stroke의 앱 추적 버퍼는 실제 GPU VRAM과 동일하지 않다.

## 4. 최종 장기 게이트 및 다음 조사

[12회 소련↔현대 왕복과 단순 지도 이동 GPU 재사용 검사](https://github.com/kimjeon-il/Pando/actions/runs/39030316892) **전체 성공**.

| 동일 세계 현대 복귀·Worker GC 후 지표 | 초반 4회 중앙값 | 후반 4회 중앙값 | 변화 |
| --- | ---: | ---: | ---: |
| 공유 국경선 Worker JS | 133.55MiB | 133.59MiB | +0.04MiB |
| 전체 Worker JS | 188.18MiB | 188.28MiB | +0.10MiB |
| 전체 Worker WASM 선형 | 403.50MiB | 403.50MiB | 0 |
| GPU Stroke 앱 추적 버퍼 | 29.03MiB | 41.32MiB | +12.29MiB (이후 수렴) |

현대 복귀 **12/12회**, 유휴 판정 **12/12회** 완료. 마지막 30초 유휴 후 공유 국경선 Worker
**133.60MiB**, Chromium PSS **1,831.82MiB**. 페이지 오류 0건, 전체 자동저장 0회,
미리보기 Worker 0개, 국경선 Worker WASM **57.63MiB** 유지였다.
일부 회차에서는 시스템 전체 PSS가 1,970~1,999MiB까지 상승했다가 다음 회차에 내려갔으므로
이를 독립적인 Worker JS 누수나 GPU VRAM 사용량으로 분류하지 않는다.

같은 게이트에서 **1989년 소련 선택 후 카메라만 이동**시켰을 때 GPU Stroke buildCount **9→9**,
GPU Stroke 업로드 **16,030,056→16,030,056바이트**, 폴리곤 GPU 빌드 **33→33**,
공유 국경선 requestId **3→3**으로 불변이었다.
즉 일반 pan에서 새 선분을 생성하거나 GPU로 재업로드하는 회귀는 관측되지 않았다.

본 작업은 61MiB 렌더링용 선분 유지 영역을 정리했으며,
다음 단계는 [OBJ-088](soviet-shared-border-retained-owners-2026-10-17.md)의
**잔여 약 100.71MiB**를 실제 메모리 스냅샷과 소유 객체 그래프로 분해하는 작업이다.
기존 `latestMessage`와 준비 형상의 공유 참조를 중복 allocation으로 오판하지 않는다.
