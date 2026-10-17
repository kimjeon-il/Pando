# DEV-086 — 1989년 소련 편집 메모리·반복 회귀 검증

> ID: DEV-086 · 상태: verified-web-ci-with-observability-limits · 지도 반영: not-applicable · 2026-10-16  
> 브랜치: work/integration-ui-objects-20261016 · 구현: 38762f5809c06137baaf0bd0d789ca0b7a5771c3, 22d6ec250caba2592b30af03942fb2e8582ddbc8  
> 선행 보고: [DEV-083 초기 원인](soviet-initialization-memory-2026-10-16.md), [DEV-085 편집 준비 최적화](soviet-boundary-preparation-2026-10-16.md). Qt 앱·역사 GIS 원본·main 변경 없음.

## 적용한 개선

- **경계 토폴로지 캐시 예산:** 기존 최대 8개 보관 정책에 **추정 32MiB** 예산을 추가했다. 새 편집에 필요한 하나의 캐시는 예산을 초과해도 유지하며, 나머지 오래된 토폴로지와 불필요한 원본 상세 선분 배열을 제거한다. 최근 사용 결과는 캐시 사용 순서에 반영한다.
- **시점 전환 캐시 무효화:** 해당 월에 필요했던 편집 경계 토폴로지를 시점 변경 시 해제한다. 전체 프로젝트 재저장·Worker 재시작·전체 세계자료 전송을 강제하지 않고, 다음 실제 편집에서 정본 소스를 재확인한다.
- **소유권 계측:** 편집 Worker의 경계 원본 수, 상세 선분화 객체 수, 캐시 항목 수, 노드·선분·핸들 수, 추정 바이트, 축출 횟수를 읽기 전용 진단으로 기록한다. 추정치는 V8 실제 heap 계측이나 WASM/GPU 메모리 보유량을 의미하지 않는다.

## 환경과 측정 한계

정본 역사 세계의 1989-06, state:soviet-union, Ubuntu 24.04 GitHub-hosted Playwright Chromium WebGL2 1440×900, SwiftShader **소프트웨어 GPU**. 소련 해안선 편집을 3회 열고 취소하고, 현재 월과 1989년을 왕복했다. Main CDP 힙, 메인 스레드 GC, Chromium 프로세스 PSS, WebGL 버퍼 계측, Worker 수·캐시, 편집점 DOM 및 원본 지문을 검증했다.

- Main GC는 **전용 Worker, WASM, GPU, 드라이버의 메모리 회수를 보장하지 않는다.** Chromium PSS는 프로세스 간 공유물리 페이지를 안분한 합계이므로 JS 힙과 합산하거나 GPU VRAM으로 해석할 수 없다.
- Emscripten 공통 Core가 HEAPU8/HEAP8을 공개하지 않는 Worker에서는 WASM 힙이 **null(미관측)**이다. Worker별 V8 힙도 일부 환경에서 조회 불가능하다. null은 0바이트를 뜻하지 않는다.
- 아래 PSS는 독립 CI 1회 관측값이다. 절대 바이트 임계값으로 메모리 누수 여부를 단정하지 않고, 모델/DOM/캐시 무효화 같은 구조적 회귀에 assertions를 둔다.

## 반복 편집 실측

첫 실행 [38911806977](https://github.com/kimjeon-il/Pando/actions/runs/38911806977)에서 세 차례 취소·메인 GC 후 JS 힙은 **76.6 / 76.7 / 76.9MiB**, Chromium PSS는 **1,737.1 / 1,736.7 / 1,739.2MiB**였다. 원본 좌표 지문 불변, 편집 중 가시 정점 341개, 매번 취소 후 정점 0개, 페이지 오류 0. 경계 캐시는 1개(추정 44.3MiB)로 유지됐다.

시점 전환 시 캐시 무효화를 추가한 최종 실행 [38912494140](https://github.com/kimjeon-il/Pando/actions/runs/38912494140)도 전 과정 성공.

| 최종 실행 단계 | Main JS 힙 MiB | Chromium PSS MiB | Worker 경계 캐시 |
| --- | ---: | ---: | --- |
| 소련 편집 전 메인 GC | 80.7 | 1,878.2 | 없음 |
| 1회 취소·GC | 76.6 | 1,759.9 | 1개, 추정 44.3MiB |
| 2회 취소·GC | 76.8 | 1,761.8 | 1개, 추정 44.3MiB |
| 3회 취소·GC | 76.9 | 1,762.6 | 1개, 추정 44.3MiB |
| 현재 월 전환·GC | 89.2 | 2,400.7 | **해제됨** |
| 현재 월 6초 유휴·GC | 105.8 | 2,282.5 | 해제됨 |
| 1989년 복귀·GC | 77.7 | 2,312.3 | 해제됨 |
| 복귀 6초 유휴·GC | 77.7 | 2,235.4 | 해제됨 |

**추정 44.3MiB가 32MiB를 초과하는 것은 단일 활성 준비 결과 유지 예외**로 의도된 동작이다. 32MiB는 실제 메모리 사용량의 하드 캡이 아니다. Worker 수는 최종 실행 동안 7개, 페이지 오류 0이었다. GPU stroke의 보고된 active buffer는 편집 중 약 13.64MiB, 시점 복귀 후 약 19.8MiB로 변했다. 둘 다 GPU VRAM이나 누수량으로 단정할 수 없다.

## 판정·잔여 문제

- **통과:** 동일 소련 경계 3회 편집·취소 동안 Main GC 후 JS 힙 및 Chromium PSS의 지속적 누적 증가가 관측되지 않음. 원본 형상, 취소 UI, 캐시 예산·단일 활성 결과 정책, 오래된 월의 경계 캐시 해제를 검증함.
- **미확정:** 시점 왕복 직후 PSS는 초기 편집 취소 후보다 높고, 6초 경과 후에도 완전히 복귀하지 않았다. 경계 토폴로지는 이미 해제된 상태다. Worker/WASM·렌더러·Chromium 내부 재할당의 별도 소유권을 분리하지 못했으므로 **경계 캐시 누수 또는 완전한 무누수로 단정하지 않음**.
- **추가 권장 계측:** 동일 프로세스의 편집 없는 월 왕복 대조군, Worker별 heap 관측, GPU 리소스 생존 및 장시간 유휴 GC. 실제 Windows/Android 물리 GPU·VRAM은 미검증.

## 회귀 증거

- [전용 반복 편집·메모리 CI 38912494140](https://github.com/kimjeon-il/Pando/actions/runs/38912494140) — 편집 3회/취소/시점 왕복/메모리·캐시 구조 검증 성공, JSON 아티팩트 보존
- [통합 계약 CI 38912494182](https://github.com/kimjeon-il/Pando/actions/runs/38912494182) — 성공
- [시점 저장 브라우저 CI 38912494208](https://github.com/kimjeon-il/Pando/actions/runs/38912494208) — 성공
- [실제 전체 세계 웹 회귀 CI 38912494189](https://github.com/kimjeon-il/Pando/actions/runs/38912494189) — 소련 초기 메모리·렌더링·시점·세계 패키징 모두 성공

본 작업에서는 Qt, 역사 GIS 데이터, main 병합 및 배포를 변경하지 않았다.
