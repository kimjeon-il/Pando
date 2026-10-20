# UI 공통 규칙 통합 P0 — 구조·상태·회귀 기준 조사

> 보고서 ID: `UI-CONVERGENCE-P0-20261020` · 상태: `source-audited / focused-runtime-baseline-not-rerun` · 지도 반영: `not-applicable` · 색인일: 2026-10-20  
> 원문 최종 수정: 2026-10-20  
> 조사 기준: 웹 `8cb2883e4bd09ba014965b3ce7bec1d5770c1b33` / Tauri WebView 앱 `8cb2883e4bd09ba014965b3ce7bec1d5770c1b33` (`work/ui`; 조사 시작 시 `main`과 동일)  
> 원본·출처: `ui/templates/`, `ui/fragments/`, `assets/js/modules/`, `assets/css/`, `tests/browser/`, `tests/unit/`, `docs/architecture/ui-architecture.md`, `docs/architecture/ui-components.md`  
> 본 단계: 코드 변경 **없음**. P1–P6 구현 전에 기존 구조와 기능 보존 계약을 동결하기 위한 읽기 전용 소스 조사.

## 1. 대상과 판단 기준

2026-10-20 기준 최신 웹(viewer)과 WebView 기반 Tauri 편집 앱(editor)을 조사했다. **구 Qt 앱은 대상이 아니다.** 웹 진입점은 `ui/templates/web.html` → 생성물 `index.html`, 앱 편집 진입점은 `ui/templates/editor.html` → 생성물 `apps/web-shell/editor.html`이다. 공통 스타일은 `scripts/lib/ui-source-catalog.mjs`가 등록한 원본으로 구성하고 `scripts/build-ui-bundle.mjs`가 웹/앱 CSS bundle을 생성한다. 향후 수정에서 생성 HTML/CSS만 직접 고치지 않는다.

공통 계약은 `docs/architecture/ui-architecture.md`와 `docs/architecture/ui-components.md`를 우선한다. **상태 단일 소유, 고정된 DOM 및 단일 핸들러를 우선하되, 실사용 기능이 동일하지 않은 구조를 무조건 같은 DOM으로 바꾸지 않는다.** 지오메트리·저장·Core 명령·Undo 계산은 본 계획 범위 밖이다.

등급: **확정**=현행 소스에서 직접 확인 / **후보**=구조 통일 가능성만 확인, 구체 대체안은 실동작 검증 필요 / **미검증**=새 브라우저/네이티브 실행을 수행하지 않은 조건.

| ID | 대상 | 현행 구조 문제 및 확정 근거 | 단일 상태·이벤트 소유자 | 제안 단계 / 위험 |
| --- | --- | --- | --- | --- |
| U01 | 객체 작업 컨텍스트 메뉴 | `objectActionsMenu`가 `ui-row-button`을 사용하고 `menus.css` 58–99행에서 공통 메뉴 행의 패딩·호버 등을 재구현. 별도의 위치 계산도 존재 | `app-object-commands.js`(열림/선택/위치), `property-editor-bindings.js`(클릭/키보드) | P1 / 낮음–중간 |
| U02 | 새 프로젝트 생성 대화상자 | 자체 `<dialog>` + `project-setup-dialog`, `dialogs.css` 430행에서 크기·색상·포커스 표시를 별도 정의 | `project-setup-dialog.js`(폼/범위), `project-ui-bridge.js`(생성/확인), ProjectDomain(실제 저장) | P1 / 중간 |
| U03 | 환경설정 대화상자 포커스 | `preferences-dialog.js` 43–50행과 `dialog-accessibility-controller.js` 86–109행에 Tab 순환 로직이 중복 | `preferences-dialog.js`(미리보기/적용·취소), `dialog-accessibility-controller.js`(공통 포커스) | P1 / 중간 |
| U04 | 검색 패널 | `search-toolbar-presentation.js` 3–26행에서 패널을 주석 anchor↔도구바 사이 재부모화. `map-search.css` 135–183행에서 기본 surface 외형 재정의 | `surface-controller.js`(열림), `object-search-controller.js`(검색), `search-toolbar-presentation.js`(현재 배치) | P2 / 중간–높음 |
| U05 | 휴대전화 가로 UI | `editor-shell.css` 1312–1439행이 panel 배치와 skin(배경·테두리·그림자), 모바일 내비게이션을 함께 선언. 1310행에는 원시 색상과 `!important`도 존재 | `workspace-layout.js`(모드), `surface-controller.js`(열림), 공통 `surface` CSS | P2 / 중간 |
| U06 | 편집기 삭제 버튼 | `object-property-controller.js` 112–119행이 `editorDeleteSection`을 객체 유형에 따라 action list나 scroll body로 이동 | `app-object-commands.js`(선택·삭제 가능/잠금), `object-property-controller.js`(배치) | P3 / 중간 |
| U07 | 지도 편집 작업창 | `editor-workspace-presentation.js` 12–40행이 `modeEditingContext`를 `floatingSlot`↔`editorTaskSlot` 사이 이동, 포인터 동작 중 전환 보류 | 편집 작업/도메인(실제 상태), `editor-workspace-presentation.js`(표시), `workspace-surfaces.js`(surface 열림) | P3 / 높음 |
| U08 | 참조 이미지 Surface | `reference-image-ui.js`가 패널 마크업을 동적으로 만들고 `reference-image-surface.js` 8–70행이 공통 클래스/헤더/손잡이/본문을 후처리. `reference-image-bootstrap.js`는 전용 CSS 네 장을 지연 주입하고 패널·런처 초기 배치 이동 | `reference-image-controller.js`(데이터·기능), `reference-image-surface.js`(surface 표시), `workspace-surfaces.js`(공통 시트) | P4 / 높음 |
| U09 | 참조 이미지 선 보강·자동 추적 버튼 | `reference-image-line-refine-controller.js` 252–265행 / `reference-image-live-wire-controller.js` 312–329행에 같은 '작업버튼 요약영역↔편집영역' DOM 이동 로직 중복 | 두 도구 컨트롤러(각 상태/명령), `reference-image-surface.js`(공통 요약·actions) | P5 / 높음 |

