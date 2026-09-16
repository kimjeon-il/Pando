# UI Components

## 공간 배분·가시성 계약

- Library의 출처·이용 조건은 데이터에만 보존하며 상세 화면·별도 버튼·접기 영역으로 표시하지 않는다. 근사 경계·정확도 경고와 기존 시기 설명은 유지한다.
- Library는 모든 폭에서 단일 목록을 사용한다. 선택 버튼 바로 아래에 기존 상세를 배치하고 목록 하나가 스크롤을 소유한다. 필터와 목록은 선 대신 간격으로 구분하며, 선택은 안쪽 여백이 있는 둥근 약한 배경으로 표시한다. 목록/상세 전환 버튼은 표시하지 않는다. 결과는 펼침 버튼 그룹이며 방향키는 결과 간 이동, Enter/Space는 선택, 상세의 입력은 자체 키보드 동작을 유지한다.

- 넓은 화면의 작업 공간 내비게이션은 표시·포커스 탐색에서 제외한다. 보통·모바일 공유 내비게이션은 유지하며 대체 버튼을 만들지 않는다.
- 검색·보기·추가·편집 Surface는 로컬 불투명 panel 토큰을 공유한다. 지도·팝오버의 색상 계약은 별개다.
- Library는 첫 줄에 이름 검색과 기준 연도를 나란히 배치한다. 다음 줄의 종류·상태·지역 필터는 접기 없이 항상 표시하며, 글자 확대 시 가용 폭에 따라 줄바꿈한다. 상세 footer는 범위 선택과 버튼 행의 콘텐츠 높이만 사용한다.
- GIS export는 단일 폼이며 본문만 스크롤한다. 액션은 별도 고정 행에 둔다. import의 기존 단계와 검증 흐름은 보존한다.
- 객체 검색 결과의 유형과 로딩/오류 상태는 유지한다. primary는 세로 막대, secondary는 약한 선택 배경을 사용한다.
- 현재 workspace surface 브라우저 검사에서 실제 치수·스크롤 영역·폭별 노출을 검사한다. 정적 클래스 검사만으로 준수 여부를 판정하지 않는다.

이 문서는 컴포넌트별 계약과 명시적 예외만 정의한다. 글자·컨트롤 수치, 반응형 허용 범위, 정렬·상태·CSS 소유권은 [UI Architecture](ui-architecture.md)가 단일 원본이다. 수치를 이 문서에 복제하지 않는다.

아래 계약은 후속 개편의 목표이며 현재 DOM·CSS의 준수 여부를 보증하지 않는다. 이번 단계는 문서만 정리하고 기능·DOM·버튼 ID·ARIA·controller를 변경하지 않는다.

## Canonical style sources

주요 컴포넌트의 담당 원본은 다음과 같다. 기존 파일 안의 모든 override를 승인하는 목록은 아니며, 다른 소유자의 속성을 덮어쓰는 규칙은 후속 이관 대상이다.

- `assets/css/tokens/design-tokens.css`: Surface와 콘텐츠 component가 공유하는 의미 토큰
- `assets/css/primitives/controls.css`: Button/Field/Icon의 외형과 상태
- `assets/css/components/surface.css`: Surface/Header/Tabs/Body/Content
- `assets/css/components/content.css`: Section/Field/ActionList/PropertyList/ObjectContext 호환 계약
- `assets/css/components/command-row.css`: 작업 행의 아이콘·제목·설명·chevron 배열
- `assets/css/components/editor-shell.css`: 편집 컨텍스트·toolbar·작업 HUD의 조합
- `assets/css/components/workflows.css`: 편집 작업창·dialog·wizard 공통 표현
- `assets/css/components/topbar.css`: 상단 문서 명령의 배치·반응형 표현과 파일 메뉴 위치
- `assets/css/components/panels.css`: 지도·추가·Library/GIS 패널 표현
- `assets/css/components/view-menu.css`: 넓음·중간 폭의 상단 `보기` 계층형 메뉴 표현
- `assets/css/layout/surfaces.css`: wide/compact/mobile의 Surface 배치와 표시 상태
- `assets/css/components/modals.css`: Dialog/Wizard shell
- `assets/css/components/mobile-sheets.css`: 공통 handle·sheet 조작 계약
- `assets/css/components/feedback.css`: 지속 상태·toast·empty/loading/error 표현

