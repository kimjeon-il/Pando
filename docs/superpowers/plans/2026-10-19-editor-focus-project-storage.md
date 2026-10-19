# 앱 편집 집중과 프로젝트 저장 범위 재정의

승인된 대화 계획의 구현 기록. 기존 work/ui 변경을 보존한다. main 통합·배포는 제외한다.

## Task 1: 저장 계약과 열람 상태

Web/Core 프로젝트 버전을 12로 올리고 명시적인 documentId를 저장한다. 새 문서는 UUID를 만들고 저장/재열기/다른 이름으로 저장에는 유지한다. 문서는 작성 내용·스타일·첨부·출처·아카이브와 명시적으로 설정한 defaultView(월, 프로젝트 객체 표시/숨김, 분포 대상/모드)를 가진다. runtime editorState.lastViewedMonth와 배경 설정은 프로젝트에서 제거한다. 실제 형상 의존 출처는 유지한다. 구형 포맷 변환 없이 명시적으로 거절하고 기존 바이트를 보존한다.

ProjectSession의 기존 열람 overlay를 양쪽 제품에서 사용한다. Core가 defaultView와 작성 스타일 명령/이력을 소유한다. 현재 열람 상태를 기본 화면으로 지정하는 단일 명령은 초안 중 차단하고 Undo/Redo·dirty·자동저장을 지원한다. 파일 열기는 저자 기본 화면과 전체 범위로, 앱은 flat으로 시작한다. 시작 복원은 documentId별 기기 작업상태(월·카메라·투영·임시 표시)를 사용한다. 기본 화면 복귀는 배경 환경설정에 영향을 주지 않는다. 기존 PersistenceService/storage를 확장하고 지연 요청의 프로젝트 간 오염을 차단한다.

## Task 2: 앱 배경과 지연 자원

앱 지형 UI·로딩·준비·타일 패키징을 비활성화한다. 웹은 유지한다. builtin 수계/지명은 앱 초기 off, 명시적 활성화 때만 로드한다. full-world 오프라인 자료는 유지하고 small-project 미지원 기능은 노출하지 않는다. 프로젝트 수계는 별도로 표시/편집한다. physicalResourcesEnabled를 세분화된 불변 capability로 대체하고 init/load/renderer/staging 전체에서 적용한다. 신규 앱 flat, globe는 유지하며 경위선·그림자 기본 off. 참조 이미지/트레이싱은 첫 사용에 초기화한다. 검색·시점·이름·깃발·경계·설정·Undo/Redo·자동저장은 유지한다.

## Task 3: UI·검증·기록

기존 프로젝트 설정에 기본 화면 지정·복귀를 연결한다. Core/GPKG/autosave/Worker 및 모든 현재 소비자와 테스트를 함께 갱신한다. 내용·첨부·출처·아카이브 v12 왕복, 기본 화면 Undo/Redo, 임시 상태 non-dirty, workspace 격리·취소·손상·연속 열기·저장 실패, 앱 지형 0 요청/준비, builtin 지연 활성화, 앱 편집 대표 흐름, Canvas/WebGL/저사양 시작 및 제품별 staging을 관련 검사로 검증한다. Windows/Android 실제 실행이 불가능한 항목은 미검증으로 표시한다. 보고서는 reports/와 색인에 기록한다.
