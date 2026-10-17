# OBJ-094 — C++ 공유 국경 접촉 변환 배열의 수명 단축

> 2026-10-17 · 상태: `verified-focused-paired-and-12cycle` · 지도 반영: `not-applicable`
> 기준 제품: `work/perf-singleton-edges-20261017` `f2370babfccf3dd07dca26f11aeecab4434189ca` (OBJ-092)
> 적용 브랜치: `work/perf-contact-wire-lifetime-20261017` · 제품 수정: **`assets/js/modules/country-contact-core.js` 한 파일**
> 근거: [OBJ-093 독립 3회 GC 진단](soviet-prepared-source-owners-2026-10-17.md)
> 실측: [동일 러너 A/B #39037593995](https://github.com/kimjeon-il/Pando/actions/runs/39037593995) · [12회 왕복 및 GPU pan #39037223209](https://github.com/kimjeon-il/Pando/actions/runs/39037223209)
> 지도/역사 원본 형상, 편집 규칙, C++/WASM, `main` 미수정

## 1. 정확한 최적화 지점

OBJ-093에서 현재 현대 세계 254개 국가의 `preparedStore`와 상위 공간 인덱스를 분리했다.
중복된 국가 source segment **544,163개**를 인덱스가 별도로 복제하는 것은 아니다.
반면 `country-contact-core.js`의 `wireRows: WeakMap`은 준비 객체 251개에 대한
변환 배열 **519,900개**를 C++ batch 호출 이후에도 Worker 메모리에 유지했다.
이는 세 독립 Chromium 컨텍스트의 파괴적 GC 해제 실험에서 모두
Worker V8 used heap **23.81MiB** 감소로 관측된 명확한 후보였다.

제품 수정은 `encodedRows(prepared)`를 **현재 동기 C++ contact batch 호출에서만**
필요한 배열을 만드는 함수로 단순화하고 Worker 수명 전체에서 `WeakMap`을
유지하지 않게 하는 것이다. `computeCountrySharedContacts`는 호출 안의
고유 `features` 배열을 통해 각 prepared 객체를 **한 번만** 인코딩하므로
한 번의 C++ 호출에서 같은 선분을 반복 인코딩하지 않는다.
다음 별도 호출 때는 해당 변환을 다시 수행한다.

`prepared.segments`, 원본 좌표 `a/b`, 국가별 packed 공간 인덱스와 상위 국가
인덱스, source refs의 객체 정체성, 날짜변경선/극점/다중 기여 계산, C++ ABI는
기존 그대로다. 이는 과거 결과 캐시의 상주 메모리 절감이며
`geometry` 중복 복제를 삭제한 것이 아니다.

## 2. 동일 러너 제품 A/B: 실제 소련 1989-06 → 현대 복귀

Ubuntu 24.04 Chromium(WebGL2/SwiftShader) 1440×900에서 Worker idle 후 CDP GC
두 회 실행. baseline OBJ-092 `f2370bab`와 후보 `6664d9da`를
동일한 입력과 테스트 코드로 비교했다.

| 지표 | baseline | 후보 | 차이 |
| --- | ---: | ---: | ---: |
| 공유 국경선 Worker V8 used heap | **127.37MiB** | **103.57MiB** | **−23.80MiB (−18.7%)** |
| 해당 Worker WASM 선형 버퍼 | 57.63MiB | 57.63MiB | 0 |
| 세계 국가 수 | 254 | 254 | 0 |
| 국가 원본 source segment | 544,163 | 544,163 | 0 |
| 공유 edge / 접촉 | 68,616 / 339 | 68,616 / 339 | 0 |
| 압축 국가 인덱스 / 포스팅 | 194 / 562,927 | 194 / 562,927 | 0 |
| 전체 Chromium PSS | 1707.18MiB | 1744.85MiB | +37.67MiB, 별도 계층 |

전체 Worker WASM은 **baseline 387.5MiB / 후보 403.5MiB**로
옵션 Worker의 존재 여부가 달랐다. 따라서 전체 Worker JS 합계나 PSS 증가를
이번 국경 Worker 캐시 변경에 독립 귀속하지 않는다.
동일 러너 다른 실행 [#39037083422](https://github.com/kimjeon-il/Pando/actions/runs/39037083422)의
개별 브라우저 검사에서도 공유 국경 Worker JS **127.38→103.56MiB**가
재현됐으나, 첫 비교 취합은 Playwright 출력 폴더 정리로 실패했다.
최종 성공 CI에서는 측정 JSON을 각 실행 직후 독립 위치에 복사해 이를 수정했다.
두 실행의 현대 복귀 밀리초는 준비·캐시 타이밍 편차가 커서
그 차이를 제품 CPU 시간 개선률로 간주하지 않는다.

## 3. 실제 인접 국가의 반복 C++ 계산 CPU

동일 Worker 현대 세계 준비 후 **러시아(RUS)–중국(CHN)** 원본 source row
**50,594개**를 입력하여 실제 공유 경계 **1,369개, refs 2,738개**를 계산했다.
준비 이후 같은 쌍을 각각 다섯 차례 재계산했다.

| 항목 | baseline `WeakMap` 유지 | 후보 batch 수명 |
| --- | ---: | ---: |
| 5회 반복 계산 중앙값 | **515.4ms** | **520.4ms** |
| 차이 | | **+5.0ms (약 +1.0%)** |
| 공유 경계 수 | 1,369 | 1,369 |
| source refs | 2,738 | 2,738 |

첫 캐시 준비 274.3ms/276.6ms를 별도 기록했다.
5회 샘플의 편차가 있어 +5.0ms를 확정적 성능 저하로 단정하지 않는다.
일반 사용자의 마우스 편집 p95, 여러 소스 국가 동시 수정, 실제
Windows WebView2 체감 지연은 이번 단일 국가쌍 실험의 범위가 아니다.

[집중 A/B #39037593995](https://github.com/kimjeon-il/Pando/actions/runs/39037593995)는
동일 경계 입력·WASM·C++ 접촉/편집 단위 검증과 네 번의 Chromium 시나리오
(전후 메모리 및 전후 CPU) 모두 성공했다.

## 4. 12회 시간대 왕복 및 GPU 리소스

[장기 게이트 #39037223209](https://github.com/kimjeon-il/Pando/actions/runs/39037223209)
성공: 현대 복귀 **12/12**, 결측/페이지 오류 0, 전체 자동저장 증가 0,
미리보기 Worker 0. 각 완료 구간은 Worker 대기 작업 종료 후 측정했다.

| 주요 지표 | 초반 4회 중앙값 | 후반 4회 중앙값 | 변화 |
| --- | ---: | ---: | ---: |
| 공유 국경선 Worker JS | 136.58MiB | 136.63MiB | +0.05MiB |
| 전체 Worker JS | 147.41MiB | 147.47MiB | +0.06MiB |
| 전체 Worker WASM 선형 | 387.5MiB | 387.5MiB | 0 |

마지막 추가 **30초 유휴+GC** 후 공유 국경선 Worker JS **103.74MiB**,
전체 Chromium PSS **1746.47MiB**였다. 매회 복귀 직후의 136MiB와
최종 유휴 103MiB는 다른 GC·유휴 기준이며 상호 모순이 아니다.
현재 시나리오에서 Worker JS의 단조 증가 누수는 관측되지 않았다.

1989년 소련 선택 후 순수 pan에서 GPU Stroke buildCount **9→9**,
GPU Stroke upload bytes **16,030,056→16,030,056**,
폴리곤 GPU 빌드 **33→33**, 공유 경계 requestId **3→3**으로
불변이었다. 즉 카메라만 이동했을 때 추가 GPU 업로드는 0B.

## 5. 최종 판정 및 한계

**웹 Chromium 대상 집중 검증 합격.** Worker V8의 불필요한 C++ wire 배열 상주
약 23.8MiB를 제거하면서 원본 도형 참조·인덱스·접촉 결과 계약을 보존했다.
동일 소스 P2 생성물 검증과 P3 Web 회귀는
[검증 #39036773858](https://github.com/kimjeon-il/Pando/actions/runs/39036773858) 및
[검증 #39036773861](https://github.com/kimjeon-il/Pando/actions/runs/39036773861)에
각각 성공했다. 그 뒤의 커밋은 진단·워크플로·보고서 정리이며 제품 계산 코드는 동일하다.

향후 대형 실제 **편집 패치** 반복 시 원본을 변환하는 CPU 구간을
추가 계측할 가치가 있다. 실제 Windows WebView2, Android 실기기 및 물리 GPU
VRAM은 이번 검증 범위가 아니다. Qt 렌더러는 대상에서 제외한다.
`main` 병합은 별도 확인 이후 진행하며 현재 완료 보고에 포함하지 않는다.
