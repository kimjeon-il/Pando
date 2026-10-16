# P5-6 — 공통 C++ 계산 단일 정본 통합 및 앱·웹 종료 검증

> 보고서 ID: `DEV-075` · 작성: 2026-10-15 · 상태: `implemented / scoped integration CI verified` · 지도 변경: `not-applicable`  
> 기준 통합본: `main` `691ec5d8184f840aa87477d2d340dfbf0fa5d7b9`  
> 검증용 `work/objects` 커밋: `8f2c8d367570177170926fbb77e90c806692d44d`(P1·P3·P5), `9389df049f0c162578b7483245ece10b71db96ca`(객체 타임라인)  
> 두 검증 커밋은 워크플로 주석만 추가했다. 프로덕션 웹·앱 코드 및 WASM 바이너리는 기준 `main`과 동일하다.

## 완료된 변경 범위

- 공통 계산의 소유자를 `shared/` C++로 일원화한다. Qt 앱은 공통 네이티브 라이브러리, 웹은 동일한 C++ 소스에서 생성한 WASM을 호출한다.
- P5-6 소유권 감사에서 9개 영역을 확인한다: `date/calendar`, `timeline/records`, `timeline/resolution`, `timeline/edit`, `spherical/ring-area`, `boundary/refinement`, `boundary/splitting`, `country/contact`, `boundary/packet`.
- 중복 계산 JS는 검증 후 제거하되, HTML/CSS, 브라우저 UI, Worker 요청/증분 캐시 상태, GPU 버퍼 생성 및 렌더러 통합, 원본 참조 연결 등 플랫폼 어댑터는 유지한다.
- 러시아 214폴리곤/36,756좌표 편집: 매니페스트의 실제 163,133바이트와 과거 기록 165,597바이트 불일치를 교정하고 메타데이터 무결성 검사를 추가했다. 2단계 도형 확정, 비동기 Undo 및 RPC `type: request` 요청 계측을 최신 UI/Worker 계약에 맞게 검사한다.
- Windows Qt: `CountryView.color`의 조건부 표현식 참조 수명 문제를 수정하고 결과 색상을 **값**으로 보관한다. 명시색/기본색, 메모 수정, 취소된 Stale 작업, Undo·Redo를 검사하고 일시적인 진단 로그를 제거했다.
- 바뀐 `shared/` 소스의 WASM 및 소스 해시 매니페스트를 재생성하고, 통합 중 병합된 `projectcodec`/`webstorage` 변경도 출처 해시와 일치하는지 점검했다.

## 최종 통합본 CI 증거

| 검증 | GitHub Actions | 판정과 범위 |
| --- | --- | --- |
| P1 원격 개발·웹 스모크·C++ 코어·엔진·GIS C++ 도구 | [#38739689081](https://github.com/kimjeon-il/Pando/actions/runs/38739689081) | **SUCCESS**; WASM 재빌드/기본 Qt 앱 잡은 변경 분류에 따라 skip(별도 P2/P3 검증 사용) |
| P5 공유 국경선·C++ 단일 소유권·성능·러시아 실편집 | [#38739689090](https://github.com/kimjeon-il/Pando/actions/runs/38739689090) | **SUCCESS**, 4/4 잡 통과 |
| 객체 타임라인·라이브러리 C++/WASM 연동 | [#38740170698](https://github.com/kimjeon-il/Pando/actions/runs/38740170698) | **SUCCESS**, 시간대/기록/편집·라이브러리 회귀검사 |
| 앱·웹 P3 브라우저/양 OS Qt | [#38739689107](https://github.com/kimjeon-il/Pando/actions/runs/38739689107) | **SUCCESS**; 브라우저/웹 스냅샷·Linux/Windows Qt 각 5/5 CTest 통과, C++ 면적 연동 1/1 통과 |
| 소스 일치 WASM 생성·ABI·문서 세션 | [#38734216094](https://github.com/kimjeon-il/Pando/actions/runs/38734216094) | **SUCCESS**; 이후 병합 소스·매니페스트/바이너리 동일성 점검 |
| `main` Pages 배포 | [#38737601463](https://github.com/kimjeon-il/Pando/actions/runs/38737601463) | **SUCCESS**, 기준 커밋 `691ec5d` |

위 `P3` 회귀검사는 해당 워크플로의 선정된 브라우저 시나리오와 5개 핵심 Qt CTest·면적 연동 CTest를 의미한다. 저장소의 모든 테스트 파일·기기·렌더링 플랫폼을 전수 실행했다는 뜻은 아니다.

## 실제 공유 국경선 CPU 측정

동일 Ubuntu runner/Node 프로세스의 이전 JS 패킷 계산과 C++/WASM 계산 중앙값 비교이다. [최종 성능 아티팩트](https://github.com/kimjeon-il/Pando/actions/runs/38739689090)에서 세 항목 모두 형상·소유자·점선 및 패킷 메타데이터 결과가 동등했고 회귀 게이트를 통과했다.

| 입력 | 기존 JS 중앙값 | 공통 C++/WASM 중앙값 | CPU 시간 감소 |
| --- | ---: | ---: | ---: |
| 실제 미리보기(12,729 선분) | 280.716 ms | 227.631 ms | 18.9% |
| 실제 정밀(68,616 선분) | 1,430.581 ms | 1,147.881 ms | 19.8% |
| 합성 고부하(8,192 선분) | 171.262 ms | 133.469 ms | 22.1% |

위 수치는 **공유 국경선 패킷 CPU 생성 시간**이며 지도 전체 프레임의 FPS, UI 응답성, 지속 메모리 사용량을 의미하지 않는다. 상세한 이전 단계 측정과 해석은 [`P5-5 성능 기록`](../p5-shared-border-performance.md)을 참고한다.

## 러시아 편집의 기능/응답성 분리

- P5 실측: WebGL2/Chromium 소프트웨어 GPU, 러시아 폴리곤 214개/좌표 36,756개; 실제 Worker RPC 요청 **123건**, Long Task **117건**, 최장 **7,129ms**.
- 그리기→영역 확정→하위 객체 생성→원본 보존→Undo→해안선 편집 취소 절차는 **기능적으로 통과**. 소프트웨어 GPU에서 관측한 최장 작업은 실제 PC GPU FPS 인증이 아니며, 별도 응답성 성능 과제로 추적한다.

## 범위 외·제약 및 종료 조건

- 기존 고배율/고좌표 편집의 Long Task 최적화, GPU 프레임 레이트, Android 및 실제 Windows 하드웨어 렌더링 성능은 이번 P5-6 계산 통합 게이트에 포함되지 않았다.
- 선택된 P1/P3/P5 CI가 통과해도 전 저장소 테스트, 수동 UX 탐색, 현장 브라우저 캐시 동기화가 모두 통과했다는 의미는 아니다.
- **공식 P5 종료 판정: 범위 내 완료.** 검증용 통합 소스에서 P1, P3, P5, 객체 타임라인 CI 모두 통과했고 Windows/Linux Qt CTest는 각각 5/5, 면적 연동 CTest는 각각 1/1 통과했다. 이전 색상 참조 오류는 Windows에서 재발하지 않았다. 과거 실패본 대비 확인 가능한 선행 성공 기록은 [#38735587140](https://github.com/kimjeon-il/Pando/actions/runs/38735587140)이다.
- `main` 통합본 소스를 검증하려는 목적에서, 브랜치 주석만 바꾼 `work/objects`에 CI를 실행했으며 이번 보고서 작성/검증 트리거 단계에서 `main`에 직접 커밋하거나 다시 병합하지 않았다.
