# 지도 표시·UI 검사 정리와 웹·Windows 게시 검증

> 보고서 ID: `UI-MAP-SCALE-RELEASE-20261020` · 상태: `pages-live-verified / windows-native-verified / separate-ci-failures` · 지도 반영: `not-applicable` · 색인일: 2026-10-20
>
> 원문 최종 수정: 2026-10-20
>
> 조사 기준: 소스 `1fd837329837`·`5342dd4f1025`·`4bcd15a19f55`, 최종 게시 자산 `6cdec40b549acccf23a8583c4ba531c8aac1b44a` (검색 헤더 `c0242d78abea`, 공통 메뉴 모서리 `908691ea4df8`)
>
> 원본·출처: [구현과 로컬 검증](map-scale-readiness-2026-10-20.md), `.superpowers/sdd/map-scale-release-20261020/` 실행 근거

## 대상과 기준일

사용자가 UI 검사 잔여 실패 수정, `work/ui → main` 통합, 웹 Pages 배포와 기존 Windows 실행 파일 갱신을 승인했다. 기준 main은 `8cb2883e4bd09ba014965b3ce7bec1d5770c1b33`이다. 기존 UI 브랜치의 검색·메뉴·반응형 개선과 지도 품질·준비 판정 변경을 통합 대상으로 삼는다. GIS 원본 자료와 시간 기록은 이번 변경 대상이 아니다.

## 근거와 방법

검색창의 CSS 기본값 `0px` 두 곳은 동등한 `0`으로 정리했다. 추가 UI 묶음 검사에서 발견한 범위 선택창의 인라인 좌표 스타일은 CSS 사용자 속성으로 분리했고, 두 편집 버튼에 공통 `.ui-button` 계약을 적용했다. 실제 범위 드래그에서는 지도 입력 컨트롤러가 포인터를 가져가는 기존 오류를 재현했다. 기존 입력 판정에서 범위 선택창을 조작 대상으로 인식하도록 수정하고, 사각형 크기·지도 이동 없음·취소 후 프로젝트 보존을 회귀 검사했다.

원격 push, Pages workflow, 실제 사이트 파일과 동작, 네이티브 빌드와 실제 WebView2 실행은 각각 확인한다. 브라우저 검사를 네이티브 실행 증거로 취급하지 않는다. 실행 파일은 설치 패키지나 ZIP 대신 기존 `apps/web-shell/run-windows.bat` 경로의 GNU debug EXE를 갱신한다.

## 확인 결과와 한계

- `pnpm.cmd check:ui` 전체 통과: spacing, components, architecture, layering, information architecture, object registry, surface state. 포함 단위 검사는 객체 레지스트리 4개와 surface state 14개이다.
- 지도 표시 집중 단위 검사 65개와 지도 입력 단위 검사 13개 통과. 범위 선택 CSS/입력 변경에 대한 ESLint 통과.
- 로컬 브라우저 지도 3개·검색 4개 통과. 범위 선택 포인터 소유권·취소 보존 회귀 검사 1개도 통과했다. 별도 읽기 전용 최종 검토에서 추가 P1/P2가 발견되지 않았다.
- 실제 WebView2의 후속 검색 포커스 검사에서 화면 전환 중 잠깐 숨겨지는 패널이 input을 blur시키는 문제를 재현했다. 일반 고정 input 대조군은 같은 전환에서도 포커스를 유지했으며, 검색 input blur 시점의 computed visibility는 hidden이었다. 기존 `applyLayoutMode`에서 열린 패널 클래스를 적용한 뒤 `data-layout`을 공개하고 검색 스타일을 먼저 동기화하도록 순서만 바꿨다. 별도 포커스 관리자나 상태를 추가하지 않았다.
- 패널 애니메이션 종료 후 포커스와 blur 0회를 확인하도록 검색 브라우저 회귀 검사를 강화해 4개가 통과했다. 관련 단위 검사 16개와 ESLint도 통과했다. 실제 WebView2에서 수정 모듈만 대체한 실험도 통과했으나, 이는 최종 EXE 검증과 구분한다(`native-focus-patch.log`).
- 초기 Pages staging은 UI 후속 수정으로 CSS가 바뀌어 committed-byte 검사에 걸렸다. 다음 시도도 원격 생성 봇의 metadata 반영과 겹쳐 index.html 검사에서 중단됐다. 두 시도는 게시하지 않았으며, 최종 커밋을 고정한 새 경로의 재검증이 통과했다.
- 최종 Windows 실행 결과는 아래에 별도로 기록했다.
- 독립 역사 형상 검증, 새로운 단순화 자료의 0.5 CSS px 검증, 실제 휴대전화·Android·실사용자 사용성 검증은 수행하지 않았다.

