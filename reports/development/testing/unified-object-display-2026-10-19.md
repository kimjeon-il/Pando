# 상위·하위·지방 객체의 표시 규칙 통합

> 보고서 ID: `UI-OBJECT-DISPLAY-20261019` · 상태: `focused-verified / android-device-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-19  
> 조사 기준: 웹·앱 공통 `work/ui` / `44fb6d41977123b5220cde8078f1e9a7e38b2728` + 보존한 미커밋 변경 위의 이번 수정  
> 원본·출처: 아래 정본 모듈 및 `.superpowers/sdd/2026-10-19-unified-object-display/` 실행 기록

## 대상과 범위

사용자 요청은 상위·하위·지방 판정 중 불필요하게 나뉜 표시 규칙을 찾아 공통 ‘객체’ 설정으로 통합하는 것이다. 영토 소유권, 실제 부모 관계, 유효기간, 일반/지방 모델 구분을 삭제하는 작업은 아니다.

기존 상설 UI 워크트리를 사용했다. 기존 프로젝트 설정·편집·비교 화면 등의 미커밋 변경을 작업 전 보관한 기준과 비교했으며, 자동 stash·초기화·분야 간 변경 이동은 하지 않았다. 원격 `work/ui`의 생성물 변경 1개 커밋은 겹치는 미완료 작업 위로 병합하지 않았다. `main` 통합·커밋·푸시·배포는 이번 작업에서 실행하지 않았다.

## 조사 결과와 적용

| 책임 | 발견한 분기 | 현재 규칙 |
| --- | --- | --- |
| 보기 메뉴·공통 스타일 | 상위/하위/지방의 별도 표시·색상·불투명도·경계 설정 | `objects` 하나, 사용자 표시명 ‘객체’ |
| 이름·깃발 | 종류마다 다른 전역 키와 UI | `objectNames`, `objectFlags` 공통 스위치 |
| 개별 숨김 | 부모/종류를 보고 다른 그룹에 저장하거나 이동 | `itemVisibility.objects[id]` 하나. 소속이 바뀌어도 같은 ID의 숨김 유지 |
| 검색·선택·포인터 | 종류별 목록/검색 그룹/표시 판정 | 같은 객체 목록과 실제 부모 관계 사용. 현재 시점의 존재 여부와 표시 설정 적용 |
| 공통 스타일 변경 | 하위 객체 개별 스타일을 별도로 덮어쓰기 | 공통 스타일만 변경. 명시적인 개별 스타일 보존 |
| 생성·병합·복사·이력 | 하위/지방만 자동 표시, 종류별 이력 보정 플래그 | 암묵적 자동 켜기와 관련 전용 이력 상태 제거 |
| 렌더러 연결 | 하위 객체가 있으면 상위 표시를 다시 켜는 Proxy | 실제 공통 상태를 직접 전달 |
| Canvas | 화면 자료 ID와 canonical 객체 ID 혼용 | 기존 `isRenderCountryVisible` 경계를 통해 변환. Worker에는 실제 화면 자료 ID 전달 |
| 이름 표현 그룹 | `countryLabels` | `objectLabels` |

정본은 `layer-presentation.js`, `map-display-catalog.js`, `object-query.js`, `object-catalog.js`, `object-search-model.js`, `app-map-settings.js`, `map-content-presentation.js`, `territorial-fill-style.js`와 공통 C++ presentation/command/document-session 소유자다. 웹·앱은 같은 보기 fragment와 같은 상태/렌더링 규칙을 사용한다. 제거한 메뉴를 CSS로 숨기거나 과거 키를 alias로 남기지 않았다.

실제 합성 역할은 `territorialPaintRole`로 판정한다. 상위 일반 객체의 기본 면, 부모 소유권을 따르는 일반 하위 면, 독립적으로 겹치는 지방 면은 서로 다른 그리기 역할이다. 일반 자식의 부모 색상·불투명도 상속, 지방의 독립 면, 내부/외부 경계 위상과 선택 순서는 보존했다. `countriesVisible` 같은 저수준 기본 면 패킷 이름과 국가 자료 파일명은 별도의 사용자 보기 설정이 아니다.

## 저장 형식과 자료 보존

현재 프로젝트 형식은 **13**, layer presentation은 **5**다. Web/Core/GeoPackage/앱 예제/현재 테스트 입력/내장 역사 프로젝트 생성기를 함께 갱신했다. 과거 개발 형식이나 이전 표시 키의 변환·호환 reader는 추가하지 않았다. v12 프로젝트는 명시적으로 거절하며 기존 파일·자동저장을 삭제하지 않는다.

내장 역사 프로젝트의 작업 전 v12 gzip과 현재 v13 gzip을 해제해 비교했다. 객체 277개와 geometry archive 274개를 포함한 `territorialEntities`, `geometries`, `timelineRecords`, `sourceInfo`, `labels`, `genericFeatures`, `hydroEdits`, `distributionLayers`, `distributionEntries`가 모두 일치했다. 이 작업에서 역사 형상을 조사·수정하거나 화면 오차 기준을 검증한 것은 아니다. 근거: `data-parity.json`.

최종 WASM source SHA-256: `bdda6607b214b04bc42fca27fad4c1559eb53b9c7ef793a23cd2ee9bb067e733`.

## 검증

- 최초 회귀 검사의 실패를 확인한 뒤 공통 설정을 구현했다: `red.log`.
- 관련 단위·저장·제품 HTML/자산·두 앱 staging 프로필 검사 **214/214 통과**: `verified-tests.log`. 전체 테스트 모음을 실행한 결과는 아니다.
- C++ `project_codec_tests`, `document_session_tests`, `source_admission_tests`, `web_object_command_tests` **4/4 통과**: `native-final2.log`. 오래된 문서 ID 기대값, 제거된 저장 필드, 잘못된 날짜 입력 위치와 label 표시 키를 현재 계약으로 갱신했다.
- Canvas Worker와 직접 그리기에서 native 자료 ID가 canonical 객체 숨김을 따르는 회귀 검사 통과. 숨긴 `HKG`의 경로가 그려지지 않고, Worker에는 UUID 대신 `HKG`가 전달되는 것을 확인했다.
- 변경한 production JS **28개 ESLint 통과**: `lint-verified.log`.
- 실제 브라우저 **5/5 통과**: WebGL·Canvas 공통 메뉴, 키보드와 모바일 전환, 원본 데이터 보존, Canvas 객체 본문 선택, `.gpkg` 열기·손상 파일·취소·연속 요청 처리를 확인했다. `browser-verified.log`, `webgl.png`, `canvas.png`. 화면은 합성 테스트 자료다.
- 영향을 받는 브라우저 소비자도 현재 공통 메뉴와 저장 계약으로 갱신했다. 관련 **18개 소스 구문 검사 통과**: `browser-syntax-final.log`. 그 외 브라우저 시나리오 전체를 실행했다는 의미는 아니다.
- Windows full-world 디버그 앱을 최종 수정까지 포함해 빌드하고 실제 WebView2에서 canonical probe **12/12 통과**: `windows-verified-build.log`, `windows-verified-probe.log`, `windows-verified/world-windows.json`. 패키지·geometry·mesh·data Worker·historical world·renderer·요청 차단 검사다. 앱의 Core source SHA는 현재 manifest와 일치하며 내장 Core 3개 자산의 해시를 확인했다. 변경한 공통 JS **28개도 앱 staging과 바이트 일치**했다: `windows-parity.json`, `shared-js-staging-parity.json`.

Canvas 본문 선택 검증에서 뷰어가 등록하지 않는 편집 서비스를 공통 클릭 처리기가 호출하는 기존 오류를 재현했다: `readonly-picking-red.log`. 기존 편집 클릭 capability 등록 여부로 편집 전용 분기만 제한했다. 뷰어용 가짜 편집 서비스를 만들지 않았다. 읽기 전용 본문 선택과 편집기의 꼭짓점 확정 우선순위를 각각 검사했고, 실제 Canvas 본문 선택도 통과했다. 최종 코드에 대한 별도 읽기 전용 리뷰에서 Important/Critical 지적은 없었다. 리뷰는 실행 검증의 대체 증거가 아니다.

검색·연도 이동·공통 표시 조작의 프로젝트 비변경, 시점별 부모 관계가 바뀌어도 개별 숨김 유지, 개별 스타일 보존, 삭제·Undo/Redo, 현재 저장·재열기와 이전 형식 거절을 실제 Core로 검사했다. 경계 검사에서는 위상·좌표 허용 오차를 완화하지 않았다. 관련 테스트의 과거 별도 키와 낡은 목을 현재 소유자/팩토리로 교체했다.

## 한계와 판본

Android `adb devices`에 연결 기기가 없었다. Android 실기기의 화면 방향·접기/펼치기·키보드 동작은 이번 결과로 검증됐다고 주장하지 않는다. 배포 사이트와 `main`은 이번 작업 결과가 아니다. Windows canonical probe의 데이터/Worker/렌더러 준비 검사는 수동으로 모든 편집 동작을 재현했다는 의미가 아니다.

중간 실패와 수정 전 실행 기록도 원시 근거로 보존했다. 최종 판정은 위에 명시한 최종 실행 로그를 기준으로 한다. 관련 검사만 실행했으며 전체 브라우저·전체 네이티브 모음이나 Android 빌드·기기 검증으로 범위를 확대하지 않았다.

이 보고서는 이번 객체 표시 통합의 기록이다. [이전 앱 편집 집중·저장 범위 보고서](editor-focus-project-storage-2026-10-19.md)의 결과를 이번 수정에 대한 실행 증거로 대체 사용하지 않았다.
