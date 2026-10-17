# OBJ-096 — 소련 대형 경계 실제 편집·확정·취소 CPU 및 원본 참조 회귀

> 조사일: 2026-10-17 · 현재 상태: `source-move-verified / end-to-end-blocked-by-core-document-prepare-timeout`
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

## 4. 실제 실행 결과 — Worker 이동 정상, Core 문서 후보 생성 제한시간 초과

### 4.1 독립적인 실제 소련 Worker 이동 (확정)

[Actions #39041652838](https://github.com/kimjeon-il/Pando/actions/runs/39041652838)
**성공**: 집중 Node 검사 21/21 및 실제 Chromium Playwright 1/1 통과.
소련 시점의 `state:soviet-union`에 대해 웹의 **실제 지도 UI를 통한 해안선
편집 진입** 후, `map-edit-worker.js`의 활성 `boundaryService`를 사용해
소련의 준비된 해안 정점 `-180,65.066229`를 4차례 독립적으로 이동했다.

| 측정값 | 실제 결과 |
| --- | ---: |
| 편집 진입 UI 경과시간 | 2,976ms |
| 캐시된 경계 준비 재조회 | 0.2ms |
| 편집 Worker `boundaryService.move` | 47.8 / 39.0 / 43.1 / 43.2ms |
| 변경된 소련 지오메트리 복제 확인 | 4/4 |
| 원본 `boundaryFeatures` 객체 및 직렬화 원본 불변 | 4/4 |
| 실제 sourceCount / 선분화된 대상 | 5 / 2 |
| Worker 경계 선분 | 41,177 |
| Worker 토폴로지 nodes / segments / handles | 39,825 / 39,827 / 39,781 |
| 준비 캐시 추산량 | 46,497,056B (약 44.34MiB) |
| 명시된 준비 캐시 예산 | 33,554,432B (32MiB) |

캐시가 예산보다 크더라도 **활성 편집 항목 1개를 보존**하는 기존 정책에
따른 것으로, 별도 누수를 입증하지 않는다. 워커 직접 호출의 4회
`move`는 실제 원본 USSR 입력을 사용했지만 UI에서
Core `territorial.edit` 후보를 확정한 것은 아니므로 **확정 성공이 아니다**.

### 4.2 실제 UI 드래그 → 국경 편집 → Core 후보 준비: 반복된 차단 지점

[Actions #39041738960](https://github.com/kimjeon-il/Pando/actions/runs/39041738960)
실패 로그에는 다음 실제 Worker RPC 상태가 확인된다.
테스트는 실제 1989-06 소련 지도 화면에서 해안선 편집,
가시 정점 `[132.404714,45.146496]`을 화면상 임계 거리까지
드래그했다가 작은 유효 이동량으로 마무리했다.

| 단계 | GitHub-hosted Chromium 한 실행의 기록 |
| --- | ---: |
| 해안선 편집 준비 UI | 2,520ms |
| `map-edit / boundary-prepare` Worker 계산 | 983.4ms |
| `map-edit / boundary-move` Worker 계산 | **30.8ms**, 정상 응답 |
| `map-edit / territorial-edit` Worker 계산 | **1,236.7ms**, 정상 응답 |
| `territorial-edit` 응답의 `preview.validation.blocking` | **false** |
| `core-session / core.document-prepare` | 요청 ID 27 전송 확인. 30초 이내 응답 없음 |
| 웹 UI 최종 오류 | `Worker 작업이 30000ms 제한 시간을 초과했습니다. · PL-TERRITORIAL-EDIT` |
| 페이지 JavaScript 오류 | 0건 |

`core.document-prepare` 요청은 `territorial-edit` 성공 직후
약 **44,182ms** 지점에 전송되었고, 그 전 요청 `core.document-draft-apply` 등은
모두 응답 완료였다. `core.document-prepare`만 해당 제한시간 동안
결과가 기록되지 않았다. `core-document-client.js`의
`prepare`는 `createWorkerRpcClient` 기본 **30,000ms** 제한시간을 사용한다.
코드 경로상 `projectDomain.prepareCommand` →
`commandOwner.prepare` → `core.document-prepare` →
`DocumentSession.prepareCommand`(C++/WASM)이며,
이는 국경 편집 Worker 계산 완료 이후의 단계다.

이 기록으로 **후속 Core 후보 준비 RPC 지연/응답 누락**은 특정됐다.
단, 명령의 C++ 내부 CPU, JS↔WASM 직렬화, Core 큐 및 응답 생성 각각의
세부 시간을 아직 계측하지 않았기 때문에 정확한 개별 함수 병목까지
확정하지 않는다. UI 시험 종료 시 미리보기 세션이 생성되지 않았다.
따라서 **실제 변경 확정, Undo/Redo, 완료 후의 전체 Worker 메모리**
등을 성공했다고 말할 수 없다.

이전 [#39040899458](https://github.com/kimjeon-il/Pando/actions/runs/39040899458)에서도
더 큰 정점 이동 후 `boundary-move` **78.5ms**, `territorial-edit`
**1,509.4ms**가 각각 정상 응답했지만 동일한 30초
`PL-TERRITORIAL-EDIT` 제한시간이 재현됐다.
최초 초소형 0.6픽셀 이동 테스트는 브라우저 입력 임계값 문제가 있어
서로 다른 유효한 편집 성공으로 해석하지 않는다.

## 5. 결론 및 남은 필수 작업

**OBJ-092~095의 공유 국경선 Worker 압축 및 원본 참조 보존은
국경 편집 Worker의 실제 소련 이동 4/4 성공으로 재확인했다.**
하지만 2차의 **실제 편집 확정·Undo/Redo 전체 통합 게이트는 미통과**다.
Core 문서 후보 준비의 30초 지연이 독립적 후속 병목이다.

다음 순서:
1. Test-only Core Worker 단계 계측으로 `core.document-prepare`의 큐 대기,
   JS↔WASM 전달, 실제 C++ `DocumentSession.prepareCommand`,
   C++ 후보 내용 검증 및 응답 직렬화의 시간을 분해한다.
2. 개별 CPU 병목을 확인한 뒤 단일 C++ 정본에 국한한 최적화를 수행한다.
   무조건 RPC timeout을 늘려 UX 지연을 숨기는 방식은 채택하지 않는다.
3. 원본 GIS 형상 및 C++/WASM 동등성, 실제 소련 해안선 정점 이동 →
   후보 준비·취소, 후보 확정 → Undo/Redo → Undo, 다른 1989년 객체,
   12회 세계 왕복, V8/WASM/PSS를 별도 게이트에서 다시 검증한다.
4. Windows WebView2·Android 실기기는 이번 hosted Chromium 검증 범위가 아니다.

제품 `assets/js`, C++/WASM, 지리 원본, `main`은 건드리지 않았다.
기존 성공 [OBJ-095 보고서](soviet-prepared-source-row-compact-2026-10-17.md)의
메모리 절감 약 6.9MiB 및 12회 안정성 검증도 그대로 유지된다.
