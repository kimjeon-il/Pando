# PERF-P0-001 — Pando 기준 코드와 기존 성능 계측 통합 조사

> 2026-10-17 · 상태: verified-focused-ci-and-one-return · 지도 반영: not-applicable
> 범위: 현재 웹 Pando, 객체/시점 C++·WASM, Worker V8/WASM, Chromium PSS, GPU 추적치 및 Windows WebView2 기존 증거
> 검토 시점의 `main` 및 `work/objects`: **`2279b94f0713f08070a0c5e146be5566de35fc45` (ahead=0 / behind=0)**

## 판정

**객체 브랜치의 유효한 제품 개선을 다시 cherry-pick/merge할 필요 없음.** 두 브랜치는 같은 Git 객체를 가리키며, 다음 변경은 이미 기준 `main`에 포함된다.

- OBJ-083: C++ `DocumentSession::setTimelineCursor` 세계 해석 3회 중복을 결과 재사용으로 줄임. 원본 WASM과 동일 소스에서 생성한 바이너리·JS 런타임에 반영. 기존 `objects-cursor-focused-acceptance.yml` 집중 C++ 1/1, JS 29/29, WASM 9/9 및 브라우저 검사 증거 보존.
- 저장 최적화: 시점 변경은 별도 `active-view` 저장, 전체 프로젝트 autosave를 증가시키지 않음. 월·문서 revision·checkpoint·Undo 분리 계약 유지.
- OBJ-088/089: 역사 세계의 공유 국경선 Worker 메모리 원인 분해 및 `createBoundarySpatialIndex()` 압축. JS used heap 360.06→194.68MiB (−165.38MiB), 전체 Chromium PSS 2007.59→1841.82MiB (−165.77MiB) 한 쌍의 실측. 동일한 현대 세계 254개, 원본 선분 544163개, 공유 선분 68616개, 접촉 339건 보존.
- 12회 왕복 검사: 공유 국경 Worker JS 초반4회 227.74MiB, 후반4회 227.75MiB (중앙값). 마지막 추가 30초 유휴 시 194.87MiB. 동일 12회에서 Worker WASM 선형 버퍼 387.5MiB 유지, 전체 autosave 0. 추적된 Stroke 버퍼 수치는 GPU VRAM이 아님.

참조: [OBJ-083](objects-timeline-cursor-reuse-2026-10-17.md) · [OBJ-088](soviet-shared-border-retained-owners-2026-10-17.md) · [OBJ-089](boundary-spatial-index-packed-2026-10-17.md).

## 기존 테스트 자산의 소유권

| 목적 | 현행 정본 | 운영 판단 |
| --- | --- | --- |
| C++/WASM 시점 계산·Undo/저장 | `tests/unit/core-document-runtime.test.mjs`, `tests/browser/temporal-editing.spec.mjs`, `tests/browser/historical-world-timeline.spec.mjs`; `objects-cursor-focused-acceptance.yml` | **유지**. 이미 동일 코드에 통합. 해당 C++ 변경 시 동등성 검사 |
| Worker JS/WASM 및 시스템 PSS 측정 | `tests/browser/helpers/soviet-memory-attribution.mjs`, `tests/unit/soviet-memory-attribution.test.mjs` | **공유 계측 정본**. 다른 Worker 메모리 측정기 추가하지 않음 |
| 공유 국경 인덱스/접촉 정확성 | `tests/unit/boundary-spatial-index-packed.test.mjs`, `tests/unit/country-shared-boundary-state.test.mjs`, `tests/unit/country-contact-legacy-parity.test.mjs` | **유지**. 검색 결과 순서/원본 참조와 증분 편집 |
| 소련 1회 현대 복귀 메모리 | `tests/browser/soviet-boundary-index-packed-memory.spec.mjs` | **유지**. 두 GC 이후의 Worker 메모리·PSS, 형상 개수 검사 |
| 12회 왕복 메모리 | `tests/browser/soviet-main-long-cycle.spec.mjs` | **유지**. 진정한 idle 표본만 중앙값·최종 30초 유휴를 별도 보고 |
| Worker retaining-root 해제 | `tests/browser/soviet-shared-border-heap-owners.spec.mjs` | **격리 진단 전용**. 내부 참조를 파괴하므로 일반 회귀 게이트로 실행하지 않음 |
| GPU pan/upload 계약 | `tests/browser/performance-observability.spec.mjs`, `soviet-pan-gpu-regression.yml` | **유지**. 이동만으로 GPU buffer 재업로드 0 계약 |
| 시점 경량 저장 | `tests/browser/soviet-lightweight-timeline.spec.mjs`, `timeline-lightweight-regression.yml` | **유지**. 내용 변경/시점 변경 분리 |
| Windows WebView2 초기화 | `integration-windows-startup-memory-ab-20261016.yml` | **별도 계층**. Windows PSS·초기화시간은 Linux Chromium 수치와 직접 비교 금지 |
| 초기 P9 탐색 성능 | `tests/browser/p9-browser-performance.spec.mjs` | **역사 기준**. pre-P6 `8e229826`와의 비교이고 기본 시나리오 Worker/WASM 메모리를 포함하지 않음 |

## 발견한 계측 운영 위험