표시 설정은 한 DOM을 공유한다. 넓음·중간 폭에서는 `components/view-menu.css`가 상단 `보기`의 계층형 메뉴와 옆 하위 메뉴를 표현하고, 모바일에서는 기존 sheet의 `map-display-list`와 `map-display-row`를 유지한다. 언어·민족·종교는 데스크톱 메뉴에서 `분포`의 하위 항목으로 이동하지만, 실제 input과 상태는 복제하지 않는다.

생성 bundle은 원본이 아니며 직접 편집하지 않는다.

`app.css`는 기존 화면을 유지하기 위한 legacy compatibility source다. 새 공통 component 규칙을 `app.css`나 `phase1-ui-cleanup.css`에 추가하지 않는다.

## Surface contract

검색·보기·추가·편집의 shell 계약은 공통 규칙 문서의 「Surface DOM contract」를 따른다.

```text
workspace-surface
  surface-header
    surface-header-title
    surface-header-actions
  object-context (선택적)
  surface-tabs (선택적)
  surface-body
    surface-content
  surface-footer (선택적)
```

Surface 내부 구조와 기본 chrome은 `components/surface.css`가 소유한다. Wide/Compact/Mobile의 위치·크기·열림 상태는 `layout/surfaces.css`가 소유한다.

- 연결 대상은 `#createMenu`, `#objectSearchSurface`, `#mapDisplaySurface`, `#rightPanel.surface-editor`다.
- 헤더 제목 슬롯은 긴 제목을 처리하고 액션 슬롯을 밀지 않는다.
- ObjectContext는 객체명·유형·잠금 상태·지도에서 보기를 담당한다. 잠금 변경·삭제·유형별 편집은 본문 작업 영역을 사용한다.
- Tab은 기존 `.ui-button.ui-tab`, `data-surface-tab`, tab/tabpanel ARIA 연결과 키보드 동작을 유지한다.
- Footer는 필요한 취소·확정 액션을 묶는다. 본문 정보와 중복 설명을 추가하지 않는다.
- 사용하지 않는 슬롯은 빈 공간 없이 생략한다. shell 수치와 반응형 정책은 공통 규칙 문서를 참조한다.

## Content components

### 추가 메뉴와 스크롤 예외

- `#createMenu`는 넓음·중간에서 메뉴, 모바일에서 같은 DOM을 사용하는 시트다. 각 표현에 맞는 role과 `aria-controls`, `aria-expanded`를 surface controller가 동기화한다.
- 데스크톱 메뉴는 방향키·Home/End·Enter/Space·Escape·Tab을 지원하고, 모바일 시트는 공통 손잡이·snap·뒤로 가기 계약을 사용한다.
- 가용 높이가 제한된 메뉴, 객체 검색 결과, Library 목록·상세만 독립 스크롤을 소유한다.
- 공통 overlay scrollbar는 native scrolling과 분리된 chrome이다. 우측 1rem rail 내부에 위치하며 좌우 콘텐츠 폭을 바꾸지 않는다. 모바일 본문은 native touch scrolling을 유지한다. scrollbar는 얇은 rail 내 직접 조작이라는 명시적 예외로 너비 1rem, thumb 최소 높이 3rem을 사용하고 키보드 대체 조작을 제공한다.

편집기 및 이후 추가되는 기능은 다음 의미 단위를 우선 사용한다.

