# UI·상호작용 정책

브라우저 Web Viewer와 내장 읽기 전용 점검 UI의 공통 규격이다. UI 변경으로 제품 기능·저장 형식·지도 렌더링 모델을 바꾸지 않는다.

## 글자·컨트롤

루트 글자 크기는 100%이며 글자·컨트롤은 rem을 사용한다. 아래 px 환산은 브라우저 기본 16px 기준이다. 모바일에서도 글자 규격과 정보 순서를 유지한다. 지도 라벨은 별도 지도 표시 규칙을 따른다.

| 용도 | 글자 크기 | 단위 없는 줄높이 |
| --- | ---: | ---: |
| 본문·입력·버튼·탭·레이어명·필드 label | 0.875rem (14px) | 1.4 |
| 보조 설명·메타 정보 | 0.8125rem (13px) | 1.4 |
| 창 제목·객체명 | 1rem (16px) | 1.3 |

섹션 제목은 본문 크기와 굵기로 구분한다. 필드 label을 보조 설명 크기로 줄이지 않는다.

| 요소 | 데스크톱 최소 높이 | 모바일 최소 조작 높이 |
| --- | ---: | ---: |
| 일반 버튼·입력·선택창 | 2.25rem | 3rem |
| 아이콘 단독 버튼 | 2.25rem | 2.5rem |
| 탭 | 2.5rem | 3rem |
| 레이어 행 | 2.25rem | 2.75rem |
| 설명 없는 작업 행 | 2.25rem | 3rem |
| 설명 있는 작업 행 | 3.25rem | 3.5rem |

- 높이는 min-height로 지정해 줄바꿈·글자 확대에 따라 늘어난다. 아이콘 단독 버튼은 최소 너비도 같은 값이며 의미에 맞는 접근성 이름과 tooltip을 갖는다.
- 모바일 레이어 visibility 버튼은 최소 2.75rem × 2.75rem이다. 일반 아이콘은 1rem, 투영 아이콘은 1.125rem이다. 기존 SVG 형태를 유지한다.
- 버튼 곡률은 0.375rem, 기본 버튼 간격은 0.5rem, 테두리는 1px이다. 실제 선언은 담당 semantic token을 사용한다.
- 색상 견본은 전용 표현이며 일반 아이콘 버튼 치수를 적용하지 않는다. 키보드·focus·선택 표시는 유지한다.

## Shell과 반응형

- 상단바 최소 3rem, 데스크톱 패널 헤더 최소 3.25rem, 점검 패널과 compact drawer 기본 폭 20rem, compact 화면 가장자리 여유 0.5rem, 상태 영역 최소 2rem, 모바일 헤더 최소 5rem, 하단 내비게이션 최소 3.5rem + safe-area, 콘텐츠 좌우 rail 1rem을 사용한다.
- 실제 헤더·상단바 높이를 공통 surface metrics에서 측정해 패널 시작 위치에 연결한다. 모바일 접힘 높이는 최소 5.25rem이며 실제 헤더보다 작지 않다. 검색 시트의 중간/확장 높이는 52/88dvh를 가용 높이로 제한한다.
- 기본 폭 구분은 mobile 800px 미만, compact 800–1359px, wide 1360px 이상이다. 짧은 touch 가로 화면은 공통 상태 모델의 phone-landscape 배치를 사용한다. 판정은 [workspace-layout.js](../../src/ui/workspace-layout.js)가 소유한다.
- wide의 dock/floating, compact drawer, mobile bottom sheet는 같은 기능과 상태를 사용한다. 폭 전환은 선택·문서·지도 상태를 바꾸지 않는다. 다열 콘텐츠의 세로 재배치·터치 영역 확대는 허용한다.
- 상단바와 패널 위치는 같은 측정값·토큰으로 계산한다. 개별 픽셀 보정이나 별도 모바일 업무 로직을 만들지 않는다.

## 정렬·스크롤·접근성·피드백

