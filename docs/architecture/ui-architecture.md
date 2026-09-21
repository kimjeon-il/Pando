# UI Architecture

이 문서는 UI 공통 규칙의 단일 원본이다. 기존 UI의 디자인 방향은 유지하되 글자·조작 영역은 아래 합의 규격으로 대체한다. 컴포넌트 계약과 예외는 [UI Components](ui-components.md)를 참조한다. 공개 API·저장 형식·기능 및 렌더링 모델은 유지한다.

## 확정 규격

- **확정**: 글자·컨트롤 규격, 정보 순서, 정렬·스크롤·상태 규칙, 반응형 허용 범위, CSS 소유권.
- **Shell**: 상단바 최소 3rem, 컴퓨터 헤더 최소 3.25rem, Inspector 20rem, compact drawer 20rem(화면 양쪽 0.5rem 이내), 상태 영역 최소 2rem, 모바일 헤더 최소 5rem, 하단 내비게이션 최소 3.5rem + safe-area, 콘텐츠 좌우 rail 1rem.
- 헤더와 상단바는 실제 높이를 공통 `surface-metrics`에서 측정해 시작 위치에 연결한다. 모바일 접힘은 최소 5.25rem이며 실제 헤더보다 작지 않다. 편집 시트는 48/86dvh, 검색·보기·추가 시트는 52/88dvh를 가용 높이로 제한한다.
- 과거 시안의 작은 글자, 28/30px 컨트롤, 모바일 visibility 32px 규격은 아래 목표 규격으로 대체한다. 다른 문서나 시안의 수치와 충돌하면 이 문서를 우선한다.

### 글자

루트는 `html { font-size: 100%; }`로 두고 글자와 컨트롤 치수는 rem을 사용한다. 표의 px는 브라우저 기본 글자 크기 16px 기준의 환산값이며 고정 루트 크기를 뜻하지 않는다. 줄높이는 단위 없는 값이다.

| 용도 | 크기 | 줄높이 |
|---|---:|---:|
| 본문·입력값·버튼·탭·레이어 이름·필드 label | 0.875rem — 14px | 1.4 |
| 보조 설명·메타 정보 | 0.8125rem — 13px | 1.4 |
| 창 제목·객체명 | 1rem — 16px | 1.3 |

모바일에서도 같은 규격을 사용한다. 섹션 제목은 본문 크기와 굵기로 구분한다. 지도 라벨은 UI 글자 규칙과 분리하고 기존 렌더링 기준을 유지한다.

### 컨트롤

| 요소 | 컴퓨터 최소 높이 | 모바일 최소 조작 높이 |
|---|---:|---:|
| 일반 버튼·입력·선택창 | 2.25rem — 36px | 3rem — 48px |
| 아이콘 단독 버튼 | 2.25rem — 36px | 3rem — 48px |
| 탭 | 2.5rem — 40px | 3rem — 48px |
| 레이어 행 | 2.25rem — 36px | 2.75rem — 44px |
| 설명 없는 메뉴·작업 행 | 2.25rem — 36px | 3rem — 48px |
| 설명 있는 작업 행 | 3.25rem — 52px | 3.5rem — 56px |

- 높이는 `min-height`로 지정해 줄바꿈·글자 확대 시 늘어날 수 있게 한다. 아이콘 단독 버튼은 최소 너비도 같은 값을 사용한다.
- 모바일 레이어 visibility 버튼은 최소 2.75rem × 2.75rem — 44×44px로 통일한다.
- 일반 아이콘은 1rem, 투영 아이콘만 1.125rem이다. 기존 SVG 형태를 유지한다.
- 버튼 곡률은 0.375rem — 6px, 기본 버튼 간격은 0.5rem — 8px이다.
- 테두리는 1px을 유지한다. 실제 선언은 담당 semantic token을 참조한다.

### 정렬·스크롤·상태