위 항목은 구조적 불일치 또는 중복의 확인이다. **정상 기능이 고장났다고 판정하지 않는다.**

## 2. 항목별 현행 동작과 변경 금지 계약

### U01 객체 컨텍스트 메뉴

- 원본: `ui/templates/editor.html` 506행; `assets/css/components/menus.css` 58–99행; `assets/js/modules/app-object-commands.js` 189–314행; `assets/js/modules/property-editor-bindings.js` 155–165행.
- 현행 동작: 선택한 객체의 '선택 객체로 이동' 항목 활성 여부 결정, 열기·다시 누르면 닫기, 화면 경계 안에 위치 보정, 열릴 때 첫 항목 포커스, Escape 복귀, 위/아래 방향키 이동.
- 보존: 선택된 객체만 이동 가능, 메뉴 외부 클릭/레이아웃 변경 시 닫힘, 표시 가능한 위치·높이·포커스가 변하지 않을 것. 삭제 명령/잠금 규칙은 메뉴 표현 통합과 분리.
- 대체 설계 검토: `ui-menu-list`/`ui-menu-item` 사용, 위치는 기존 `menu-presentation.js`의 위치 함수 재사용 가능성을 비교. 기존 수동 `left/top` 계산 삭제 여부는 위치 동등성 확인 후 확정.

### U02 프로젝트 생성

- 원본: `ui/templates/editor.html` 686–695행; `assets/css/components/dialogs.css` 430행; `assets/js/modules/project-setup-dialog.js`; `assets/js/modules/project-ui-bridge.js`.
- 현행 동작: 네이티브 `showModal()/close()`, '연·월'·기원전 시점 입력, 연도 0 거부, 탐색 기간 제한, 전 세계/현재 지도/직접 지정 범위, 내장 지도/빈 지도 선택, 미저장 작업 확인 후 생성. 지도 범위 지정 중 일시적으로 dialog를 닫고 지도 위 입력을 받음.
- 보존: HTML `<dialog>`의 top layer와 기본 Escape/포커스 계약, 범위 지정 취소 시 dialog 복귀, 잘못된 입력에서 프로젝트 불변, 실제 생성/파일 저장 시 범위·시점·원본 보존.
- 대체 설계 검토: **네이티브 dialog를 가짜 `div` 모달로 치환하지 않는다.** 공통 `ui-dialog-card`·field·actions 시각 계약을 적용하면서 native modal 동작을 보존. focus 중복 제어는 U03 및 공통 접근성 컨트롤러와 연결 검토.

### U03 환경설정 모달 포커스

