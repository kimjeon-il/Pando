# OBJ-089 — 공유 국경선 선분 공간 인덱스 압축: 실측 결과

> 보고서 ID: OBJ-089 · 2026-10-17 · 상태: verified-web-paired · 지도 반영: not-applicable
> 소스 기준: main `78ab111e34966bc2573bfdd192c75954f322d771` → `work/perf-boundary-index-20261017`
> 제품 수정: `assets/js/modules/boundary-spatial-index.js`, `assets/js/modules/boundary-topology.js`
> 검증: [동일 러너 A/B #39025083891](https://github.com/kimjeon-il/Pando/actions/runs/39025083891) · [집중 단위/Worker 계약 #39025081105](https://github.com/kimjeon-il/Pando/actions/runs/39025081105)

## 원인과 구현

과거 OBJ-088의 약 360MiB 공유 국경선 Worker JS 힙은 누적된 오래된 세계만으로 설명되지 않는다.
현대 254개 국가의 선분 544,163개를 위한 파생 구조 중 공간 인덱스와 선분 유지 그래프가 해제 기반 측정으로 약 192.84MiB였다.

기존 `createBoundarySpatialIndex()`는 각 선분에 대해 Map entry, bbox, JS 문자열 격자 키 및 각 셀의 Set 멤버십을 보유했다.
새 구현은 **불변의 단일 국가 형상 버전**에 한하여 `loadPacked(segments, boxes)`를 실행한다.
- 대량 선분: 셀 키는 안전 범위에서 충돌 없는 정수 키, 셀의 선분 참조는 Uint32Array postings, 실제 bbox는 Float64Array + Uint32Array offsets로 보관.
- 원본 선분 객체는 복사하지 않고 기존 `segments` 배열에 대한 참조를 유지. 조회 순서, 중복 제거, 다중 bbox, 날짜변경선, 4,096셀 초과 fallback 계약 보존.
- 128개 미만인 소규모·수정 가능 인덱스는 기존 삽입/삭제 경로를 계속 사용. 형상 변경은 기존 revision 단위로 **새 준비 상태**를 만들며, 이미 빌드한 packed index를 부분 수정하지 않음.
- 렌더용 선분 배열 약 61MiB 및 나머지 약 101MiB의 별도 보유 구조는 이번 변경에 포함하지 않음.

## 동일 실행기 실제 A/B

각 소스의 동일 Chromium 151/WebGL2 SwiftShader·Ubuntu 24.04, 1440×900, 1989-06 소련 → 현재 2026-10 왕복.
두 환경에서 지도 준비/공유 국경 작업 종료 및 추가 무입력 구간 후 Worker CDP GC를 두 차례 호출.
사용한 소스: baseline `78ab111e`, candidate `da08c5e8`.
각각 독립 Playwright 프로세스·포트를 사용하며 같은 GitHub Actions 러너에서 순차 실행.

| 지표 | baseline | packed | 변화 |
| --- | ---: | ---: | ---: |
| 공유 국경선 Worker JS used heap | 360.06MiB | **194.68MiB** | **−165.38MiB / −45.93%** |
| 전체 Worker JS used heap | 414.61MiB | 249.22MiB | −165.39MiB |
| Chromium 전체 PSS | 2,007.59MiB | 1,841.82MiB | −165.77MiB |
| 공유 국경선 Worker WASM 선형 메모리 | 57.63MiB | 57.63MiB | 0 |
| 전체 Worker WASM 선형 메모리 | 403.5MiB | 403.5MiB | 0 |
| 소련 시점 준비 | 3,031ms | 3,071ms | +40ms |
| 현대 시점 복귀 | 7,959ms | 7,935ms | −24ms |

기능 동등성: 현대 국가 입력 **254개**, source segments **544,163개**, 공유 경계 선분 **68,616개**, 국가 접촉 **339건**,
Worker `preparationCount=513`가 동일했다.
후보는 **194개 국가 인덱스**에 걸쳐 **540,989개 선분**을 packed 방식으로 처리하고,
인덱스 포스팅 **562,927개**, TypedArray 합계 **22.785MiB**를 보유했다.
나머지 소규모 국가는 기존 동적 인덱스를 유지한다.

**판정:** 동일 러너 1쌍의 실측에서 CPU 시점 변경시간의 뚜렷한 악화 없이 JS 힙·PSS가 약 166MiB 감소했다.
다만 V8 JS used heap, WASM 선형 버퍼, Chromium 전체 PSS, GPU VRAM은 다른 계층의 지표이며 서로 더하거나 특정 Worker의 물리 RAM으로 단정하지 않는다.
단 1쌍의 시간 비교로 모든 PC의 p95·초기 로딩 개선율을 입증한 것은 아니다.

## 동등성·회귀·남은 조건

집중 Node·ESLint 및 기존 C++ 접촉/실제 Worker 계약: 신규 packed 4/4 + 기존 접촉·경계 편집 38/38 **총 42/42 성공**.
검사 범위: 조회 후보의 참조 및 순서, 다중 bbox/날짜변경선, 넓은 영역 fallback, 접촉 계산, 경계 편집 재준비, 신속한 replace/patch.

소스 일치 P2 생성물은 [Actions #39025446286](https://github.com/kimjeon-il/Pando/actions/runs/39025446286)에서 최종 생성·게시 검증에 성공했다.
남은 검사: 실제 Windows WebView2/물리 GPU,
12회 장기 시점 왕복 이후 유지량·GPU 업로드와 프로젝트 수정 후 미리보기 비회귀.
Android 실기기와 Qt 렌더러는 사용자 요청에 따라 현재 범위에서 제외한다.
이번 소스 변경은 세계 원본 형상이나 역사 사실 데이터를 바꾸지 않았다.
