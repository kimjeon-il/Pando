# 영토 객체 계약

영토 객체는 단일 `territorialEntities` 컬렉션의 `general` 또는 `regional` 정체성이다. 현재 버전의 정본은 [버전 상수](../../src/runtime/version-contract.js), [정체성 필드](../../src/document/territorial-units.js), [시간 기록](../../src/document/timeline-records.js)다. 이전 개발 형식의 별칭·자동 마이그레이션은 제공하지 않는다.

## 정체성과 시간 기록

저장된 정체성의 `geometry`는 null이며 이름·스타일·잠금·메모·출처 신원을 보유한다. 형상은 공통 geometry registry의 `id`·`version`으로 식별하고 시점별 `geometryBindings`로 연결한다. 존속기간·부모 관계·시간 속성은 `timelineRecords`가 소유한다. Feature ID, typed ObjectRef, 형상 ID와 원자료 ID를 암묵적으로 혼용하지 않는다.

시점 조회는 [C++ 시간축](../../src/document/native/src/temporal.cpp)과 [문서 경계](shared-core-command-boundary.md)를 사용한다. 유효한 형상이 없는 기간에 현대 형상을 임의 대입하지 않는다. 기간 끝점은 포함하며 연·월·일 정밀도와 BCE/CE 의미는 [시간 계약](../timeline-contract.md)을 따른다.

## 관계와 명령

일반객체의 루트·자식은 시점별 부모 관계로 표현하고 `partition`·`explicit` coverage를 구분한다. 부모의 존재·종류·기간, 순환, 잠금과 형상 제약은 C++에서 검증한다.

변경은 [프로젝트 도메인](../../src/document/project-domain.js)을 통해 같은 Core 소유자에 전달한다. UI·DOM·renderer는 별도 문서 정본을 만들지 않는다. 실패한 변경은 부분 적용되지 않으며 Undo/Redo는 형상·기록·속성과 저장 상태를 함께 복원한다.

## 검증

현행 모델 팩토리와 작은 fixture로 부모 오류·순환·잠금·기간 경계·형상 결과·원자성·Undo/Redo를 확인한다. 검사 선택은 [등록 계약](../../scripts/contracts/application-checks.json)을 따르며 전체 자료·GIS 검증은 별도 요청 없이 실행하지 않는다.
