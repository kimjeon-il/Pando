# 웹 T2-2 프로젝트 영속성 통합

사용자가 승인한 계획을 기존 `feat/timeline-web` checkout에서 이어서 구현한다.
앱 구현과 Qt 검증은 별도 작업이다. main/통합 브랜치 병합, 배포, T3 resolver,
T4 날짜별 편집, 새 타임라인 UI와 구형 프로젝트 migration은 범위에 포함하지 않는다.

## 정본과 현재 형식

- 객체 저장소는 논리 ID, general/regional 종류와 메타데이터를 소유한다.
- lifetimes, geometryBindings, parentRelations가 기간·형상 참조·부모·coverageMode를 소유한다.
- 기존 편집기는 정본에서 파생한 읽기 전용 정적 Feature를 사용한다.
- 프로젝트 schemaVersion 9, 기록 schemaVersion 1. timelineRecords와 전체 geometries archive를 필수로 저장한다.
- 영토 Feature는 geometry:null을 저장한다. 공유 형상과 미참조 과거 버전을 보존한다.
- 이름·수도·출처를 보존하고 지원하지 않는 필드/정치 관계를 거부한다.

## 저장·복원·history

1. 기존 serializer와 GeoPackage Worker에 v9를 연결한다. 프로젝트 JSON이 정본이며
   정적 공간 레이어는 파생한다. 복잡한 시간/빈 프로젝트에는 공간 레이어가 없어도 된다.
2. 저장 검증과 활성화 검증을 분리한다. 분리된 후보 객체/형상 저장소에서 스키마,
   기록, 참조와 전체 불변조건을 검사하고 성공한 뒤 게시한다.
3. 무기한 lifetime/binding/parent가 객체마다 하나일 때만 기존 UI를 활성화한다.
   복잡한 시간 프로젝트는 저장·교환 가능하지만 UI 활성화 전에 TIMELINE_ACTIVATION으로 거부한다.
4. full/delta 자동저장과 snapshot·command·transaction·Undo/Redo에 기록과 archive를 포함한다.
   delta는 기준 데이터 이름과 정규화된 객체·메타데이터·형상 SHA-256이 모두 일치해야 복원한다.
5. 커서는 콘텐츠 snapshot/dirty/history에서 제외한다. Worker에는 분리된 snapshot을 전달한다.

## 검증과 결과물

- 원격 HEAD와 작업 상태를 확인하고 이후 커밋·현재 변경·ignored 산출물을 보존한다.
- 커밋 기준 T1/T2-1/T2-2a/저장/history를 먼저 실행하고 기존 실패와 현재 변경 실패를 구분한다.
- 통합 회귀의 실패를 확인한 뒤 구현한다. fixture는 실제 snapshot 계약을 사용한다.
- production serializer, 파일 Worker와 프로젝트 소유자를 통해 시간/형상/메타데이터,
  참조·겹침·공백·잘못된 필드·delta 기준 불일치·실패 원자성을 검증한다.
- 실제 브라우저 파일 저장/열기, full/delta 복구, 기존 명령 Undo/Redo와 복잡한 파일 활성화 거부를 검증한다.
- 관련 unit/Worker/브라우저 회귀, 직접·간접 소비자 fixture와 변경 파일 lint를 검증한다.
- 필수 검증은 실패 0·skip 0이어야 한다. 미실행 항목은 통과로 표시하지 않는다.
- 정적/복잡 시간 v9 JSON·GeoPackage·예상 의미 파일을 남긴다. 앱 왕복은 이번 검증에 포함하지 않는다.
- 검증된 변경만 기존 feature 브랜치에 커밋하고 일반 push 후 원격 SHA를 확인한다.

실제 연결 경로와 검증 결과는 `docs/timeline-persistence.md`에 기록한다.
