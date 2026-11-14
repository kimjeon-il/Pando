# 객체·시간축 정책

## 정본과 식별자

- 날짜별 객체·관계·형상 판정과 변경 수용은 `src/document/native/`의 C++/WASM `Project`·`DocumentSession`이 소유한다. JS `src/document/project-domain.js`는 같은 Core 경계를 연결한다. UI·DOM·렌더러·Worker는 별도 가변 문서나 시간축을 만들지 않는다. 현재 제품은 읽기 전용 Web Viewer와 그 안의 지연 로딩 점검기다.
- `territorialEntities`는 `entityKind: general | regional`의 단일 정체성 컬렉션이다. 정체성의 `geometry`는 null이며 이름·스타일·잠금·메모·출처를 보유한다. 일반객체의 루트·자식은 시점별 부모 관계로 결정한다. regional은 독립 형상을 유지하며 행정 부모를 갖거나 다른 객체의 부모가 되지 않는다. 부모·루트로 주권·실효지배·국제 승인을 추론하지 않는다.
- 프로젝트 객체 ID, typed `ObjectRef {domain,id}`, 기록 ID, 형상 `{id,version}`, 원자료 `sourceEntityId`·FID·형상 versionId 및 렌더링 ID는 별개다. 같은 논리 객체의 시점이 바뀌어도 ID를 바꾸지 않으며 ID 도메인 변환은 명시적인 경계에서만 한다.
- `src/runtime/version-contract.js`의 현재 프로젝트 스키마는 14, territorial model은 6, Generic은 2, provenance는 1, layer presentation은 5다. `src/document/timeline-records.js`는 타임라인 3, `timeline-storage.js`는 체크포인트 1을 소유한다. 이전 개발 형식·별칭·자동 마이그레이션을 추가하지 않는다. 스키마 변경 시 reader·writer·autosave·복원·Undo·Worker·직접 소비자와 fixture를 함께 갱신한다.

## 시간 의미

- 커서는 `YYYY-MM` 달 단위이며 그 달 마지막 날 상태를 뜻한다. 자료 endpoint는 연·월·일 문자열과 기존 parser의 확장·음수 연도를 허용한다. 연도 0은 없고 BCE/CE 연결에서도 0을 건너뛴다. 윤년은 공통 C++의 proleptic Gregorian 계산을 따른다.
- 모든 기간은 양끝 포함이다. 연·월 endpoint의 시작은 첫날, 종료는 마지막 날로 비교한다. null은 해당 방향 제한 없음이다. 원래 정밀도와 signed-year 표현을 보존하며 숫자 강제 변환·월 반올림·미상 날짜 추정을 하지 않는다. 시작이 종료보다 늦으면 오류다.
- `timelineRecords`의 `lifetimes`, `geometryBindings`, `parentRelations`, `propertyBindings`가 각각 존속·형상·부모·시간 속성을 소유한다. 동일 의미 슬롯의 중첩은 오류이며 last-write-wins나 배열 순서로 해결하지 않는다. 서로 떨어진 여러 존속기간은 허용한다.
- 존속기간과 지도 형상 제공기간은 별개다. 객체가 살아 있어도 지도 자료가 없을 수 있으며 그 공백에 현대/대표 형상을 대입하지 않는다. 영토의 형상·부모 기록은 같은 지도 제공 범위를 가져야 하고 존속 공백을 가로지를 수 없다. 부모 존재·종류·기간·자기 참조·순환은 월말 화면에 보이지 않는 하루까지 포함해 Core가 검증한다. 루트와 regional은 explicit coverage, 일반 자식은 `partition`·`explicit`을 구별한다.
- 날짜 조회는 `src/document/temporal.js`, C++ `temporal.cpp`와 현행 resolver를 사용한다. 커서 이동은 콘텐츠 revision·dirty·Undo/Redo를 바꾸지 않는다. 시간 편집 명령이 월 구간을 분기할 때 이전 기록은 전월까지, 새 기록은 선택 월부터 적용하며 원본 일자 정밀도를 임의 변경하지 않는다.

