# 웹 열람·앱 편집 분리와 휴대폰 가로 화면 검증

> 보고서 ID: `UI-PRODUCT-SPLIT-20261018` · 상태: `focused-verified / native-device-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-18  
> 원문 최종 수정: 2026-10-18  
> 조사 기준: 웹·앱 동일 `work/ui` HEAD `904a5cf6e797af3e055e2dcccbb16eb2ca0d93e0` + 미커밋 작업 사본  
> 원본·출처: 사용자가 승인한 구현 계획 및 추가 UI 지시, [실행 기록](../../../docs/superpowers/plans/2026-10-18-viewer-editor-split.md)

## 대상과 기준

기존 상설 `D:\dev\worktrees\ui`를 사용했다. 착수 전부터 있던 프로젝트 설정·타임라인·편집·C++ 변경은 보존했다. 자동 stash/reset, 분야 간 변경 이동, main 통합, 커밋·푸시·배포는 하지 않았다. 원래 작업 사본이 dirty였으므로 HEAD만으로 아래 결과를 재현할 수 없다.

웹과 Windows·Android 앱은 같은 C++/WASM 문서와 지도 렌더러·현재 GeoPackage 형식을 쓴다. 웹 시작점은 고정된 `viewer`, 앱 시작점은 고정된 `editor` 정책이다. URL/DOM/화면 크기/Tauri 검출로 편집 권한을 바꾸지 않는다.

사용자 추가 지시를 반영하여 웹은 기존 상단 파일·보기 메뉴, 하단 검색 도구, 정보창, 공통 UI 토큰과 스타일을 사용한다. 제목은 **판도연구소**이며 화면에 “뷰어” 또는 “읽기 전용” 배지를 두지 않는다. 보기 메뉴는 현재 편집기의 일반(상위·하위 객체), 지방, 지명, 강, 호수, 기타 객체, 분포 구성을 따른다. 별도 폐기 분류를 되살리지 않았다.

## 구현 범위

- 공통 문서 세션, 초기 프로젝트, 지도 테마, GeoPackage 읽기, 패키지 깃발 복원, 화면 좌표 클릭 판정을 기존 소유자에서 분리해 양쪽에서 재사용한다. 저장/가져오기 쓰기 경로는 앱에 남긴다.
- 웹에는 편집 도구·편집 DOM·저장·자동저장·Undo/Redo 서비스를 등록하지 않는다. Core 클라이언트와 고정 웹 Worker가 편집/이력/저장 요청을 `PL-PRODUCT-READONLY`로 거절한다. 공통 WASM 바이너리에는 기존 편집 기능을 유지한다.
- 파일 읽기와 C++ 검증 후 별도 후보를 준비한다. 지도 표시 성공 후만 교체하고, 실패·뒤늦은 결과는 이전 문서와 표시 상태를 복구한다. 렌더링 준비를 직렬화하여 이전 작업이 새 지도를 덮지 않게 했다.
- 웹 표시 상태는 문서와 별개다. 공통 스타일·유효기간·계층·지명/깃발 배치 규칙을 사용하고, 선택은 C++에 반영한 결과를 표시한다. WebGL과 Canvas Worker를 모두 사용한다.
- 현재 분포 직렬화에서 날짜 문자열 대신 네이티브 날짜 DTO가 나오던 오류를 `shared/core/src/projectcodec.cpp`에서 수정하고 같은 체크아웃의 WASM을 재빌드했다. 이전 형식 호환 분기는 추가하지 않았다.
- 앱은 `apps/web-shell/editor.html`을 직접 패키징한다. 웹 HTML의 bootstrap 치환 방식은 제거했다. 웹 자산은 정적 import와 검토한 동적 import/Worker/CSS 참조를 따라 수집하며, 누락이나 편집 실행 의존성은 실패시킨다.
- 휴대폰 가로 편집 UI는 기존 Surface Controller에서 오른쪽 패널 하나만 열고 최대 320 CSS px / 화면 폭 45%를 적용한다. 본문 스크롤, 안전 영역, 키보드의 가용 높이를 반영한다.
- Android 정본은 `apps/web-shell/src-tauri/android/`에 둔다. init/build에서 생성 프로젝트로 동기화한다. `smallestScreenWidthDp < 600 && !isInMultiWindowMode`에서는 양쪽 sensor landscape, 그 외에는 unspecified이며 create/resume/configuration/multiwindow에서 재평가한다. edge-to-edge와 target SDK 37을 유지했다. 대화면 제한을 우회하지 않는다. [Android 17 공식 정책](https://developer.android.com/about/versions/17/changes/ff-restrictions-ignored)

## 실행한 검사

전체 테스트 묶음은 실행하지 않았다. 서로 겹치는 회차의 테스트 수를 합산하지 않는다.

| 범위 | 실제 확인 |
| --- | --- |
| 읽기 전용 Core | 클라이언트 및 직접 Worker 요청 거절, payload 모드 전환 거절, 동일 WASM의 열기·조회·연월·선택·교체 허용. 변경 checkpoint와 Undo 상태 유지 |
| 실제 파일 읽기 | C++ export + 기존 GeoPackage byte writer로 생성한 현재 파일의 객체·형상·기간·속성 일치. 손상/미지원·취소·연속 요청 보존 |
| 표시 단위 검사 | 실제 C++ 문서로 계층 색상·숨김·Point/MultiPoint·고정 지명·분포 월말 유효기간/활성 레이어/값 범위 검증. 실제 published place bytes로 검색·시대별 이름·실패/재시도·세션 교체 검증 |
| 웹 PC/휴대폰 | `web-viewer.spec.mjs` 1280×800, 640×360 통과. 검색·투영·표시 토글·편집 단축키 후 checkpoint 유지. 최신 PC 회차에서 기존 localStorage 자동저장 값 보존 및 `pandolab-editor` IndexedDB 미접근 확인 |
| 웹 반응형 | `viewer-layout.spec.mjs` 390×844, 768×1024, 1024×768, 844×390 통과. 검색·정보창·패널 닫기·투영·크기 변경 후 문서와 C++ 선택 유지 |
| Canvas 대체 경로 | `viewer-canvas.spec.mjs` WebGL context를 차단하고 실제 파일의 폴리곤 본문 클릭. Core 선택 empty→A, 문서/변경 상태 불변 확인 |
| 앱 휴대폰 편집 | `phone-landscape-editor.spec.mjs` 실제 강 초안의 좌표/정점 선택, Undo/Redo, 패널 전환, 한글 입력, 키보드 높이, 회전 크기 변경, 카메라/초안 보존 통과. 844×390 및 640×360 |
| 앱 프로젝트 설정 | 현재 편집 HTML에서 프로젝트 설정 대표 브라우저 흐름 통과 |
| 앱 저장·복원 | 현재 형식의 실제 다운로드/재열기, 전체 객체·timelineRecords·geometries 일치, 속성 편집 Undo/Redo, IndexedDB 자동저장과 페이지 reload 복원 통과 |
| 앱 영토 편집 | `editing-state-recovery.spec.mjs`의 WebGL2 대표 흐름 통과. 정점 이동·초안 이력·취소·원자적 형상 확정·프로젝트 Undo/Redo에서 실제 좌표 복원과 선택 병합 초안 취소 확인 |
| 앱 지명 편집 | `label-metadata-edit.spec.mjs` 소형 현재 문서에서 실제 UI 생성→이름 수정→수도로 종류 변경 통과. 동일 객체 ID와 최종 이름/종류의 지도 표시 및 오류 부재 확인 |
| 패키징 | 최종 관련 Node 검사 19/19 통과. metadata/check-version/core prerequisite/대상 ESLint 통과 |
| Windows | 기존 GNU 툴체인으로 `cargo check --locked --offline --target x86_64-pc-windows-gnu` 통과. 기존 `storage.rs:86 unused_mut` 경고 |
| Android | 정본 재생성/동기화 Node 2/2, Kotlin 방향 정책 JUnit 4/4 및 MainActivity compile 통과. `:app:testArm64DebugUnitTest -x :app:rustBuildArm64Debug --no-daemon --max-workers=2` 및 `checkAndroidSources` 실행 |

최종 공통 Core source SHA는 `866ef5553afdd93ddf6ebd31293aaebc809512bcae08f2ffa72c153ffaa847cd`다. 최종 배포 버전 표기는 `0.36.0-build-904a5cf6e797`, 데이터 revision은 `data-1d70896e8c76322bd4df52bff683d4d8`이다. 빌드 이름의 HEAD가 미커밋 작업의 통합/배포를 뜻하지는 않는다.

## 산출물과 증거

작업 사본의 웹 배포 목록은 **2,148개 파일 / 121개 JS**다. `app.js`, `bootstrap.js`, 편집 Core/GIS Worker와 전체 편집기 `ui.bundle.css`가 없다. 공통 스타일 소유자로 만든 `ui-viewer.bundle.css`를 사용한다. 이 번들은 공통 패널 스타일을 재사용하며 편집 폼 전용 dialogs/workflows/color-picker 소스를 제외한다.

앱 스테이징은 기존 dist를 덮지 않는 별도 검증 경로에서 수행했다. small-project **917개 / 56,195,430바이트**, full-world **1,524개 / 151,577,467바이트**이며 동일 Core SHA를 확인했다. `full-world`는 현재 오프라인 자료를 포함하고 small-project의 자료 제외 제한을 유지한다.

- 앱 결과: `C:\Users\taeeu\AppData\Local\Temp\pandolab-product-final-20261018-Laj3xK\{small-project,full-world}\apps\web-shell\dist`
- 웹 작업 사본 결과: `C:\Users\taeeu\AppData\Local\Temp\pandolab-viewer-snapshot-1OOQBP`
- 기계 판독 증거: `.superpowers/product-stage-verification.json`
- [PC 화면](../../images/viewer-editor/existing-ui-1280x800.png), [휴대폰 세로](../../images/viewer-editor/current-390x844.png), [태블릿 세로](../../images/viewer-editor/current-768x1024.png), [태블릿 가로](../../images/viewer-editor/current-1024x768.png), [앱 휴대폰 가로 초안](../../images/viewer-editor/phone-landscape-editor.png)

Pages CI용 staging은 커밋된 트리만 읽는 기존 무결성 계약을 유지한다. 현재 dirty 작업을 커밋된 배포라고 표현하지 않는다. 작업 사본의 웹 배포 목록만 복사한 디렉터리를 별도 포트에서 제공하고 `viewer-canvas.spec.mjs`와 `viewer-project-open.spec.mjs` 2/2 통과를 확인했다. 최종 지형 URL 연결 수정 후 해당 산출물의 Canvas 선택 검사도 다시 통과했다. 소스 서버가 아닌 웹 산출물에서 Worker·동적 모듈·WASM·파일 읽기가 정상 로드된 증거다.

## 한계와 미검증

- Android 기기/에뮬레이터가 연결되어 있지 않았다(`adb devices -l` 빈 목록). 세로 상태 실행, 양쪽 실제 회전, 백그라운드/파일 선택기 복귀, 태블릿·폴더블·멀티윈도 실제 OS 동작은 **미검증**이다. 브라우저 크기 변경을 이 검증의 대체로 취급하지 않는다.
- Windows 네이티브 창, Android 전체 Rust/APK 빌드와 설치 실행은 하지 않았다. 편집 UI 브라우저 테스트와 native compile/check를 구분한다.
- 실제 OS IME·물리 뒤로 가기·노치 장치 검증은 남아 있다. 브라우저에서 가용 높이·Surface 전환·Escape/닫기와 초안 유지만 확인했다.
- 전체 내장 지도를 사용한 지명 종류 변경 검사에서는 8초 단언 제한 시점에 Core 응답이 대기 중이었다. 별도 Chromium 실행에서는 이름/종류 변경 응답과 표시 성공을 확인했지만, 시간 초과가 난 실행의 최종 응답이나 전체 지도 편집 지연 시간을 검증했다고 주장하지 않는다. 속성 회귀 검사는 현재 Core 문서 팩터리로 만든 소형 프로젝트에 분리했다.
- 기존 UI 정적 검사 실패는 남아 있다. components는 기존 7개 버튼의 ui-button 누락, architecture는 기존 프로젝트 설정/타임라인/편집 보조 CSS 46건이다. 이번 휴대폰 CSS가 추가했던 12건은 토큰 사용으로 해소했다. [분리 로그](/D:/dev/release-evidence/PandoLab/branch-cleanup-20261021/files/main/reports/images/viewer-editor/ui-architecture-baseline.log)
- 이전 전체 Core WASM 검사에서 기존 dirty 편집 상태의 `editorState.lastViewedMonth` 기대값 2건, 다른 preferences/focus fixture 및 브라우저 lint의 기존 실패가 확인됐다. 관련 범위를 넘어 기대값을 무작정 완화하거나 전체 테스트 통과로 보고하지 않았다.

## 데이터 반영과 판본

지도 형상을 새로 조사하거나 GIS 데이터를 변경한 작업이 아니다. 역사 형상의 0.5px 정확도 검증은 수행하지 않았다. main 통합·배포는 범위 밖이며 아직 하지 않았다. 이 보고서는 해당 작업 사본의 개발 검증 기록이다.

> 2026-10-21 정리 후속: 이 문서에서 언급한 완료된 작업의 일부 원시 증거는 외부로 옮겼다. 작성 당시의 결과는 변경하지 않았다. [브랜치별 원래 경로·SHA-256·보관 목록](/D:/dev/release-evidence/PandoLab/branch-cleanup-20261021/main-archive.json).
