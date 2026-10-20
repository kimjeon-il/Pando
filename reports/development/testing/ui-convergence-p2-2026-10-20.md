# UI 공통 규칙 통합 P2 — 검색창 DOM 고정·휴대전화 가로 배치 분리

> 보고서 ID: `UI-CONVERGENCE-P2-20261020` · 상태: `implemented / focused-browser-verified / Windows-native-unverified / Android-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-20  
> 원문 최종 수정: 2026-10-20  
> 조사·수정 기준: `work/ui`, P0 정본 `fadc3e37175be814e5e81550252e8d5200b82808`; 최종 검증 대상 `dd6fa136ad1c13fe9a02ba541cd11ce033f25f4a`  
> 근거: [P0 구조 조사](ui-convergence-p0-audit-2026-10-20.md), [GitHub Actions P3 검증 #39404852545](https://github.com/kimjeon-il/Pando/actions/runs/39404852545)

## 목적과 작업 범위

P0에서 확정한 U04(검색 패널)와 U05(휴대전화 가로 UI)를 대상으로, 사용자에게 보이는 기존 기능·조작·저장·도메인 상태를 유지하며 공통 UI 구조와 CSS 책임을 정리했다. 웹은 공개 viewer, 앱은 Tauri WebView 편집기를 대상으로 한다. Qt 데스크톱 앱·GIS·Core·프로젝트 저장 포맷·Undo 계산은 수정하지 않았다.

## 구현 결과

### 검색 UI: DOM 이동 제거

- `assets/js/modules/search-toolbar-presentation.js`: 기존 `#objectSearchSurface`를 `#objectSearchBtn` 도구바의 자식으로 옮겼다가 원위치시키는 주석 anchor 및 append/after 처리 제거. 한 panel과 input/results만 유지.
- 데스크톱 열린 상태의 `.map-command-search` 실제 bounding rectangle을 계산해 panel CSS 변수에 표시 좌표·폭·높이 전달. UI 전환 중 `ResizeObserver`가 확장되는 slot과 toolbar를 관찰하여 같은 표면을 계속 정렬.
- `assets/css/components/map-search.css`: 데스크톱의 동일한 검색 panel을 fixed overlay로 표현하고 모바일/phone-landscape에서는 기존 공유 하단 시트/측면 도크 규칙 유지. 검색 결과의 위쪽 팝업 배치를 기존처럼 유지.
- `assets/css/tokens/design-tokens.css`: 도구바보다 위, 다른 루트 메뉴보다 아래인 검색 표면의 z-index token을 추가. `assets/js/modules/workspace-surfaces.js` dispose 경로에서 검색 observer도 해제.
- 기존 `object-search-controller.js`, 단일 검색 이벤트, 검색 결과 선택/이동, Search Surface 열림 상태, 모바일 시트 이력, 사용자 데이터 저장 경로는 수정하지 않음.

### 휴대전화 가로 UI: 역할별 스타일 재배치

- `assets/css/components/editor-shell.css`에 모여 있던 `phone-landscape` 반응형 지도 가용 영역, 우측 단일 도크, 왼쪽 내비, 상단 메뉴와 지도 도구바 위치, 상태 영역 배치를 `assets/css/layout/surfaces.css`로 이동.
- 패널 테두리·배경·그림자, 모바일 내비 배경과 활성 강조색, 글자 크기는 `assets/css/components/mobile-sheets.css`로 이동. 기존 폭 제한(최대 320px 또는 화면 폭의 45%), 오른쪽 도크, 지도 안전 여백 유지.
- 편집기 SVG 터치 정점 핸들의 `!important` 제거. 기존 선택 선 색상과 확대경 필터를 `assets/css/tokens/component-tokens.css`의 의미 토큰으로 옮겨 기존 시각 값을 보존.
- `assets/css/ui.bundle.css`, `assets/css/ui-viewer.bundle.css` 모두 소스와 일치하게 갱신. P2 자동 생성 파이프라인이 웹 `index.html` 및 `apps/web-shell/editor.html` 빌드 메타데이터 변경물을 별도 커밋으로 동기화.

## 검증 결과