- 원본: `assets/js/modules/preferences-dialog.js` 18–51행; `assets/js/modules/dialog-accessibility-controller.js` 10–109행; `assets/js/modules/app-file-bindings.js` 45–50행; `assets/js/modules/viewer-composition.js` 142–143행.
- 현행 동작: 미리보기 즉시 적용, '취소/Escape/배경 클릭' 원상 복귀, '적용' 저장, 호출 주체별 포커스 복귀. 공통 컨트롤러도 열린 dialog의 Tab 범위를 제한함.
- 보존: 취소에서 미리보기 취소, 적용에서 확정, Tab/Shift+Tab 이동, 커스텀 색상 팝오버·select가 열린 경우 별도 상호작용, 웹 및 앱 각각의 트리거로 복귀.
- 대체 설계 검토: 포커스 trap과 복귀 소유자를 한 곳으로 합치되, 환경설정만의 **일시적 preview 롤백** 경로는 유지. 단순히 해당 `keydown` 핸들러 전부 삭제해서는 안 됨.

### U04 검색창

- 원본: `assets/js/modules/search-toolbar-presentation.js` 1–55행; `assets/css/components/map-search.css` 114–183행; `assets/js/modules/workspace-surfaces.js` 468–483행; `ui/fragments/object-search.html`.
- 현행 동작: 데스크톱 도구바 확장형 입력/위쪽 검색 결과 목록, 모바일 하단 시트와 공통 검색 상태. 검색 입력 포커스 복원, viewport 경계에서 결과 높이 제한, 검색 중 입력·한글 IME 조합 중 레이아웃 변경 보류.
- 보존: **하나의 `objectSearchInput` 및 결과 데이터/선택**, 단일 검색/선택 이벤트, 결과 선택 후 지도 이동, 화면 폭 전환 시 입력값·포커스·스크롤 보존, 자동 크기조절·중첩 z-order 유지.
- 기술적 검토 게이트: panel을 toolbar 하위에서 제거하면 CSS absolute positioning 기준과 `ResizeObserver` 계산이 달라진다. **고정 DOM host + overlay 배치만으로 실제 도구바와 일치하는지** 먼저 검증. CSS `display: contents`만 추가하는 해법은 스크롤/포커스가 동일하다는 증거 없이 사용하지 않음.

### U05 가로 화면

- 원본: `assets/css/components/editor-shell.css` 1310–1439행; `assets/js/modules/workspace-layout.js` 1–15행; `assets/js/modules/surface-controller.js` 123–159행; `assets/css/layout/surfaces.css`.
- 현행 동작: 터치·짧은 가로 화면을 `phone-landscape` 모드로 선정, 오른쪽 단일 도킹 패널, 왼쪽 세로 내비, 가용 지도 영역 보전, 모바일 시트와 별도 손잡이 배치/키보드 처리.
- 보존: 오른쪽 패널 폭 제한, 화면 키보드/회전 후 모드·지도 카메라·미완료 draft 유지, 표/입력 폭 및 터치 가능 영역, 이동 중 편집 제스처 무손실.
- 대체 설계 검토: 단일 외형 소유자 유지; 레이아웃은 `layout/surfaces.css`, visual skin은 기존 공통 components로. 1310행의 `!important`·하드코딩 색상은 시각 동등성 검증 대상. 가로 모드를 단순한 세로 모바일 시트로 바꾸지 않음.

### U06 삭제 버튼

- 원본: `ui/templates/editor.html` 443행; `assets/js/modules/object-property-controller.js` 92–124행; `assets/js/modules/app-object-commands.js` 202–264행.
- 현행 동작: entity 화면에서 해안선 편집 항목 다음으로 삭제 섹션 이동, 그 밖의 유형은 편집 본문으로 이동. 선택 수·잠금·내장 지명·수계 여부에 따라 비활성 및 안내 변경.
- 보존: 단일 `objectDeleteBtn`과 확인/실행 명령, 잠금·복수 선택·내장 지명 제한, 삭제 후 선택·Undo/Redo. **entity/다른 유형의 화면 내 액션 순서와 가시성**을 회귀 기준으로 비교.
- 대체 설계 검토: 고정된 공통 위험 작업 영역 1개가 모든 편집 타입·스크롤 위치에서 접근 가능한지 측정한 뒤 DOM 이동 제거.

### U07 지도 편집 작업창