- 제목과 헤더 버튼은 수직 중앙 정렬한다. 긴 제목이 버튼 위치를 밀지 않게 한다.
- 좌우 콘텐츠 여백은 대칭이고 스크롤바 유무에 따라 바뀌지 않는다. Windows와 모바일도 동일한 여백 기준을 사용한다. 플랫폼별 scrollbar 폭을 이유로 창마다 임의 보정하지 않는다.
- 기본 스크롤 소유자는 본문 하나다. 가상화 목록과 라이브러리 목록·상세의 독립 스크롤만 명시적 예외로 둔다.
- hover·focus·선택·메뉴 열림은 주변 배치나 크기를 바꾸지 않는다. 기능상 필요한 열림·닫힘 전환과 구분한다.
- 닫기·접기 같은 대체 아이콘은 상태에 맞게 하나만 표시한다.
- 구분선은 패널 및 고정 영역 경계에 사용하고 일반 콘텐츠 그룹은 간격으로 구분한다. 메뉴를 열었다는 이유로 기존 구분선을 제거하지 않는다.
- 위험 작업은 평상시 neutral, 최종 확인 버튼만 danger로 표시한다. 기존 확인·취소 흐름을 유지한다.
- 반복 설명·내부 식별자·정상 처리 보고는 기본 화면에서 줄인다. 데이터 손실·영토 이전·불확실성 경고와 출처·이용 조건은 보존한다.
- 지속 상태는 상태 영역, 일시적 결과는 toast, 사용자 조치가 필요한 오류는 inline 또는 dialog로 분리한다.

### 반응형

- wide는 dock·floating 배치, compact는 공통 drawer, mobile은 공통 bottom sheet를 사용한다.
- 모바일·컴퓨터의 글자·아이콘·정보 순서는 동일하다. 배치와 터치 영역만 달리한다.
- 화면 폭을 이유로 기능을 삭제하거나 정보 순서를 바꾸지 않는다. 다열 콘텐츠의 세로 재배치와 터치 영역 확대는 허용한다.
- 상단바 높이와 패널 시작 위치는 같은 토큰에서 계산한다. 개별 `+4px` 보정은 금지한다.
- breakpoint는 mobile 800px 미만, compact 800–1359px, wide 1360px 이상이다. controller의 기존 open/close·focus·history 계약은 유지한다.

## 1. 계층과 책임

정식 의존 방향은 다음 한 방향만 허용한다.

**Tokens → Primitives → Components → Layout → Features**

- **Tokens**: 색상, 간격, 글꼴, 치수, radius, shadow, z-index 같은 의미 토큰의 원본이다.
- **Primitives**: button, input, tab, row, icon 등 최소 UI 단위의 외형과 상호작용을 소유한다.
- **Components**: surface, section, field, action list, tree, dialog 같은 조합 단위를 소유한다.
- **Layout**: wide / compact / mobile에서 위치, 크기, 노출 및 공통 컴포넌트에 정의된 표면 variant 선택을 결정한다. 컴포넌트의 색상이나 skin을 별도로 재정의하지 않는다.
- **Features**: 국가, 수계, 라이브러리처럼 도메인에만 필요한 표현을 추가한다. 공통 컴포넌트의 skin을 다시 만들지 않는다.

새 CSS를 분리할 때는 `assets/css/{tokens,primitives,components,layout,features,utilities}/` 중 책임에 맞는 위치를 사용한다. 루트 CSS 파일을 새로 추가하지 않는다.

파일은 책임 기준으로 나눈다. 파일 개수 자체를 목표로 합치거나 분리하지 않는다.

## 2. Property ownership

공통 컴포넌트가 소유한 시각 속성은 feature가 다시 선언하지 않는다.

같은 속성의 결정권자는 하나만 둔다. 다른 계층은 명시된 variant나 토큰으로 차이를 요청한다. 파일 로드 순서만으로 충돌을 해결하지 않고 실제 cascade 계층과 specificity를 함께 관리한다. 뒤에 로드된다는 이유로 다른 소유자의 속성을 덮어쓸 수 없다.

- Button/Field/Tab: control height, padding, border, radius, background, focus/pressed state
- Section/Card: padding, border, radius, background, shadow
- Surface/Header/Tabs: surface chrome, header/tabs 높이와 기본 rail
- Layout: position, inset, width/height, transform, responsive visibility
- Feature: 도메인 고유 geometry/media 표현과 콘텐츠 배치

