# DEV-085 — 1989년 소련 반복 편집 후 미리보기 Worker 60초 지연 원인

> 보고서 ID: `DEV-085` · 상태: `verified-web-diagnostics` · 지도 반영: `not-applicable` · 색인일: 2026-10-17  
> 원문 최종 수정: 2026-10-17 · 대상: `work/objects` (제품 변경 없음) · 비교: 2026-10-17 `main`  
> 재현·계측 변경: [`0c037818`](https://github.com/kimjeon-il/Pando/commit/0c037818670491ce805d7703f414456e93c8747d)  
> 실측: [Soviet memory attribution Actions #38985221569](https://github.com/kimjeon-il/Pando/actions/runs/38985221569) **성공** · [원시 JSON](https://github.com/kimjeon-il/Pando/actions/runs/38985221569/artifacts/12082554953) (Actions 보관기한 적용)

## 조사 목표와 기준

앞선 [DEV-084](soviet-memory-retention-roundtrip-2026-10-17.md)의 Chromium PSS 30초 유휴 측정에서는 지연된 `project-preview-worker.js`가 여전히 실행 중이었다. 이번에는 실제 Worker의 `key`/`validate`/`build` **요청·응답·종료 시점만** 브라우저 테스트의 `window.Worker` 래퍼로 기록했다. 제품 Worker, C++/WASM, 역사 형상은 수정하지 않았고 메시지의 큰 `entities`/캐시 객체를 진단 로그로 유지하지 않았다.

재현은 기존과 동일하다: 2026-10 현대 → 1989-06 소련 선택 → 해안선 편집 진입·취소 → 2026-10 복귀를 **3회** 반복. 매회 복귀·추가 6초·추가 30초, 마지막 Worker 종료 후 GC 단계도 측정했다. GitHub-hosted Ubuntu Chromium(WebGL2/SwiftShader, 1440×900) 기준이며 Windows WebView2/Android/물리 GPU 실측은 아니다.

## 확정 결과: 장시간 지연은 `build`

| Worker | 객체 수 | 요청별 소요시간 또는 마지막 상태 | 결론 |
| --- | ---: | --- | --- |
| #1 (첫 소련) | 5 | `key` 0.344/0.229/0.455초, `build` 9.642초 | 실제 미리보기 생성 완료 |
| #2 (현대 첫 복귀) | 254 | `key` 0.736/1.088초, `build` 46.367초 진행 후 응답 없음 | 소련 시점 재진입 후 중단 |
| #3 (소련 재진입) | 5 | `key` 0.336초, `validate` 0.553초 | 캐시 재사용·종료 |
| #4 (현대 두 번째 복귀) | 254 | `key` 0.768/1.045초, `build` 47.333초 진행 후 응답 없음 | 소련 시점 재진입 후 중단 |
| #5 (소련 재진입) | 5 | `key` 0.347초, `validate` 0.547초 | 캐시 재사용·종료 |
| #6 (현대 세 번째 복귀) | 254 | `key` 0.726/0.965초, `build` 60.000초 진행 후 응답 없음 | 60초 제한시간 만료·강제 종료 |

시점·작업 기록과 함께 `project-preview-cache.js`의 경고 **`미리보기 Worker 시간 초과`**를 실제 캡처했다. 이 표본에서는 254개 객체의 미리보기가 60초 내 생성되지 않았다. 앞선 65~67초의 Worker 생존시간을 `key` 해시·WASM 초기화 자체의 60초 지연으로 설명하는 것은 틀리며, 병목은 **`build` 요청 내부**에 존재한다. `build` 내부에서 가장 느린 구간은 아직 측정되지 않았으므로 단순화 알고리즘, 검증, 메시, 직렬화 중 특정 함수를 원인으로 확정하지 않는다.

소스상 `project-preview-worker.js`의 `buildCache()`는 `buildTopologyPreview()`→GPU 메시·stroke 준비→공간 블록 생성→무결성 해시·gzip 직렬화 순서다. `project-preview-topology.js`의 토폴로지 생성·`presimplify`·최대 5개 단순화 비율 및 후보당 최대 30회 복구·다각형 검증은 복잡도상 유력한 계측 대상이다. 코드 경로상 후보라는 점과 실제 가장 느린 함수라는 증거는 구분한다.

## Chromium 메모리와 자동저장

- 최종 [#38985221569](https://github.com/kimjeon-il/Pando/actions/runs/38985221569)은 ESLint·단위 3/3·실제 Playwright 1/1 통과. 20개 단계에서 세 번의 편집 취소 정상, 브라우저 pageerror 0, 미리보기 종료 후 나머지 Worker JS/WASM 계측 완전.
- 현대 복귀 약 30초 후 PSS는 각각 **2,760.19 / 2,781.75 / 2,838.32 MiB**. 세 번 모두 미리보기 Worker 실행 중이었다. 세 번째 Worker가 종료된 후 PSS는 **2,342.12 MiB**로 **496.20 MiB 감소**했다. 다만 이 차이는 Worker 단독 PSS가 아니라 Chromium 전체다.
- [DEV-084](soviet-memory-retention-roundtrip-2026-10-17.md)의 원시 자동저장 기록에서는 이 편집 취소·시점 왕복 3회 중 `pandolab-autosave-full` **6건**, 저장 소요시간 합계 **18.36초**(1회 평균 3.06초)를 확인했다. 편집 확정 없이 시점만 왕복하면서 무거운 저장·미리보기 작업이 발생하는 이전 구현의 비용이다.
- 반복 현대 복귀 시 공유 국경선 Worker JS는 약 **360MiB**에서 안정화됐고, WASM 선형 버퍼 확장분 약 **41.6MiB**는 이후 유지됐다. 이는 여전히 높은 기본 보유량이지만 이 3회 실행만으로 지속 증가 누수라는 결론은 내릴 수 없다.

## 현재 `main`과 다른 점 — 중복 최적화 금지

| 경로 | `work/objects` 조사 기준 | 현재 `main` 검증된 구현 |
| --- | --- | --- |
| `persistence-service.js` | 시점 변경에 따라 전체 저장 및 `previewCache.schedule()` 반복 | Core 내용 체크포인트·프로젝트 세대·기준 자료가 같으면 미리보기 재예약 생략, 시점 기록은 별도 경량 저장 |
| `project-preview-cache.js` | `inspectImport`/`buildAutosave`/Worker `key` 검사 중복 가능 | 저장 영수증·키·기준 시점 재사용, 중복 Core 조회와 Worker 전송 최소화 |
| `project-preview-worker.js` | `key`/`validate`에도 무거운 토폴로지 모듈·WASM 즉시 초기화 | 실제 `build`에서만 무거운 모듈·WASM 로드 |

이는 코드의 SHA 차이와 검증 기록에 근거한다. 통합 브랜치에서 성공한 [경량 시점 저장 #38915062092](https://github.com/kimjeon-il/Pando/actions/runs/38915062092)에서는 소련 시점만 변경했을 때 전체 자동저장 **0회**, 실제 속성 수정 뒤 정상 저장·재열기를 확인했다. [반복 편집 메모리 검증 #38912494140](https://github.com/kimjeon-il/Pando/actions/runs/38912494140)에서도 3회 편집·취소 및 왕복에 전체 자동저장 **0회**, 미리보기 Worker 관측 **0개**였다. 해당 테스트에서 사용한 네 개 관련 주요 소스 파일의 SHA는 현재 `main`의 것과 일치한다.

단, 기존 두 분기의 실험은 시점 이동 순서·캐시 상태·GC·측정 시점이 동일한 **A/B 메모리 벤치마크가 아니다**. PSS 절대차를 개선율로 보고하지 않는다. `main`은 더 최신 통합/배포 대상이며, 위의 이미 완료된 저장·미리보기 중복 제거를 `work/objects`에 별도 재구현하지 않는다.

## 다음 독립 조사와 완료 기준

1. **현행 main 기준 10회 이상 메모리 수렴성**: 시점 왕복만 할 때 전체 저장 0, 미리보기 Worker 미생성 유지, 마지막 작업 종료 후 공유 국경선·편집 Worker JS/WASM 및 Chromium PSS 중앙값·추세 계측. 결과 검증 전까지 장기 누수 부재를 단정하지 않는다.
2. **실제 내용 수정 후 미리보기 `build` 분해**: `topology` / `presimplify` / 후보 복구·검증 / 메시·stroke / 캐시 직렬화의 시간·중간 힙·좌표 수 기록. `build` 60초 시간 초과가 현대 세계의 실제 콘텐츠 변경에서도 재현되는지 먼저 확인하고 의미 없는 60초 대기·불필요한 큰 사본은 줄인다.
3. **상주 Worker 메모리**: 공유 국경선 `latestMessage`·`preparedStore`·contacts의 실제 retained size, 편집 Worker 경계 준비 캐시와 원본 형상 참조 중복을 분리한다. 최신 통합 메모리 검증에서 소련 편집 준비 캐시는 약 **46.5MB**로, 기본 **32MiB** 예산보다 큰 단일 항목 1개를 남기는 정책이었다. 유휴 즉시 폐기와 반복 편집 재사용 비용을 비교해야 한다.
4. **GPU stroke**: 96MiB 예산 내 기존 자원 누적을 active/protected/inactive로 분리한 뒤 실제 VRAM과 혼동하지 않고 평가한다.

## 범위 및 판정

이번 변경은 `tests/browser/soviet-memory-attribution.spec.mjs`의 테스트 전용 Worker 전송 추적과 보고서·색인뿐이다. Qt 앱, 제품 JS, Core C++/WASM, 지도 원본, `main` 및 배포판은 수정하지 않았다. **결론:** 과거 브랜치의 반복 고메모리 Worker는 실제 `build` 미완료와 60초 제한시간에 직접 연결된다. 현재 통합본에서는 동일한 시점-only 재생성을 막는 최적화가 이미 검증돼 있으므로, 다음 메모리 조사의 1순위는 현행 코드의 *실제 수정 이후 미리보기 생성 비용*과 *공유 국경선 상주 메모리*다.