- 제목과 헤더 버튼은 수직 중앙 정렬한다. 긴 제목이 액션을 밀지 않게 한다. 선택 슬롯은 생략할 때 빈 공간을 남기지 않는다.
- 좌우 콘텐츠 여백은 대칭이며 스크롤바 유무나 플랫폼별 scrollbar 폭에 따라 바뀌지 않는다. 기본 스크롤 소유자는 본문 하나다. 독립 검색 결과·가상화 목록만 필요한 범위에서 예외를 둔다.
- 공통 overlay scrollbar는 native scroll과 별도 chrome이며 우측 1rem rail 안에 둔다. thumb 최소 높이는 3rem이고 키보드 대체 조작을 제공한다. 모바일은 native touch scroll을 유지한다.
- hover·focus·선택·메뉴 열림이 주변 크기와 배치를 바꾸지 않는다. 닫기·접기 대체 아이콘은 상태에 맞게 하나만 표시한다.
- 구분선은 패널·고정 영역 경계에 사용하고 일반 콘텐츠 그룹은 간격으로 구분한다. 메뉴가 열렸다는 이유로 기존 구분선을 제거하지 않는다.
- dialog는 focus를 가두고 닫을 때 복귀시킨다. 숨은 UI는 표시뿐 아니라 focus 탐색에서도 제외한다. ARIA·키보드 상태는 담당 controller와 일치해야 한다.
- 위험 작업은 평상시 neutral, 최종 확인 버튼만 danger로 표시한다. 지속 상태는 상태 영역, 일시 결과는 toast, 사용자 조치가 필요한 오류는 inline 또는 dialog로 전달한다.
- 반복 설명·내부 식별자·정상 처리 보고를 기본 화면에 늘리지 않는다. 정확도·불확실성 경고와 해당 화면에 필요한 출처·이용 조건은 유지한다.

## CSS·상태 소유권

의존 방향은 Tokens → Primitives → Components → Layout → Features다. 원본은 `src/ui/css/`에 두고 bundle 원본 목록과 순서는 [ui-source-catalog.mjs](../../scripts/lib/ui-source-catalog.mjs)가 소유한다. 생성 bundle은 직접 편집하지 않는다.

- Tokens는 색상·간격·글꼴·치수·radius·shadow·z-index를, Primitives는 버튼·입력·탭·행·아이콘의 외형과 상태를 소유한다.
- Components는 surface·header·section·field·dialog 등 조합 단위의 skin을, Layout은 위치·크기·반응형 노출과 variant 선택을 소유한다. Features는 도메인 표현과 콘텐츠 배치만 추가한다.
- 같은 시각 속성의 결정권자는 하나다. 다른 계층은 variant나 token으로 차이를 요청한다. 파일 로드 순서나 specificity 덮어쓰기로 다른 소유자의 속성을 재정의하지 않는다.
- 새 UI 스타일에 ID selector와 !important를 추가하지 않는다. ID는 JS·ARIA 연결에 사용한다. 색 literal은 token 계층에서만 정의하며 spacing/geometry는 semantic token을 사용한다.
- Layout은 색상·테두리·배경·그림자·글자를, Feature는 공통 component의 padding·border·radius·background·shadow를 다시 정의하지 않는다.
- 새 루트 CSS·별도 cleanup layer를 만들지 않는다. `app.css`에 새 보정을 추가하거나 크기 예산을 늘리지 않는다. 공통 규칙을 담당 layered CSS로 옮긴 뒤 중복을 제거한다.
- 예외는 적용 조건·담당 컴포넌트·이유를 소유 코드와 일치시킨다. 기존 override나 feature 전체를 예외의 근거로 삼지 않는다.
- 정적 presentation은 HTML/CSS, 열림·닫힘·시트·focus·피드백은 해당 controller가 소유한다. DOM 클래스·문구·dataset에서 domain state를 역추론하지 않는다.
- 이벤트는 정본 workflow를 호출하고 Promise 실패는 해당 UI/작업 경계에서 처리한다. 표시용 상태가 프로젝트의 두 번째 정본이 되어서는 안 된다.

## 객체 표시와 현재 화면

- 객체명·아이콘·분류·레이어 매핑은 [map-object-categories.js](../../src/document/map-object-categories.js)의 MAP_OBJECT_TYPES / MAP_OBJECT_CATEGORIES를 공유한다. 이 표시 메타데이터는 저장 스키마의 정본이 아니다.
- 검색·레이어·점검 UI는 같은 타입 메타데이터를 소비한다. 화면마다 별도 객체 이름표나 action registry를 만들지 않는다.
- 검색 결과의 유형·로딩·오류 표시를 유지한다. 주 선택은 세로 막대, 보조 선택은 약한 선택 배경을 사용한다. 지도 강조는 [지도 표시 정책](map-rendering.md)을 따른다.
- 공통 UI 변경은 기존 component 재사용, 공통 component 확장, layout 조정, 도메인 고유 표현의 순서로 책임을 찾는다. UI 정리를 이유로 domain·renderer를 함께 재작성하지 않는다.
- 검증 범위는 [검증 정책](validation.md)을 따른다. 영향받은 desktop/touch 흐름에서 긴 제목·글자 확대·스크롤·키보드 focus와 실제 조작 결과를 확인한다. 내부 selector·파일 구조·과거 화면 목록을 별도 통과 조건으로 고정하지 않는다.