특수 미디어 preview 같은 예외는 **적용 조건 + 담당 컴포넌트 + 이유 + 검증 항목**을 컴포넌트 문서에 기록한다. 구현 시 `check-ui-architecture.mjs`의 명시적 예외에 파일·selector·property·reason을 연결한다. 넓은 selector나 feature 전체를 예외 처리하지 않는다. 기존 override가 있다는 이유만으로 예외를 인정하지 않는다.

## 3. Selector와 값 규칙

새 layered CSS에는 다음 규칙을 적용한다.

- UI 스타일에 ID selector를 사용하지 않는다. ID는 JS 연결과 ARIA 참조용이다.
- 신규 UI CSS의 `!important`는 금지한다. 예외 등록을 신규 ID selector·`!important` 금지 우회에 사용하지 않는다.
- spacing/geometry에 임의 px 값을 추가하지 않고 semantic `--ui-*` token을 사용한다.
- 색상 literal은 token 계층에서만 정의하고 그 밖의 계층은 변수로 참조한다.
- Layout CSS는 색상, border, background, shadow, typography를 재정의하지 않는다.
- Feature CSS는 공통 component의 padding/border/radius/background/shadow를 재생성하지 않는다.

허용 예:

```css
/* components/surface.css */
.ui-surface-header {
  min-height: var(--ui-surface-header-height-compact);
  padding-inline: var(--ui-surface-content-rail-x);
  background: var(--surface-elevated);
}

/* layout/mobile.css */
[data-layout="mobile"] .workspace-surface {
  width: 100%;
  transform: translateY(100%);
}
```

금지 예:

```css
/* features/editor.css */
#editorSurface .country-editor {
  padding: 13px;
  border-radius: 11px;
  background: #20262e;
}
```

## 4. Surface DOM contract

검색·보기·추가·편집은 외형과 위치가 달라도 동일한 surface 상태 계약을 사용한다.

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

슬롯 이름은 역할 설명이다. 헤더에는 창 제목과 창 제어만 두고, 객체 탐색은 컨텍스트, 편집 작업은 본문에 둔다. 선택적 슬롯은 빈 공간 없이 생략한다. 같은 역할의 헤더·탭·필드·작업 행은 같은 컴포넌트를 사용한다. 이 목표 계약을 문서화하는 단계에서 새 DOM이나 ID를 추가하지 않는다.

현재 surface와 패널 연결은 다음과 같다.

- `create` → `#createMenu`
- `search` → `#objectSearchSurface`
- `display` → `#mapDisplaySurface`
- `editor` → `#editorSurface.surface-editor`

넓음·중간 화면에서 추가와 보기는 버튼에 붙는 메뉴이고 검색은 하단 작업바에서 펼쳐진다. 좁은 화면에서는 같은 DOM이 공통 바텀시트로 전환된다. 편집은 데스크톱 편집창과 모바일 편집 시트를 공유한다. 모바일에서는 한 번에 하나의 시트만 열며, 폭 전환은 문서·선택·draft와 지도 상태를 변경하지 않는다.

각 tab button은 `.ui-button.ui-tab`을 조합하고 `data-surface-tab`으로 의미를 선언한다. Wide에서 창 모양을 다르게 만드는 것은 Layout 책임이며, feature별로 header/tabs/body 순서를 바꾸지 않는다.

## 5. Legacy CSS ratchet

`phase1-ui-cleanup.css`와 해당 runtime loader는 UI convergence 단계에서 제거되었다. 현재 root-level legacy stylesheet로 허용되는 것은 `app.css` 하나뿐이다.

- 새 root-level CSS 파일을 추가하지 않는다.
- `app.css`의 byte budget은 늘리지 않는다.
- generic UI 규칙은 layered CSS로 이동하면서 `app.css` budget을 계속 낮춘다.
- `app.css`에는 신규 보정을 추가하지 않는다. 대체 규칙을 검증한 뒤 기존 규칙을 제거한다.
- layered UI에 legacy 파일과 같은 selector/override 부채를 다시 만들지 않는다.
- 기존 부채가 존재한다는 이유로 새 코드에 동일한 예외를 허용하지 않는다.