- 원본: `ui/templates/editor.html` 132–220행, 244–245행; `assets/js/modules/editor-workspace-presentation.js` 1–60행; `assets/js/modules/workspace-surfaces.js` 419–428행.
- 현행 동작: 동일 `modeEditingContext`가 지도 맥락 영역과 편집기 `editorTaskSlot`을 오간다. 작업 활성화 시 편집기 열림, 작업 종료 시 속성 모드 복귀, pointerdown/up/cancel·blur 중 이동 지연, 필요 시 지도 크기 재계산.
- 보존: 작동 중인 편집 핸들러와 작업 단계, 대상/기준점/정점·Undo/Redo, 작업 최소화, 포인터 제스처, 작업 종료 후 속성 패널 상태·기존 열림 상태.
- **테스트 계약 충돌 확인**: `tests/unit/editor-workspace-presentation.test.mjs` 55–108행과 `tests/browser/editor-workspace.spec.mjs` 34–69행은 DOM 재부모화 자체를 기대한다. P3에서는 사용자가 보는 결과/포커스/작업 상태로 이 테스트들을 수정해야 하며 테스트 삭제만으로 완료 처리 금지.
- 기술적 검토 게이트: DOM 부모를 고정하면서 오른쪽 편집기 안으로 접근 가능한 UI를 그릴 수 있는지 `overflow`/focus/overlay를 실제 브라우저에서 확인. 불가능한 방식이라면 중복 DOM·중복 상태로 회피하지 말고 단일 소유 위치 설계를 재검토.

### U08 참조 이미지 Surface

- 원본: `assets/js/modules/reference-image-ui.js` 42–75행; `assets/js/modules/reference-image-surface.js` 8–70행; `assets/js/modules/reference-image-bootstrap.js` 1–55행; `assets/css/layout/reference-images.css` 1–130, 302–374행; `assets/css/components/reference-images.css`.
- 현행 동작: Lazy mount, 사용자 이미지 목록/선택, 오른쪽 도킹 폭 조절과 접기, 모바일 snap 시트, 보정 중 별도 간단 요약·취소·완료, 이미지 원본 Blob 및 뷰·메타데이터 보존.
- 보존: **별도 이미지 도구 지연 로딩** 및 이미지 목록 데이터, 상태·이력/Undo·저장, 데스크톱 고정 폭/지도 영역 축소, 모바일 320·390px, 가로 화면 640×360/844×390, 손잡이·키보드 스크롤·포커스.
- 대체 설계 검토: 생성 초기부터 `workspace-surface → surface-header → surface-body → footer/요약` 구성을 완성해 후처리 wrapper를 줄일 것. 초기 mount에서 패널을 `map`→`workspace`로 한번 이동하는 것도 함께 검토. Lazy CSS 4개는 **지연 로딩 자체를 제거하지 않고** 소유권·충돌·중복 선언을 먼저 판정.

### U09 참조 이미지 선 보강·자동 추적 액션

- 원본: `assets/js/modules/reference-image-line-refine-controller.js` 203–220, 252–280행; `assets/js/modules/reference-image-live-wire-controller.js` 252–273, 312–350행; `assets/js/modules/reference-image-surface.js` 38–62, 150–209행.
- 현행 동작: 보정 단계에 따라 동일 버튼행을 컴팩트 요약 영역과 상세 본문 사이로 옮긴다. 두 도구는 적용 가능 상태·추적/미리보기·취소 기능을 각각 소유한다.
- 보존: line-refine / live-wire 도구의 상호 배타성, 지도 터치/핀치, 저장 전 preview 무변경, 적용 1회·취소 무변경, 작업 도중 패널 확대·축소·초기화·이미지 전환, 현재 버튼 접근성/터치 가능 영역.
- **테스트 계약 충돌 확인**: `tests/browser/reference-image-auxiliary-surface.spec.mjs` 120–142행은 액션 버튼행이 요약 DOM의 실제 자식인지 검사한다. 이 주장을 **버튼 위치가 어디든 동등하게 접근 가능하고 동일 명령이 1번 실행됨**으로 대체해야 한다. `reference-image-line-refine.spec.mjs`, `reference-image-live-wire.spec.mjs`의 preview/apply 검사는 보존.
- 대체 설계 검토: P4에서 정해진 단일 action host + 상태 렌더러; 두 컨트롤러는 도구별 상태/명령을 소유하고 공통 표현 계층은 버튼의 표시·배치만 소유. 공유 상태를 복제하지 않음.

## 3. 정본 및 경계