- `ui-content-section`: 관련 필드/정보의 한 묶음
- `ui-content-field`: label + control 한 쌍
- `ui-action-list`: 실행 가능한 작업의 세로 목록
- `ui-property-list`: 읽기 전용 속성 목록
- `ui-object-context`: 현재 편집 대상을 설명하는 이름/종류/상태 영역

현재의 `editor-*` 클래스는 기존 DOM 호환을 위해 component stylesheet에서 alias로 취급한다. 신규 기능은 새 `ui-*` component 이름을 사용하고 기존 feature 전용 skin을 복제하지 않는다.

- 필드 label은 본문 역할이며 보조 설명 크기로 축소하지 않는다.
- 공통 ObjectContext 구조는 content, 편집 전용 조합은 editor 담당이다.
- Command Row는 선행 SVG·제목·선택적 설명·chevron으로 구성한다. 설명이 없으면 해당 공간을 생략하고 capability·disabled·dispatch는 유지한다.
- 아이콘 단독 버튼은 의미가 일치하는 접근성 이름·tooltip을 유지한다. 대체 아이콘은 동시에 노출하지 않는다.
- Dialog/Wizard는 기존 단계·확인·취소·focus 복귀를 유지한다. 일반 작업 행에 danger 색상을 적용하지 않는다.

## 명시적 예외

| 적용 조건 | 담당 컴포넌트 | 이유 | 검증 항목 |
|---|---|---|---|
| 객체 검색 결과가 스크롤을 소유 | Search Surface의 `layer-search-results` | 검색 결과를 입력과 독립 탐색 | 본문과 이중 스크롤 없음, scroll offset·선택 상태 유지 |
| Library 목록·상세를 함께 표시 | Library list/detail | 각 영역을 독립 탐색 | 각각 단일 스크롤, 모바일 세로 배치에서 순서·focus 유지 |
| 투영 아이콘 | Projection control | 평면지도·지구본 형태 식별 | 공통 규격의 투영 크기만 사용, 다른 아이콘 확대 없음 |
| 지도 라벨 | 기존 지도 렌더링 계층 | 지도 좌표·줌과 연결된 별도 표현 | UI rem 이관으로 지도 라벨 렌더링 기준이 변경되지 않음 |

추가 예외는 공통 규칙 문서의 등록 조건을 따른다. 기존 override가 있다는 이유만으로 예외로 인정하지 않는다.

## Migration rule

사용자 지정 색상은 `custom-color-control.js`의 공통 컨트롤을 사용한다. HSV 면·색조, HEX/RGB/HSL, 선택적 스포이트의 임시값은 이 컨트롤에만 두며, 적용 시 `app-color-picker.js`가 기존 input 이벤트와 객체별 commit 경로로 전달한다. 취소·닫기는 프로젝트와 history를 변경하지 않는다. 객체 팔레트와 환경설정은 같은 컨트롤을 사용하되, 환경설정은 스크롤 본문 안에 배치해 팝오버 잘림을 피한다. 기본 색상표·상속·기본값 복원·투명도는 기존 책임에 둔다.

후속 UI 변경은 공통 규칙 문서의 완료 기준을 따른다. 각 컴포넌트의 `준수 / 위반 / 예외`, 현재 파일·selector·property, 담당 원본, 대체 규칙, 검증 결과를 기록한 뒤 아래 순서로 진행한다.

1. 기존 component로 표현 가능한지 확인한다.
2. 공통 요구라면 `components/`를 확장한다.
3. 화면 폭에 따른 차이라면 `layout/`에서 처리한다.
4. 기능 고유 표현만 `features/`에 둔다.
5. legacy CSS에 새 보정 규칙을 추가하지 않는다.

별도 phase cleanup layer를 새로 만들지 않는다. `app.css`에 남은 공통 규칙은 해당 담당 컴포넌트로 이관하고 대체 규칙을 검증한 뒤 중복을 제거한다. 첫 회귀 사례와 화면 검증 조건은 공통 규칙 문서의 「후속 정리 경계」를 따른다.