1. `soviet-main-long-cycle-memory.yml`, `soviet-shared-border-heap-owners.yml`의 실행 경로는 원래 **`e85b3e1`** 제품 소스를 핀하고 그 밖의 파일 차이를 거부한다. 이미 공간 인덱스가 통합된 현재 `main`에서 그대로 실행하면 인위적인 실패가 발생할 수 있다. 이 워크플로의 역사 결과는 보존하되, 현재 제품의 통과 여부는 `boundary-spatial-packed-long-cycle.yml` 및 신규 공통 증거 계약에서 판정한다. 구 워크플로의 개별 재현 절차는 별도 정리 과제다.
2. `soviet-main-long-cycle-memory.yml`와 `boundary-spatial-packed-long-cycle.yml`은 동일 브라우저 검사 파일을 다른 출발 커밋에서 실행한다. 두 결과를 합산하거나 오래된 360MiB 수치를 현재 합격선으로 쓰지 않는다.
3. 새로운 `config/performance-baseline-v1.json`은 **측정 출처, 입력·단위, 테스트 소유자 목록**만 고정한다. `scripts/assemble-performance-evidence.mjs`는 기존 JSON을 같은 코드의 계측 결과로만 정규화한다. 두 다른 커밋의 결과를 한 실행 결과처럼 섞거나, 누락값을 0으로 바꾸는 것을 거부한다. 실제 제품 메모리 계측을 복제하는 구현은 추가하지 않았다.
4. 원본 Worker V8 used heap, WASM linear allocation, 프로세스 PSS, 앱 추적 GPU buffer는 서로 다른 측정 단위/범위. 단순 합계를 "전체 RAM/VRAM"으로 보고하지 않는다.
5. `native/docs/performance-budget.json`은 **UNSET**이다. 공식 기준 성능 상한은 Windows 실측/사용자 승인 전까지 설정하지 않는다. CI 기반 참고값은 승인 임계값이 아니다.

## 새 공통 계측 계약과 사용법

- 정본: `config/performance-baseline-v1.json` (기준 제품 commit, 증거 Actions ID, 시나리오, 보존할 소스/테스트 목록).
- 소비기: `scripts/assemble-performance-evidence.mjs` — 위 두 기존 Playwright JSON을 입력해 근거를 식별한 `pando-performance-evidence-v1` 결과로 변환. 원본 리포트는 그대로 보존.
- 사전 검증: `tests/unit/performance-baseline-contract.test.mjs` 및 `.github/workflows/performance-baseline-audit.yml`; 비정상 SHA, 불완전 메모리, 잘못된 국가 건수, 11회만 끝난 왕복, autosave 증가, 허위 성능 예산을 실패로 처리.
- CLI 예시 (동일 source commit의 두 실측 JSON이 있을 때):
```bash
node scripts/assemble-performance-evidence.mjs --source <full-40-hex-commit> \
  --packed test-results/soviet-boundary-index-packed/measurement.json \
  --long test-results/soviet-main-long-cycle/measurement.json \
  --out test-results/performance-baseline/evidence.json
```
  측정 파일이 하나뿐이라면 `--packed` 또는 `--long` 중 하나만 지정해 `partial`로 저장한다. 결측치는 명시적으로 `null`이다.
- 공통 CI는 기존 Playwright **현대 복귀 1회 Worker 계측을 재사용**하고 측정 출처를 연결한 부분 보고서 `evidence.json`을 보존한다. `workflow_dispatch.long_cycle=true`를 선택할 때에만 기존 12회 왕복 테스트를 추가 실행하여 **같은 커밋의** 통합 보고서를 생성한다. GPU·VRAM 등 미측정값은 채우지 않는다.

## 구현 및 실제 검증 결과

- [공통 계측 검증 #39027309859](https://github.com/kimjeon-il/Pando/actions/runs/39027309859): 검증기/단위 계약 **12/12**, 기존 Core/인덱스 계약 **37/37** 성공, 실제 Chromium 1회 왕복도 성공. 소스 `5b07ce911033cc89fc1b2f15da053320e4cf8835`에 결속된 원시 JSON과 공통 `pando-performance-evidence-v1` JSON 아티팩트 저장.
- 실제 동일 브랜치의 현대 1회 복귀: 공유 경계 Worker JS **194.67MiB**, Worker WASM 선형 **57.63MiB**, 전체 Worker JS **249.22MiB**, 전체 Chromium PSS **1,867.65MiB**. 원본 254개, 선분 544,163개, 접촉 339건, packed 원본 선분 540,989개 및 포스팅 562,927개 유지. 소련 진입 2,413ms / 현대 복귀 5,780ms. 이전 실행과 러너·캐시·부하가 달라 단일 수치끼리 성능 개선이라고 판정하지 않는다.
- [P2 생성물 검증 #39027309880](https://github.com/kimjeon-il/Pando/actions/runs/39027309880), [P3 웹 회귀 #39027309879](https://github.com/kimjeon-il/Pando/actions/runs/39027309879) 성공. 제품 소스·WASM·세계 형상·발매 데이터는 변경되지 않았다.
- 장기 12회 결과의 공통 정규화는 수동 `workflow_dispatch.long_cycle=true`를 지정하는 경우에만 수행한다. 이전 [12회 실제 검증 #39025645298](https://github.com/kimjeon-il/Pando/actions/runs/39025645298)은 그대로 기준 증거로 유지한다.

## 이 단계의 종료 조건과 후속

**P0 기준 코드/검증 자산 통합:** 제품 소스는 변경하지 않는다. 기존 테스트 파일과 C++ 코어/WASM 원본을 유지하고, 검증 목록과 메트릭 정규화 계층만 추가한다.

후속 구현은 (1) 61MiB renderableSegments 보유 구조, (2) 미귀속 약 101MiB retaining graph, (3) GPU Stroke 축출/재생성, (4) 실기기 Windows WebView2 성능으로 각각 분리한다. Android 실기기는 현 환경에서 제외한다. 메모리 개선 수치는 동일 OS·브라우저·GPU·입력·유휴조건의 A/B 이후에만 합격 판정한다.
