# 편집 상태와 취소·적용·실행 취소 구현 검증

> 보고서 ID: `UI-EDIT-20261018` · 상태: `deployed-web-ci-incomplete` · 지도 반영: `not-applicable` · 색인일: 2026-10-18
> 원문 최종 수정: 2026-10-18
> 조사 기준: Web / WebView App 공통 기준 `f7d7b6ba244ef75ba5b708090ec09c453de504ee` 이후 work/ui 변경
> 원본·출처: 사용자 승인 편집 상태 개편안, 아래 소스 및 실행 로그

## 대상과 기준일

상설 `D:/dev/worktrees/ui`, `work/ui`에서 작업했다. 원격 상태와 깨끗한 작업 트리를 확인하고 원격 work/ui `9a20fe99`를 반영한 뒤 최신 main `6cb9859d`를 병합했다. 구현 당시에는 main 반영·원격 push·배포를 실행하지 않았다. 후속 배포 결과는 아래 절에 기록한다.

## 구현

- 기존 작업 패널과 지도 요약에 대상, 보기 월말, Core가 산출한 영향 기간, 초안·미리보기·계산·적용 단계와 Space 안내를 표시한다. 접힌 패널에도 작업명·대상·단계를 유지한다.
- 경계 드래그는 editing-domain의 초안 이력에 누적한다. 드래그 종료는 계산이나 적용이 아니다. 마지막 이동 취소, 여러 노드 이동, 같은 노드 재편집과 초안 Undo/Redo를 처리한다.
- 미리보기 복귀와 전체 폐기를 분리했다. Ctrl+Z/Esc/복귀 버튼은 입력을 보존하고 준비된 결과를 해제한다. 입력이 있으면 전체 취소에 편집 계속/초안 버리기 확인을 사용한다.
- 초안 이력이 비어도 프로젝트 이력으로 넘어가지 않는다. 합병 대상 추가·해제도 같은 편집 도메인에서 이력을 관리한다. 텍스트 입력은 네이티브 실행 취소를 유지한다.
- 적용 중 중복 요청을 막고 프로젝트 checkpoint가 달라진 후보는 적용하지 않는다. 반영 성공 후 표시 오류가 발생한 명령은 다시 적용하지 않는다.
- Core 명령 이력에서 Undo/Redo 명령명을 제공한다. 영향 기간은 명령 전후의 시간 기록 차이로 계산하며 UI는 계산하지 않는다. 기간 끝은 배타적이며 UI에 ‘전까지’로 표시한다.
- 단순 속성의 기존 change/완료 커밋 경로를 유지한다. 색상 컨트롤의 중간 입력을 새 프로젝트 명령으로 만드는 변경은 하지 않았다. 저장 형식 호환 계층을 추가하지 않았다.

## 근거와 방법

- 단위 테스트: `focused-tests.log` — 174/174 통과. 실제 WASM을 사용하는 후보 적용·이력·유한 기간 검증 포함.
- Web: 실제 Chromium, WebGL2 / Canvas 각각 경계 드래그 → 미리보기 → Ctrl+Z 복귀 → 초안 Undo/Redo → 적용 → 프로젝트 Undo/Redo 통과. 1440×900 및 390×844 CSS px. 터치 에뮬레이션으로 패널 접기 확인.
- Web 추가 검증: 검색 입력의 네이티브 Ctrl+Z, 대상·보기 시점 유지, 합병 미리보기 복귀 후 선택 초안 Undo/Redo와 폐기 통과. WebGL2/Canvas 2개 시나리오 및 영토 편입 폐기 확인 시나리오 1개 통과.
- 변경 JS 린트, UI spacing/components/architecture/layering/information-architecture 검사 통과.
- WASM 재빌드·패키징 및 소스 일치 검사 통과. source SHA-256: `b99d73047055bf6c74a7702fd34cfbb1d863248d2094e76c898b290a6e710f09`.
- WebView2 네이티브 실행: 같은 경계·합병 복구 시나리오 통과. 텍스트 포커스, Esc/Ctrl+Z, 검색 후 대상 유지, CDP 터치 입력, 적용과 프로젝트 Undo/Redo, 초안 폐기 및 시작 시 pageerror 없음 확인. 터치는 에뮬레이션이며 실기기 확인과 구분한다. 로그: `webview-ui.log`.
- WebView Windows GNU debug 빌드 성공. 기존 storage.rs의 unused_mut 경고가 남아 있으며 빌드 성공은 UI 동작 검증과 구분한다.

재현용 브라우저 테스트는 `tests/browser/editing-state-recovery.spec.mjs`, WebView CDP 실행기는 `tests/browser/helpers/verify-webview-editing.mjs`이다. 테스트 전용 모듈 주입으로 canonical 도메인 상태와 형상을 관찰하며 제품 런타임에 테스트 API를 추가하지 않았다.

원시 실행 로그: 로컬 `.superpowers/sdd/editing-state-20261018/`. 의존성 경로가 이전 worktree를 가리켜 기존 node_modules를 보존한 채 현재 worktree에 재설치했다. 콘텐츠 해시 JSON 한 파일의 CRLF 체크아웃이 부트스트랩 해시 검사를 실패시켰으며, HEAD 원본 바이트와 SHA-256을 확인하여 동일 내용의 원본 바이트로 복원했다. 지도 자료를 새로 편집한 것은 아니다.

WebView 진단 패널이 좁은 창에서 편집 버튼을 가리는 문제를 실제 입력 검사로 발견하여 접을 수 있게 했다. Core 준비 전 시점 표시가 null 상태를 읽던 시작 오류를 수정하고 회귀 테스트를 추가했다. 이 두 항목은 Web 테스트 성공만으로 발견되지 않았던 App 확인 결과다.

## 확인 결과와 한계