- **제품**: Web viewer에는 프로젝트 편집·삭제·참조 이미지 도구가 없으며 Tauri 앱 편집기에만 있는 기능은 임의로 웹에 추가하지 않는다. 검색, 보기, 환경설정과 공통 surface 구조는 양쪽 검사.
- **상태**: Surface 열림·모바일 시트는 `surface-controller.js`/`workspace-surfaces.js`; 검색 내용·선택은 `object-search-controller.js` 및 기존 selection/project 소유자; 지도 편집의 실제 입력·문서 변경은 기존 도메인 서비스; 이미지 저장/보정/이력은 `reference-image-controller.js` 및 전용 도구 컨트롤러가 소유.
- **기술 규칙**: JS로 CSS/DOM 변경을 표현한 캐시는 정본 상태로 취급하지 않는다. ID 및 사용자-visible 명령은 가급적 유지하되, obsolete DOM selector/test는 구현과 함께 삭제. CSS layered source가 정본이며 생성된 `index.html`/`apps/web-shell/editor.html`/`assets/css/ui*.bundle.css`는 원본 변경 후 재생성.
- **작업 격리**: `work/ui`에서만 시작, 관련 없는 브랜치나 `main`에 병합·배포 금지. 앱/웹 같은 커밋이어도 각각 회귀 검증. Qt 소스나 제거된 레이어 UI는 부활시키지 않음.

## 4. P0 회귀 기준 매트릭스 (실행 계획, 실행 증거 아님)

| 이후 단계 | 집중 검사 소스 / 명령 (후속 단계에서 실행) | 사용자 관찰 기준 | 적용 범위 |
| --- | --- | --- | --- |
| P1 U01 | `tests/browser/feature-pruning-ui.spec.mjs`, `tests/browser/view-focus-actions.spec.mjs`, `tests/browser/feedback-accessibility.spec.mjs`; 객체 메뉴 Open/Arrow/Escape/외부 클릭 새 검증 | 선택 대상 지도 이동, 메뉴 위치/포커스 및 닫힘 | 앱 |
| P1 U02 | `tests/browser/project-setup-ui.spec.mjs` + `tests/browser/helpers/project-setup-ui.mjs`, `tests/browser/project-creation-storage.spec.mjs` | 기원전·연도 0 거부·기간·빈 지도·시점/범위·확인·저장 | 앱 |
| P1 U03 | `tests/browser/feedback-accessibility.spec.mjs` + 웹/앱에서 각각 환경설정 Cancel/Apply/Tab/Shift+Tab/팝오버 사례 추가 | 적용/취소 미리보기 복귀 및 키보드 focus trap/복귀 | 웹+앱 |
| P2 U04 | `tests/browser/workspace-surfaces.spec.mjs` 및 검색 회귀, `tests/unit/object-search-controller.test.mjs`; IME/resize/focus 확인 | 결과/입력 유실 없이 검색 패널이 같은 DOM에서 전환 | 웹+앱 |
| P2 U05 | `tests/browser/phone-landscape-editor.spec.mjs`, `tests/browser/reference-image-ux.spec.mjs` (가로), 시각 스냅샷 | 단일 오른쪽 패널, 지도 상태·초안·터치·키보드 보존 | 앱 |
| P3 U06 | `tests/unit/object-property-controller.test.mjs`, `tests/browser/feature-pruning-ui.spec.mjs` 및 삭제 경로 신규 focus/Undo 회귀 | 잠금·선택 유형·삭제 제한/확인/실행 취소 | 앱 |
| P3 U07 | `tests/unit/editor-workspace-presentation.test.mjs`, `tests/browser/editor-workspace.spec.mjs`, 편집 상태 복구 검사 | 작업 UI 단일성, 최소화/속성 복귀, 포인터 중 전환 무손실 | 앱 |
| P4 U08 | `tests/unit/reference-image-surface.test.mjs`, `tests/browser/reference-image-ux.spec.mjs`, `tests/browser/reference-image-overlay.spec.mjs` | 도킹 폭/접기/가로·세로/데이터/Undo/저장 | 앱 |
| P5 U09 | `tests/browser/reference-image-auxiliary-surface.spec.mjs`, `tests/browser/reference-image-line-refine.spec.mjs`, `tests/browser/reference-image-live-wire.spec.mjs` | 미리보기 중 저장 무변경·적용/취소·버튼 접근·이력 | 앱 |
| P6 | `pnpm check:ui`, `pnpm check:js`, 영향받는 `eslint`, focus Playwright 및 Windows WebView native build/run | 컴포넌트·생성물 정합, 화면별 조작·접근성 유지 | 웹+앱 별도 |

**화면 폭**: 320×720, 390×844, 768×1024, 1024×768, 1440×900; 터치 가로 640×360·844×390. 라이트/다크, prefers-reduced-motion, touch/mouse/keyboard를 기능 관련 범위에서 검사. 화면 크기는 P0 실측 결과가 아니라 이후 단계의 검사 목록이다.