## 형상·수계·명칭

- 형상 버전은 불변이며 저장·복원·Undo는 공유·과거·미참조 버전까지 전체 archive를 보존한다. 같은 ID/version 덮어쓰기, 자동 가지치기·반올림·단순화·ring 교정을 하지 않는다. 형상 ID는 비어 있지 않은 문자열, version은 1..4294967295 정수다. 참조 존재성과 도메인별 형상 종류를 실제 registry로 검증한다. 구조적 좌표 검증을 위상·역사 정확도 검증으로 표현하지 않는다.
- 작성 수계는 `hydroEdits`와 공통 타임라인이 소유하며 `hydroEdits[].geometry`는 null이다. `territorial`, `hydro`, 읽기 전용 `hydroBuiltin`을 구분한다. 강·호수에 필수 국가 부모나 국기를 부여하지 않는다. 기본 수계의 날짜 선택도 공통 C++ 원자료 기록을 사용하며 조회만으로 전체 수계를 다운로드하지 않는다.
- 수계 binding의 `rendering`은 `stroke_width`, 정점 순서별 `stroke_widths`, `border_aligned`, `connectivity`를 소유한다. 좌표 편집 후 기존 정점 폭·연결을 제거하되 기본 폭은 유지한다. 원본의 다른 버전을 바꾸지 않는다. 물리 수면의 표시 대체는 명시적 `replaces` 참조로 처리하고 준비 성공 전·실패 시 원본 표시를 유지한다. 개별 호수의 승인 표시 구간을 전체 수계의 일반 날짜 정책으로 확대하지 않는다.
- 원자료 `names`·`alternateNames`와 날짜별 `nameVersions`를 구분한다. common/formal, 명시한 native 언어·별칭을 보존하고 미상 번역·정식명·날짜를 만들지 않는다. 형상과 명칭은 같은 시간 계산으로 독립 선택하며 명시적 명칭 공백을 다른 시기 이름으로 채우지 않는다. 기본 지명의 외부 `nameTimeline`은 프로젝트 객체 기록이나 도시의 실제 존속기간과 동일하지 않다.
- Generic은 의미를 분류할 수 없는 외부 형상의 손실 없는 fallback이다(`creatable:false`, `fallbackOnly:true`). 판별 가능한 데이터는 territorial·distribution·hydro·label 도메인을 사용한다. Generic을 새 영역 유형이나 자유 생성 객체로 확장하지 않는다. 현행 provenance가 원본 미대응 필드를 보존하며 이 원칙이 구형 형식 reader를 허용하지는 않는다.

## 명령·저장 경계

- 지원되는 명령은 Core에서 후보 검증 후 하나의 이력 단위로 확정한다. 서비스·UI는 문서 revision·이력·dirty를 직접 쓰지 않는다. geometry 초안 이력은 문서 이력과 구별한다. 오래된 문서·월·세대·자료의 비동기 후보는 적용하지 않는다.
- renderer/Worker의 `applyAccepted`가 실패하면 같은 Core capsule로 문서·이력·선택·초안을 복원하며 성공 알림·자동저장을 게시하지 않는다. 저장은 선행 명령의 확정/복원을 기다리고 같은 epoch의 정본 JSON·공간 투영을 사용한다. 늦은 저장 응답은 새 프로젝트나 최신 편집을 saved로 표시할 수 없고 자동저장은 명시적 파일 저장 checkpoint를 지우지 않는다.
- 파일 형식·출처 및 보기 상태 격리는 [프로젝트·자료 정책](data-projects.md)을 따른다. 현재 Viewer의 보기 상태 저장을 편집 자동저장이나 파일 저장 기능으로 확대 해석하지 않는다. 영향받은 실제 workflow와 작은 fixture의 실패 원자성·기간 경계·참조·잠금·Undo/Redo만 검증하며 전체 검사는 AGENTS.md의 별도 범위다.
