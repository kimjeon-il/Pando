# OBJ-083 — 객체 시점 계산 단일화 및 검증

> 보고서 ID: `OBJ-083` · 상태: `verified-focused` · 지도 반영: `not-applicable` · 색인일: 2026-10-17  
> 원문 최종 수정: 2026-10-17 · 대상: `work/objects` (웹·C++ 공통 엔진)  
> 계산 변경: [4978828a](https://github.com/kimjeon-il/Pando/commit/4978828a04ef2434b497c5300894503ec2b74fdb) · 소스 일치 생성: [2e332b4c](https://github.com/kimjeon-il/Pando/commit/2e332b4cd443f8931a2d28ee865aba50c4696b41)  
> 최종 집중 검증: [Actions #38979716137](https://github.com/kimjeon-il/Pando/actions/runs/38979716137) — 3개 작업 모두 성공

## 변경 범위

기존 시점 변경에서 C++ `resolveWorld`를 선택 정리, 시점별 정적 문서 생성, Worker 응답용으로 각각 한 차례씩 호출했다. `DocumentSession::setTimelineCursor`에서 해석한 `ResolvedWorld` 하나를 세 경로에 **대여·복사해 재사용**하도록 했다. JS `core-document-runtime.js`는 Core 응답에 동봉된 동일 월·epoch의 세계를 검사하고 재조회 RPC를 하지 않는다. 영구 세계 캐시, 새 정본, JS 세계 재계산기, 레거시 분기 모두 추가하지 않았다.

시점만 바꿔도 문서 revision·저장 체크포인트·Undo가 늘어나지 않는 기존 계약을 유지했다. 프로젝트 선택·기간·속성 해석과 재열기 형식은 바꾸지 않았다. 관련 C++ API, WASM 바인딩 및 JS 계약 테스트를 함께 수정했다. `main` 병합, Qt 앱 변경, 배포 및 역사 지도 형상 수정은 수행하지 않았다.

## 실제 검증

- 소스 일치 Emscripten WASM 빌드·자산 SHA 검증: [P2 #38930224044](https://github.com/kimjeon-il/Pando/actions/runs/38930224044) 및 [후속 P2 #38932555730](https://github.com/kimjeon-il/Pando/actions/runs/38932555730) 성공.
- C++ 시점 편집 계약 **1/1**, JS 문서 세션·명령 **29/29**, WASM 시간·타임라인 **9/9** 성공.
- 실제 C++/WASM 세션에서 `2026-10 → 1914-07 → 2026-10`: epoch **1→2→3**, 응답 월·epoch 및 세계 객체 동등, checkpoint·revision·dirty·Undo 비회귀 성공.
- Chromium WebGL2 소련 1989년 선택·메모리 관측과 1991년 도형의 2012년 삽입·Undo·시점 속성·저장 후 재열기 **2/2 성공**.
- 새 프로젝트 초기화 후 과거 월 이동 **3/3 성공**. 프로젝트 교체 중 기존 `TIMELINE_DRAFT_ACTIVE` 안전 차단은 유지. 변경 완료 전에 확인창이 닫힐 수 있어 테스트는 작업 완료 후 유효한 이동이 실제 확정되는지를 제한 시간 내 확인하도록 수정.

## 변경 전부터 존재한 실패와 잔여 위험

동일 소스/바이너리 조건으로 전후를 별도 실행해 1단계에 잘못 귀속하지 않았다.

- [네이티브·브라우저 전후 비교 #38976866092](https://github.com/kimjeon-il/Pando/actions/runs/38976866092): C++ `document_session_tests`의 저장본 동등 비교는 **변경 전후 동일하게 실패**. 원본 브라우저에서 자동저장 완료 전 상태값 비교 및 저장본 이름 갱신 실패도 변경 전후 재현.
- [WASM 문서 전후 비교 #38977310401](https://github.com/kimjeon-il/Pando/actions/runs/38977310401): 4건 모두 변경 전후 동일 실패(옛 국가명, `editorState.lastViewedMonth` 차이, 빈 `properties` 필드 차이). 독립된 문서/직렬화 계약 수리 과제로 남긴다.
- [신규 프로젝트 재설정 경합 #38977775369](https://github.com/kimjeon-il/Pando/actions/runs/38977775369): **기존 즉시 확정 테스트** 4회 반복 시 변경 전 3/4 통과, 변경 후 0/4 통과. 기존 교체 완료·UI 시점 입력 경합이 더 자주 노출됨을 확인했다. 후속 3/3 성공은 **교체 완료 후 유효 요청을 재시도하는 테스트 계약**의 증거이지, 제품 UI가 교체 중 요청을 자동 대기시킨다는 뜻이 아니다. 사용자 입력 UX 개선은 별도 범위.
- 실행시간 중앙값·p95 **전후 동시 벤치마크는 미실시**. `resolveWorld` 중복 실행 제거는 코드상 확인되지만 몇 ms/% 빨라졌는지 확정하지 않는다.
- Chromium PSS 장기 잔류, 공유 국경선 Worker의 JS/WASM 대형 힙, GPU stroke 캐시는 [OBJ-082](soviet-memory-owner-attribution-2026-10-16.md)의 별도 추적 대상으로 남는다. 이 변경으로 메모리 누수가 해결됐다고 주장하지 않는다.
- Android 실기기, Windows 실사용 환경 및 물리 GPU 성능은 본 검증 범위 밖이다.

## 보존 및 판정

1단계 `시점 계산 3중 실행 → 단일 결과 재사용`의 **기능 동등성 및 집중 회귀 기준 충족**. 비교 실행을 위해 만든 임시 워크플로 4개는 실행 기록/아티팩트를 남기고 브랜치에서 정리한다. 유지할 정기 검사는 `.github/workflows/objects-cursor-focused-acceptance.yml` 하나이며, `work/objects` 작업은 다음 단계(저장·미리보기 중복 제거)와 분리한다.