구현 자동 검증과 사용자 검증을 구분한다. 실제 사용자에게 중단 후 편집 대상·영향 기간·취소 결과를 예측하게 하는 연구는 실행하지 않았다. 버튼 발견 시간, 예측 일치율을 측정하거나 통과로 보고하지 않는다. 실제 터치 하드웨어 검증도 미실행이다. 역사 형상 정합성이나 지도 데이터 적용 검증은 이 UI 작업의 범위가 아니다.

## 데이터 반영

지도 데이터 변경 없음. 변경은 work/ui의 UI·편집 도메인·Core 후보 메타데이터와 관련 테스트다. 구현 시점에는 main 통합·push·배포 미실행. 후속 Web 배포는 아래와 같다.

## 2026-10-18 Web 배포 추가 검증

사용자의 ‘배포까지’ 지시에 따라 main 통합과 Pages 게시를 진행했다. 추가 기능 수정 없이 배포 메타데이터를 갱신했다.

- 기능 커밋: `00b1b3ff62df59466f1a3bc774f01755f367bfbf`.
- 운영 릴리스 커밋: `4d2cf48267de8693fcf6d054b7e56e93c2fd7688`. main `6cb9859d`에서 fast-forward하고 main·work/ui를 원격에 atomic push했다.
- [Pages 실행 39111928319](https://github.com/kimjeon-il/Pando/actions/runs/39111928319): build 38초, deploy 27초, 모두 성공.
- 운영 주소: [판도연구소](https://kimjeon-il.github.io/Pando/).
- 게시 전 canonical staging: 5,725개 파일, 579,942,060 bytes. App 소스 92개, 공통 소스 173개 제외. Windows CRLF 체크아웃 차이 3,684개는 Git batch로 원본을 읽되 기존 stageWebPages의 원본 해시·줄바꿈 동등성·복사 해시 검사를 그대로 수행했다. staging 계약 테스트 6/6 및 릴리스 집중 단위 테스트 174/174 통과.
- 운영 HTTP 200 및 원본 SHA-256 일치 10/10: index.html, build-meta, UI bundle, task presentation, lifecycle assembly, geometry preview, editing domain, project UI bridge, WASM manifest·binary. 기계 증거: `D:/build/pandolab-pages-editing-20261018-live.json`.
- 운영 Chromium에서 실제 배포 모듈과 WASM을 사용하여 경계 초안, 미리보기 복귀, 초안 Undo/Redo, 검색 입력의 네이티브 Undo, 접기, 적용, 프로젝트 Undo/Redo까지 확인했다. Undo 후 모델 갱신과 다시 실행 버튼 활성화 사이의 간격 때문에 테스트가 먼저 단축키를 보내던 문제는 버튼 활성화 대기로 수정했다.
- 라이브 전체 시나리오는 **완주하지 못했다**. 이후 데스크톱으로 크기를 복구하고 합병 탭을 클릭하는 단계에서 15초 시간 초과가 발생했다. 첫 시도에는 모바일 접기 입력 시간 초과도 있었다. 렌더러·반응성 문제의 원인이나 합병 라이브 검증 통과를 주장하지 않는다. 로컬 WebGL2/Canvas 및 네이티브 WebView에서의 기존 전체 시나리오 통과와 구분한다.
- main 작업 폴더의 기존 미추적 `reports/annex-reproduction-20261015.png`는 보존했으며 통합 전후 SHA-256이 `C7630499BE6105B03780FC1281AF97F965FE91EF21E0AA28D7F738823538E431`로 동일하다.

### 원격 CI 결과와 남은 검증

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| Pages | 성공 | [39111928319](https://github.com/kimjeon-il/Pando/actions/runs/39111928319) |
| P2 생성 산출물 | 성공 | [39111928501](https://github.com/kimjeon-il/Pando/actions/runs/39111928501). work/ui에 자동 커밋 `5ac823c7` 추가. main의 운영 릴리스와 구분 |
| P3 원격 검증 | 성공 | [39111928657](https://github.com/kimjeon-il/Pando/actions/runs/39111928657) |
| App 전체세계 Windows | 실패 | [39111928606](https://github.com/kimjeon-il/Pando/actions/runs/39111928606). 258/254/597 고정 개수 assertion. 이전 실행 [39007852586](https://github.com/kimjeon-il/Pando/actions/runs/39007852586)도 동일 조건에서 실패했으며 관련 stage·자료·workflow는 이번 릴리스에서 변경되지 않음 |
| P1 native-core | 실패 | [39111928612](https://github.com/kimjeon-il/Pando/actions/runs/39111928612). project_codec_tests의 documentId 기대값, document_session_tests의 seed 왕복 비교 assertion |
| Shared C++ 계약 | 실패 | [39111928329](https://github.com/kimjeon-il/Pando/actions/runs/39111928329). 9개 중 4개 실패: project_codec_tests, document_session_tests, web_territorial_command_tests, source_admission_tests |

C++ 실패 원인은 이 배포 작업에서 수정하거나 baseline 재현으로 확정하지 않았다. 전체 원격 CI가 통과했다고 보고하지 않는다. UI Architecture와 Application Architecture는 기록 시점에 실행 중이다. 원격 C++ 계약 실패 분석과 라이브 합병 전환 반응성 확인은 남은 검증이다. 실제 터치 기기 및 사람 대상 사용성 검증도 여전히 미실행이다.

이 절과 테스트 대기 수정은 후속 work/ui 기록이다. 운영 main에 추가 게시하지 않아 운영 커밋은 위 릴리스 SHA로 유지한다. 상설 브랜치·워크트리와 실행 증거를 보존한다.

## 판본

사용자 승인안을 구현하며 작성한 최초 검증 보고서. 과거 조사 보고서를 대체하지 않는다.
