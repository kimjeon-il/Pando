# OBJ-096 — 소련 대형 경계 실제 편집·확정·취소 CPU 및 원본 참조 회귀

> 조사일: 2026-10-17 · 현재 상태: `instrumented / real-Chromium-running`
> 제품 기준: `work/perf-source-row-owners-20261017` `45c5032198ad3e2d1dd636a5280d856d475cdfd1` (OBJ-092~095 포함)
> 테스트 작업 브랜치: `work/perf-soviet-edit-acceptance-20261017`
> 실행: [GitHub Actions 실브라우저 #39040496743](https://github.com/kimjeon-il/Pando/actions/runs/39040496743)
> 제품 JS·C++/WASM, GIS 원본·`main` 변경 없음. 테스트/보고서 전용.

## 1. 왜 추가 검증이 필요한가

기존 [DEV-085](soviet-boundary-preparation-2026-10-16.md)는
1989-06 소련 해안선 편집 **모드 진입 및 즉시 취소**에 대해 화면 표시,
Worker 편집 준비, 소스 지연 선분화, CPU 대기시간을 계측했다.
[OBJ-094](soviet-contact-wire-lifetime-2026-10-17.md)는 현대 국가
러시아–중국 쌍의 **직접 C++ 접촉 함수** 5회에 대해 데이터 동등성 및
호출 시간을 비교했다. [OBJ-095](soviet-prepared-source-row-compact-2026-10-17.md)는
12회 **시점 왕복**, packed source-ref 및 GPU pan 등을 검증했다.
그러나 이들은 **실제 소련 국가의 경계 정점을 움직인 후**
미리보기 결과를 버리거나 확정하고, Undo/Redo와 원본 경계 참조
복구까지 동일 Chromium에서 반복 검증한 완결형 시나리오는 아니다.

## 2. 검증 경로

Chromium WebGL2/SwiftShader, 1440×900, 1989-06을 고정하고
역사 세계 내 `state:soviet-union`의 실제 형상을 사용한다.
테스트는 `tests/browser/soviet-real-edit-commit-cancel.spec.mjs`이다.

1. 완전한 웹 초기화 및 소련 존재, 도형 직렬화 fingerprint 확보.
2. 실제 UI로 해안선 편집 진입 후 편집 가능한 정점을 드래그한다.
3. 미리보기가 생성된 뒤 Escape로 **확정 전 취소**하여 도형 동일성을 검사한다.
4. 다시 편집 진입·실제 드래그·Core 변경 확정, 원본 도형과 변경 도형의 차이를 검사하고 Undo→Redo→Undo의 실제 기록 복구를 확인한다.
5. 다시 한 번 미리보기 취소·편집 모드 종료를 반복한다.
6. 각 완료 단계에서 공유 국경 Worker의 준비 source row가 원본 geometry 좌표 배열을 그대로 참조하는지, 압축 국가 인덱스 query가 **동일 행 객체**를 반환하는지, 접촉 소스 참조의 식별자·원본 좌표·방향과 source-ref metadata가 완전한지 점검한다.
7. Worker JS heap/WASM, 전체 Chromium PSS, autosave 횟수, 50ms 이상 메인 스레드 Long Task와 편집 진입·드래그 미리보기·취소·확정·Undo/Redo 구간의 실제 경과시간을 분리 기록한다.
8. 현대로 돌아가 stale 소련 지오메트리가 남지 않는지 확인한다.

## 3. 판정 기준과 경계

- 미리보기 **취소**가 원본 지오메트리/역사 기록에 내용을 확정하지 않음.
- 확정 직후 실제 도형 변경, Undo 원상복귀, Redo 동일한 수정 재현, 다시 Undo 원상복귀.
- 날짜변경선·공유 edge·원본 ring의 경계 참조는 객체 식별자 및 좌표·source index 기준으로 검증하며, 작업 간 객체가 재생성된 경우 물리적 JS 참조 주소가 고정되어 있다고 잘못 가정하지 않는다.
- 준비/미리보기/확정 등 `Date.now` wall clock은 Worker CPU 순수 실행시간이 아니다. 별도 `edit.boundary.prepare` Worker 계산/메인 패킷 채택 상세와 Long Task를 확인하여 구분한다.
- Worker별 V8 used heap, WASM 선형 할당, 전체 Chromium PSS는 각각 다른 메모리 계층이다. 합산하거나 단일 실행으로 누수·속도 향상률을 확정하지 않는다.
- 오래 걸리는 시험의 시간 제한은 **진단용 timeout**일 뿐 제품 성능 허용 예산이 아니다. 실패 시 단계와 실패 이유를 기록하고 실제 편집 성공이라고 보고하지 않는다.
- Android 물리 실기기, Windows WebView2, 물리 GPU VRAM 및 Qt 앱은 이 시험에 포함되지 않는다.

## 4. 검증 현황

코드·워크플로 등록과 정적 검사 후 실제 Chromium 1989-06 정점 이동 테스트 중이다.
**실제 confirm/Undo/Redo 완료, 메모리 및 CPU 수치는 CI 결과에서 확인되기 전에는 기입하지 않는다.**

실행 종료 후 `test-results/soviet-real-edit/measurement.json`과
이 보고서에 성공·실패 여부, 단계별 CPU 대기시간, 소스 참조 검사,
Worker/PSS 및 잔여 병목을 채운다. `main`은 현재 변경하지 않는다.