## 통합·웹 배포

`main`은 `8cb2883e → 54ac9e8f` fast-forward로 반영하고 원격 push했다. 원격 P2 자동 생성 결과 `54ac9e8f`도 포함했으며 build ID는 `0.36.0-build-c52aabb406ed`이다. 해당 봇 커밋이 `[skip ci]`이므로 Pages를 명시적으로 workflow_dispatch했다.

[Pages 실행 39419821475](https://github.com/kimjeon-il/Pando/actions/runs/39419821475)의 head SHA는 `54ac9e8f1c55b82a790374072d5d7468850f9efa`이며 build·deploy가 모두 성공했다. 로컬 staging과 CI의 evidence artifact에 있는 1,400개 파일, 133,377,616바이트의 경로·길이·SHA-256을 전부 비교해 일치했다. 앱 소스 104개와 공통 C++ 소스 173개는 게시 대상에서 제외됐다.

실제 [운영 웹](https://kimjeon-il.github.io/Pando/)에서 변경된 공개 파일 32개의 HTTP 200·committed-byte SHA-256 일치를 확인했다. 전체 공개 파일을 실제 사이트에서 다시 내려받아 비교한 것은 아니다. 근거: `pages-publication-preflight.log`, `pages-manifest-result.json`, `live.log` 및 외부 evidence 경로 `D:/Codex/evidence/map-scale-release-20261020-54ac9e8f/`.

운영 보기 화면에서 PC 1440×900·모바일 390×844 각각 700→570→500→570→700 CSS 배율을 왕복하며 전환 구간 이력 유지와 정밀 형상 사용을 확인했다. 첫 PC 두 표본은 실제 지형 준비 중이었고, 나머지 여덟 표본은 해당 화면 준비 완료였다. PC↔모바일 전환 후 `독일` 검색 입력과 포커스가 보존됐고 pageerror는 없었다. `live-result.json`, `live-desktop.png`, `live-mobile.png`에 기록했다. 실제 휴대전화 검증은 아니다.

첫 운영 프로브는 편집기 전용 진단 API를 잘못 참조해 120초 후 실패했다(`live-editor-api-failure.log`). 제품 코드를 수정하지 않고 기존 보기 화면 진단 API `__PANDOLAB_VIEWER__.rendererStats()`로 프로브를 고쳐 위 시나리오가 통과했다. 이 프로브 오류를 사이트의 초기 로딩 실패로 보고하지 않는다.

### 포커스 수정 후 중간 게시

`54ac9e8f → 3f8f1b4b`도 main에 fast-forward·push했다. 해당 중간 판본의 build ID는 `0.36.0-build-4bcd15a19f55`다. [Pages 실행 39422638004](https://github.com/kimjeon-il/Pando/actions/runs/39422638004)의 head는 `3f8f1b4b06a72a670d1b69d8aa7d418de333b14b`이며 build·deploy가 모두 성공했다.

이 중간 판본의 CI staging은 1,400개 파일, 133,377,764바이트다. 앞선 로컬 기준과 달라진 공개 파일 3개는 최종 Git blob과 직접 비교했고, 나머지 1,397개는 기존 검증 기준과 SHA-256·길이가 일치했다. 최종 전체 로컬 staging을 다시 실행한 결과로 표현하지 않는다(`pages-final-manifest-result.json`).

이 중간 판본의 운영 웹에서도 변경 공개 파일 32개의 HTTP 200·SHA-256 일치, PC·모바일의 배율 왕복·정밀 형상 유지·검색 입력 보존이 통과했다. 이번에는 패널 전환 애니메이션이 끝난 뒤에도 포커스가 유지되고 blur 이벤트가 0회임을 추가 확인했다. pageerror는 없었다(`live-final.log`, `live-result.json`, 최종 두 스크린샷).

앞선 P3 실행 39418976332는 새 `map-scale-readiness.spec.mjs`의 검사 레지스트리 누락으로 web-contracts 계획 단계에서 실패했다. 기존 rendering 그룹에 등록하고 전체 검사 목록 생성이 성공하는지 확인했다(`final-check-plan.json`). 최종 P1/P3 실행 39422592812·39422592848은 성공했다. P3는 계획만 실행하고 네 검증 job이 미선택됐으므로 이를 전체 원격 회귀 통과라고 표현하지 않는다. main의 별도 Application Architecture와 C++ workflow 결과는 완료 상태를 따로 확인하며 Pages 성공에 합산하지 않는다.

### 검색·보기 수정 최종 게시

`3f8f1b4b → 6cdec40b`를 main에 fast-forward·push했다. build ID는 `0.36.0-build-908691ea4df8`이다. [Pages 실행 39427395265](https://github.com/kimjeon-il/Pando/actions/runs/39427395265)의 head는 `6cdec40b549acccf23a8583c4ba531c8aac1b44a`이며 build·deploy와 workflow 전체가 성공했다. CI staging 1,400개 파일, 133,377,935바이트 중 기준 판본과 달라진 공개 파일 4개는 최종 Git blob과 직접 해시 비교했고, 나머지 1,396개는 앞서 로컬·CI 전체 일치를 확인한 기준과 SHA-256·길이가 같았다. 최종 전체 로컬 staging 재실행과 구분한다. 외부 근거는 `D:/Codex/evidence/map-scale-release-20261020-6cdec40b/remote-evidence/`, 비교 결과는 `pages-final-manifest-result.json`이다.
최종 운영 WebGL 프로브의 첫 실행에서는 배율·검색 검사가 끝난 뒤 보기 버튼 click이 30초 후 시간 초과했다(`live-webgl-menu-timeout.log`). 이 시도는 메뉴 검사 통과로 계산하지 않는다. 두 번째 시도는 검색 위치 poll의 5초 제한에서 시간 초과했다(`live-menu-rerun.log`). 동일 운영 사이트의 Canvas 경로에서 실제 메뉴 조작을 별도 검사하며, 네이티브 WebView2의 WebGL 결과도 구분한다.

최종 재검사는 지도와 UI의 실행 경로를 구분했다. 실제 운영 WebGL에서 PC·모바일 크기 각각 배율 700→570→500→570→700의 high→high→low→low→high와 canonical geometry를 확인했다. 준비 상태는 첫 두 표본이 terrain 준비 중이고 나머지 여덟 표본은 ready였다(`live-webgl-result.json`). 이후 같은 배포본의 `?debug=1&renderer=canvas`에서 검색 헤더 숨김·입력 위치·입력/포커스 유지·blur 0회, 보기 메뉴 네 모서리 9px·공통 파일 메뉴와 일치·실제 하위 메뉴 hover를 확인했다. pageerror는 없었고 변경 공개 파일 32개의 HTTP 200·SHA-256도 모두 일치했다(`live-split-final.log`, `live-result.json`). 메뉴 스크린샷을 직접 확인했다. Canvas 화면의 지도 준비 완료를 검사한 결과는 아니며, WebGL UI 시간 초과 두 건이 해소됐다고 주장하지 않는다. 실제 WebView2에서는 동일 UI를 WebGL2로 별도 통과했다.
## 기존 UI 정비 방향을 유지한 검색·보기 수정

후속 Windows 스크린샷에서 PC 검색창의 모바일용 제목이 표시되어 입력칸이 툴바 아래로 밀리는 문제를 확인했다. `surfaces.css`의 wide/compact 공통 헤더 선택자에서 기존 `.search-toolbar-desktop`을 제외했다. 같은 검색 DOM과 모바일 패널 구조를 유지하며, PC 헤더 숨김·실제 입력칸과 툴바의 상단 오차 2px 미만·화면 전환 후 blur 0회를 확인하는 검색 브라우저 검사 4개가 통과했다.

사용자가 지적한 보기 메뉴의 직각 모서리는 `.workspace-surface`의 기본 paint가 공통 `.ui-menu-surface`의 radius를 덮어서 발생했다. 공통 workspace의 배치·상태·전환 규칙은 유지하고, border/radius/background/shadow만 메뉴가 아닌 surface에 적용했다. 별도 메뉴 DOM·상태나 이전 UI 경로를 복원하지 않았다. editor와 viewer 모두 공통 파일 메뉴와 같은 네 모서리, 실제 하위 메뉴 조작, 모바일 상단 둥근 모서리·하단 직각, 설정 보존을 검사해 2개가 통과했다(`view-menu-canvas-final.log`). UI 전용 흐름은 두 화면 모두 Canvas에서 검사했고, 운영 WebGL 검증과 구분한다. 실제 변경 전·후 스크린샷도 확인했다.

최종 `pnpm.cmd check:ui`와 관련 ESLint는 통과했다(`menu-ui-final.log`, `menu-lint-final.log`). 최종 읽기 전용 검토에서 P1/P2는 발견되지 않았다.
## Windows 실행 파일

full-world 프로필로 최종 소스 `6cdec40b`를 staging했다(1,720개 파일, 173,880,148바이트, 258개 source entities). GNU dev 빌드가 7분 13초에 완료됐다. 기존 `storage.rs:86`의 unused_mut 경고 하나가 있으며 오류는 없었다. 결과를 기존 `D:/dev/PandoLab/apps/web-shell/src-tauri/target/x86_64-pc-windows-gnu/debug/`에 복사하고 원본·대상 EXE와 DLL의 SHA-256 일치를 확인했다.

| 파일 | 바이트 | SHA-256 |
| --- | ---: | --- |
| `pandolab-web-shell.exe` | 369,840,968 | `4FCE9C6F77AC199CDF215BCA023571D7DA0E2724917AA0ADDD09E312B4FA2108` |
| `WebView2Loader.dll` | 160,880 | `86545B66CDB0603BC26B626FB9AD610CB6E71F28D468F5EA66DF23B03DDA96D5` |

기존 `apps/web-shell/run-windows.bat`를 새 격리 WebView2 프로필로 실행했다. 빌드 ID `0.36.0-build-908691ea4df8`, full-world 런타임 12개 항목이 모두 통과했다. source 258·모델 254·sovereign roots 207개, WebGL2·정밀 삼각형 1,501,543개·활성 WebGL context 1개·차단 요청 0개를 확인했다. 실제 Core와 data-loader Worker 실행도 포함한다.

PC 1440×900·모바일 390×844 크기 각각 S=700→570→500→570→700에서 high→high→low→low→high, canonical geometry, 실제 프레임 준비 완료 10개를 확인했다. 앱의 지형 레이어가 꺼진 상태이며 꺼진 레이어는 완료 조건에서 제외된다. 실제 터치 장치나 Android에서 실행한 것은 아니다.

검색 입력·포커스 유지와 blur 0회, PC 검색 헤더 숨김, 툴바와 입력칸 상단 오차 2px 미만, 입력 중심 hit-test를 확인했다. 보기 메뉴 네 모서리는 파일 메뉴와 동일한 9px이고 실제 hover로 하위 메뉴가 열렸다. 실행 중인 JS 네 모듈과 `ui.bundle.css`의 포함 바이트가 최종 소스와 일치했고 pageerror는 없었다. `native-menu-validation.log`, `native-result.json`, `native-copy.json`, `native-desktop.png`, `native-view-menu.png`가 근거다. 스크린샷도 직접 확인했다. 검사 후 이 작업에서 실행한 앱만 정상 종료했다.

앞선 `3f8f1b4b` 실행 파일의 검색 헤더 스크린샷은 실패 재현 근거로 별도 보존했다. 이를 최종 UI 통과 증거와 혼동하지 않는다. 소스 모듈 override 실험도 최종 실행 파일 검증에 사용하지 않았다.

## 별도 원격 CI 결과

[Shared C++ core 실행 39422638063](https://github.com/kimjeon-il/Pando/actions/runs/39422638063)은 9개 CTest 중 7개 통과·2개 실패다. `web_content_command_tests`는 `web-content-command-tests.cpp:22`의 apply assertion, `web_territorial_command_tests`는 `web-territorial-command-tests.cpp:85`의 frozenStaticAndMonthCollisionGoldens 직렬화 기대값에서 실패했다(`core-ci-failure.log`). 기준 `8cb2883e`와 검사 판본 `3f8f1b4b` 사이에 `shared/` 변경은 없었다. 이번 UI 집중 검증이나 Pages 성공과 합쳐 전체 CI가 통과했다고 보고하지 않는다. 별도 기준 판본에서 재실행해 실패를 재현한 것은 아니다.

[Application Architecture 실행 39422638022](https://github.com/kimjeon-il/Pando/actions/runs/39422638022)는 changes job 통과 후 checks job 실행 중 취소되어 최종 상태가 cancelled다. 취소된 원격 검사를 통과로 보고하지 않는다.

## 데이터 반영과 판본

지도 데이터 반영은 `not-applicable`이다. data revision은 `data-a5bfe87f5918aef45488cd5a4f8dbe1d`를 유지한다. 이 문서는 `UI-MAP-SCALE-20261020`의 통합·게시 후속 기록이며, 당시의 미게시·small-project 검증을 소급 변경하지 않는다. 관련 없는 native 권한 설명·portability fixture·다른 단위 검사 및 미추적 파일은 커밋에 포함하지 않았다.