이 ratchet은 남은 `app.css`를 점진적으로 축소하면서도 현재 renderer/domain 표현을 한 번에 깨뜨리지 않기 위한 경계다.

## 6. Runtime ownership

정적 presentation은 HTML/CSS가 소유하고, 동적 UI state는 해당 controller가 소유한다.

- Surface open/close, `aria-hidden`, `inert`: `surface-controller.js`
- Mobile sheet snap과 직접 편집 전환: `mobile-sheet-controller.js`
- Toast/feedback routing: `feedback-controller.js`
- Dialog focus containment/restore: dialog controller 및 `dialog-accessibility-controller.js`
- Library listbox selection/keyboard: `historical-library-controller.js`
- 공통 UI initialization: `ui-runtime.js`

문자열이나 렌더된 DOM을 관찰해서 domain state를 역추론하는 방식보다 명시적 controller state와 event를 우선한다.

## 7. CI 계약

후속 구현에서는 다음 관련 검사를 유지하고 새 계약과의 차이를 명시적으로 갱신한다. 이번 문서 정리 단계에서는 검사 코드를 변경하거나 앱 테스트를 실행하지 않는다.

- `check:ui-spacing`: spacing/token 충돌 검사
- `check:ui-components`: primitive/component 조합 검사
- `check:ui-architecture`: 계층, Surface DOM contract, legacy ratchet 및 retired artifact 검사
- `check:ui-layering`: 원본 목록과 계층 검사
- `check:ui-ia`: 현재 surface variant와 생성·편집 정보 구조 검사

`scripts/lib/ui-source-catalog.mjs`는 canonical bundle, lazy modal, 원본 audit 입력 목록의 단일 원본이다. 검사기는 생성 bundle을 다시 입력으로 읽거나 자체 CSS 경로 배열을 유지하지 않는다. IA 검사는 현재 surface별 구조 차이를 `menu-sheet`·`delegated`·`editor` 계약으로 구분한다.

UI 예외를 추가해서 검사를 우회하는 것보다 기존 primitive/component를 확장하는 것을 우선한다. 예외가 필요한 경우 이유가 코드에 남아야 하며 범위는 최소여야 한다.

## 8. 후속 정리 경계

UI의 전용 phase cleanup layer는 더 이상 production runtime에 존재하지 않는다. 이후 UI 정리는 `app.css`의 남은 generic rule을 canonical layered CSS로 이동하고, static markup으로 옮길 수 있는 presentation mutation을 줄이는 방식으로 진행한다.

기능/domain state와 renderer를 UI 정리와 동시에 재작성하지 않는다.

이번 단계에서는 두 규칙 문서의 수치·책임 충돌, 상대 링크, Markdown 표·코드 펜스·공백만 검사한다. CSS bundle·build metadata는 재생성하지 않는다.

후속 UI 개편은 컴포넌트별 `준수 / 위반 / 예외` 목록을 작성한 뒤 진행한다. 현행 파일·selector·property와 담당 원본, 대체 규칙, 검증 결과를 기록하며 기존 미커밋 변경은 보존한다. 파일 이동이나 bundle 생성만으로 완료 처리하지 않는다.

완료 판정은 관련 정적 검사와 wide·compact·mobile, light/dark, 스크롤 유무, 메뉴 열림/닫힘, 긴 제목, 글자 확대, 키보드 focus의 계산 스타일·화면 확인을 함께 요구한다. 글자 확대 시 잘림, 터치 영역 충돌, 좌우 여백 변동이 없어야 한다.

첫 회귀 사례는 헤더 이중 아이콘·제목 옆 버튼 정렬·상단 단차·파일 메뉴 구분선 문제로 고정한다. 전체 renderer·Worker·GIS·저장 schema 개편은 이 절차의 범위가 아니다.