실행 시점의 검증 대상: `dd6fa136ad1c13fe9a02ba541cd11ce033f25f4a`. [P3 Remote preview and Web verification 실행 #39404852545](https://github.com/kimjeon-il/Pando/actions/runs/39404852545): 전체 **success**.

| 검사 | 결과 | 범위 |
| --- | --- | --- |
| `web-contracts` | **성공** | Core 선행 검사, 생성 메타데이터, 집중 테스트 파일 3개의 ESLint, Playwright |
| 집중 Playwright | **7/7 통과** | 실제 편집기 가로 화면 1, CSS phone-landscape 표면 640×360·844×390 2, 검색·IME·뷰어 회전 4 |
| `browser-regression` | **성공** | 별도 원격 공통 browser 스모크·지도/성능 시나리오 |
| `web-snapshot` | **성공** | 웹 스냅샷 생성 |
| `P2 Source-matched generated artifacts` | **성공** | HTML 메타데이터와 CSS 원본/생성물 동기화(소스 수정 직후 별도 빌드) |
| 정적 검수 | **확인** | 검색 JS의 reparenting anchor/append 부재, 원본 DOM 유지, 두 CSS 번들 각각 원본 규칙 일치, phone-landscape 배치/skin CSS 역할 분리 |
| Windows Tauri 전체 빌드·GUI 실기동 | **미실행** | 이 P2 변경 커밋의 신규 네이티브 CI 성공은 확인되지 않음 |
| Android WebView 실기기 | **미실행** | 기기별 터치·키보드·screen orientation 추가 검증 필요 |
| 모든 프로젝트 UI 구성요소의 별도 `pnpm check:ui` 전수 실행 | **미확인** | 이번 완료 판정은 P2 집중 UI 회귀 기준이며 전체 기능·기기 승인으로 확대하지 않음 |

### 검증 항목 구체화

- `tests/browser/search-stable-surface.spec.mjs`: editor와 viewer 각각 1024px 데스크톱 → 390px 모바일 → 1440px 넓은 화면에서 동일한 panel DOM 부모·검색어·input focus 확인; viewport 도구바와 panel 좌표 정렬 및 타겟 직접 터치 가능 여부 확인. 뷰어에서 844×390 → 390×844 가로/세로 회전 검색 시트 유지. 편집기에서 모의 IME `compositionstart` 동안 레이아웃 전환 보류하고 `compositionend` 후 적용, 입력값·DOM 유지 확인. 총 4개 통과.
- `tests/browser/phone-landscape-surface-contract.spec.mjs`: 640×360, 844×390에서 우측 도크의 border-left, background, shadow, header/handle/내비 표시 상태 검사. 총 2개 통과.
- `tests/browser/phone-landscape-editor.spec.mjs`: 실제 editor에서 가로 우측 panel 위치·치수와 공통 surface skin, viewer camera 유지, 키보드 visualViewport 대응, 미완료 편집 draft/Undo/Redo가 panel 간 이동 후 유지되는 동작. 1개 통과.
- 기존 `tests/browser/viewer-search-responsive.spec.mjs`의 GPKG 프로젝트 선택 전체 시나리오는 이 최종 run의 7개 직접 선택 테스트에 포함되지 않았으므로, 별도 최신 실행을 주장하지 않음.

## 확인된 한계와 다음 단계

동적 CSS 좌표는 포인터·키보드·IME 중심 브라우저 환경에서 확인했으나 Windows Tauri/Android 실기기와 pinch-zoom visual viewport의 모든 경계 조건을 재현하지 않았다. P3 UI 소스 본체는 변경하지 않았다. P1의 프로젝트 생성창·환경설정과 P3의 삭제 버튼·지도 편집 작업창은 이번 P2 범위 밖이다.

## 저장·데이터 반영

역사 지도/객체/저장 데이터는 변경하지 않음(`not-applicable`). `work/ui`에 구현 및 집중 테스트를 커밋하고, 이 보고서와 `reports/README.md` 색인만 추가했다. **`main` 병합·실서비스 배포 없음**. 후속 P3는 별도 시작 지시를 기다림.

## 판본

이 문서는 P2 최초 결과 기록. 새 검증·수정이 생기면 이후 판본에서 커밋·실행 ID별 상태를 구분해 연결할 것.