새 regression에서는 구조 자체(부모 DOM 변화 등)를 확인하되 **실제 동작·상태 결과 검사를 우선**한다. 기존 테스트의 실패를 단순히 기대값 제거로 해결하지 않는다.

## 5. 실제 확인 증거 및 미실행 범위

### 이번 P0에서 실제 수행

1. GitHub 원격 `work/ui`의 파일과 메타데이터를 직접 조회해 9개 소스·핵심 호출처·현행 테스트 및 UI 설계 계약을 대조했다.
2. `0eb918c530cf8faa480d979371cf7de06fee69e3` → 조사 기준 `8cb2883e4bd09ba014965b3ce7bec1d5770c1b33` 비교에서 변경 경로는 보고서 자료에 한정됨을 확인했다. 즉 기존 웹 viewer와 editor의 `general-view-menu.spec.mjs` 검증 결과는 참고할 수 있지만 이번 9개 대상 전체 통과를 뜻하지 않는다.
3. 참고할 **이전** CI: [P3 Remote preview and Web verification, 39361663953](https://github.com/kimjeon-il/Pando/actions/runs/39361663953)의 web-contracts/browser-regression/web-snapshot 작업 성공. 그중 `general-view-menu.spec.mjs` 두 시나리오 통과 기록이 존재한다. [Windows Web-shell validation, 39359680075](https://github.com/kimjeon-il/Pando/actions/runs/39359680075)도 과거 커밋에서 성공한 기록이다. 이는 새 P0 환경 실측이나 모든 기능·기기 검사가 아니다.

### 미실행·한계 (확인 완료로 표기 금지)

- **이번 P0에서는** npm/pnpm 테스트, Playwright 시나리오, 화면 스크린샷 비교, Windows/Android 실제 네이티브 앱 실행을 **새로 수행하지 않았다**. 이 환경에서 원격 소스 조회만 가능했고 테스트용 작업 트리 및 브라우저 실행은 마련되지 않았다.
- 검색·편집 작업창·참조 이미지 보정 버튼의 **DOM 재배치 없는 최종 레이아웃 가능성**은 시각적·포커스·터치 검증 전에는 확정할 수 없다.
- 대화상자의 포커스 중복은 정적 코드상 확인되지만 실제 중복 키처리 버그는 미재현. 참조 이미지 lazy CSS가 실제 중복된 시각 스타일을 덮는지, 가로 화면 `!important`가 실제 회귀를 만드는지도 아직 런타임 미검증.
- P1–P5의 각 코드 변경 **직전** 해당 항목의 최소 browser baseline screenshot/behavior trace를 확보하고, 이전의 source-audited 주장과 구분해 보고할 것.

## 6. P0 결론 / 구현 착수 조건

| 항목 | 결과 |
| --- | --- |
| 기존 9개 대상 현행 UI·CSS 구조 위치 | 소스 조사 완료 |
| 상태·이벤트·도메인 명령 소유권 확인 | 주요 직접 호출·소유자 조사 완료; 개별 변경 직전 간접 호출처 재확인 필요 |
| 기존 테스트에서 DOM 위치를 의무화한 사례 | U07·U09 확인 |
| 화면별 필수 동작·수정 금지선 및 검사 목록 | 문서화 완료 |
| 모든 9개 대상의 최신 실사용 baseline 새 실행 | **미실행**, 후속 단계의 첫 조치 |
| UI 코드/생성물/도메인 코드 수정 | **없음** |
| 후속 작업 승인 범위 | P1 이후 단계별 별도 시작 지시 |

따라서 P0의 **정적 구조 감사 및 보존 계약 문서화는 완료**했으나, **9개 대상의 실브라우저 베이스라인을 통과했다고 주장하지 않는다.** P1 진입 시 대상별 최소 현행 검사를 선행하고, 적용 후 동일한 시나리오로 비교한다.

## 데이터 반영

`not-applicable`. 역사·GIS 데이터, UI 소스, 생성 HTML/CSS, 앱 실행물은 수정하지 않음. 이 P0 보고서와 `reports/README.md` 색인만 `work/ui`에 저장.

## 판본

최초 P0 판본. 후속 구현·회귀 보고서가 작성되면 별도 ID로 연결하며, 본문에 검증하지 않은 사항을 후속 성공 기록처럼 덮어쓰지 않는다.
