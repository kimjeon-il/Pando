# 검사·검증 현재 계약 검수 — 2026-10-06

기준 main: `01b6e4d0734f75b5e880211652e3acdea85e4db1`.
작업 브랜치: `codex/validation-current-contracts`.
이 기록은 웹 검사 최신화이며 앱 교차검증 또는 배포 증거가 아니다.

## 분류와 보정

- 낡은 검사 계약: 삭제된 버튼·폼·선택 API, 객체 ID와 라벨 원본 ID 혼동,
  옛 저장 스키마·불완전한 자동저장 fixture, 이전 CSS/JavaScript 소유 모듈,
  고정된 옛 preview 파일명·수계 v4 논리 단위를 현재 구현으로 갱신한다.
  저장 fixture는 기존 production serializer와 현재 정적 timeline factory를 사용한다.
- 실제 제품 결함: 국기 메뉴의 `!type === 'entity'`는 Boolean과 문자열을
  비교하여 수계 등에서도 메뉴가 남았다. `type !== 'entity'`로 수정하고
  객체 유형 전환을 실제 컨트롤러 및 브라우저에서 검증한다.
- 실제 생성 도구 결함: 역사 형상 재생성에서 기존 기본 국기 metadata가
  사라지고 항목 순서가 바뀌었다. recipe가 소유하는 생성 필드는 갱신하되
  별도로 관리되는 catalog metadata와 기존 위치를 보존한다.
- 실제 표시 캐시 결함: 수계 Undo는 정본 collection을 교체할 수 있지만 국가
  형상 revision은 그대로일 수 있다. revision만으로 변경을 무시하던 GPU
  수계 캐시가 복원된 색상을 건너뛰는 회귀를 실제 renderer에서 재현했다.
  기존 캐시의 입력 식별 조건을 collection 원본 참조와 revision으로 명확히 하고
  동일 입력은 재구성하지 않는다. 저장 모델 또는 revision API를 추가하지 않는다.
- 실제 라이브러리 전달 결함: 전체 프로젝트 검증기에 schema/record/archive가
  없는 `atlasMetadata.projectState` 부분 객체를 전달하여 정상 정적 항목도
  `PL-SCHEMA-MISSING`으로 실패했다. 해당 가짜 payload를 삭제하고 기존 GIS
  병합 경로로 전달한다. 유한 기간은 날짜를 그대로 보존한 채
  `TIMELINE_ACTIVATION`으로 거부하고 현재 session을 보존하며, 정적 항목은
  국기·출처·형상 버전과 단일 history를 유지하여 정상 병합한다.
- 실제 실패 원자성 결함: Store에서 후보를 게시하기 전에 거부했는데도 GIS
  catch가 공개 snapshot 복원을 실행하여 state revision과 렌더 대기 상태를
  바꿨다. 기존 Store의 게시 여부와 외부 mutation 시작 여부에 따라 필요한
  경우에만 복원한다. 게시 전 유한 기간 거부는 복원을 호출하지 않으며,
  외부 mutation 후 실패와 게시 후 검증 실패에서는 전체 snapshot 복원을 유지한다.
  동일한 엄격한 브라우저 snapshot 비교로 발견한 문제이며 기대값을 완화하지 않는다.
- 실제 삽입 핸들 결함: 경계선 hover가 만든 삽입 핸들로 포인터가 넘어가면
  segment mouseleave가 곧바로 canonical insertTarget을 지워 클릭 전에
  핸들이 사라졌다. 기존 `renderDraft`/`renderDraftInsertionHandle`의 handler가
  같은 draft layer 내 segment↔handle 전환은 유지하고 외부 이동은 정리하도록
  수정한다. editing-domain의 상태 소유·삽입·history 구현은 변경하지 않는다.
  실제 등록 renderer handler를 실제 editing-domain에 연결한 회귀로
  최신 좌표 삽입·단일 history·Undo 및 다른 layer/외부의 정리를 확인한다.
- 실제 꼭짓점 입력 순서 결함: 삽입 후 새 segment hit path가 재사용된 vertex
  뒤에 붙어 꼭짓점 중앙의 입력을 가로챘다. 현재 SVG owner인 `renderDraft`가
  vertex를 segment 뒤로 재배치하여 우선순위를 유지한다. 실제 D3 3.5.6에는
  `raise()`가 없으므로 기존 DOM `appendChild`를 사용하며 polyfill을 추가하지 않는다.
  브라우저의 실제 `elementFromPoint`는 수정 전 segment, 수정 후 같은 꼭짓점의
  dot을 반환했다. 단위 harness의 통과를 실제 DOM hit 순서 증거로 대신하지 않는다.
- 실제 수계 생성 검토 결함: 완료된 강의 LineString을 면 전용 검증 경로로
  보내 항상 거부했고, 완료된 current part가 있어도 입력 도구를 계속 활성화하여
  생성 버튼이 숨겨졌다. 기존 `finishGenericFeatureDraft`와 동일하게 선은 완료된
  입력을 조합하고 면만 기존 면 검증기를 사용한다. geometry 없음은 계속 거부한다.
  `toolDraftDefinition`에서 river/lake의 완료된 hydro current part는 입력 종료로
  판정하며, 추가 조각·다시 그리기로 current가 비면 입력을 다시 허용한다.
  toolbar나 commit guard를 따로 우회하지 않고 현재 도구 정의 소유자를 보정한다.
- 원본·생성 기준: GIS 입력 SHA는 정확한 현재 Git blob 내용으로 검증하며
  관련 GeoJSON은 LF로 고정한다. 독일 형상이 과거 기준과 동일함을 별도로
  확인했다. 역사 라이브러리 recipe 용량은 이미 승인된 `1fee826`의 6MiB
  기준과 일치시킨다. 형상·교환 계약 및 runtime 자산을 임의로 재생성하지 않는다.
- 환경: PowerShell Python PATH와 GIS/raster 의존성 누락은 제품 실패와
  구분한다. 의존성은 이번 실행의 ignored 경로에 설치했고 CI는 명시적으로 준비한다.

`tests/application_source.py`는 실제 소스를 합쳐 읽으며 의존성 문장을 지우거나
가상의 owner를 만들지 않는다. CSS 목록은 기존 `ui-source-catalog.mjs`에서
읽는다. shell/preview 버전은 `package.json`의 현재 버전을 사용하되 같은
shell asset URL의 동일 build revision과 실제 파일 존재를 별도로 확인한다.
preview는 현재 version의 파일명과 생성 결과를 검증한다. CSS·DOM owner를
읽는 Python 소스 계약 검사와 실제 브라우저 동작 증거는 구분한다.

## 보존하는 검증

잘못된 입력 거부, 잠금, 실패 원자성, ID·timeline record·geometry archive,
단일 history와 Undo/Redo, 정확한 형상·표시 좌표 검증을 유지한다.
퇴역한 범용 객체 split UI 검사는 현재 자식 객체 cut UI로 대체하고
경계 스냅 좌표, 두 후보의 겹침 없음·원본 coverage, 부모 불변성과 Undo/Redo를
검증한다. 테스트 삭제·skip·오류 무시·legacy 제품 경로 추가로 통과시키지 않는다.

직접 편집선 브라우저 검사는 현재 active coordinate를 드래그의 기준으로
잡고 Undo/Redo 뒤 현재 projection의 표시 프레임을 기다린다. Worker 완료만으로
표시 성공을 판정하지 않는다. 이전 Canvas 실패 3건은 동일 코드의 재실행에서
재현되지 않았으며, 테스트의 좌표/프레임 동기화를 보정했다. 이를 GPU 제품
결함이 해결되었다는 증거로 사용하지 않는다.

프로젝트 schemaVersion 9 / timelineRecords 1 / entity schema 5, 날짜 의미,
정적 UI 활성화 정책과 유한 기간 편집 거부 정책을 변경하지 않는다.
공통 timeline 계약·교환 fixture·앱 저장소를 수정하지 않는다.

국기 표시 검사는 임의의 세계 위치에서 국기가 하나 이상 생긴다는 가정 대신,
현재 factory/production serializer의 단일 정적 객체를 실제 복원하여 검사한다.
production anchor 계산과 native focus/wheel/국기 메뉴를 사용하며, 같은 객체의
국기 크기·축소 시 이름 유지·제거 후 선택/metadata 보존을 확인한다.
세계 전체 anchor 큐의 준비 시간이나 충돌 배치 정책 검증으로 확대 해석하지 않는다.

UI 전용 브라우저 검사는 production raster 경로를 명시하여 DEM 다운로드와
관계없는 버튼/폼 동작을 분리한다. 지형 검사는 해당 모드를 바꾸지 않는다.
대용량 trace 기록 때문에 action/context 종료 timeout이 발생한 실행은 실패로
남기고, 동일 assertion의 trace 없는 재실행과 구분한다. 실제 frame/model 증거와
실패 screenshot을 보존하며 공통 deadline·assertion을 완화하거나 강제 클릭으로
통과시키지 않는다. 작업별 제한 조정은 원래 실패와 측정 근거를 함께 기록한다.

현재 enhanced single-select는 숨겨진 원본 select의 `selectOption()` 대신 기존
`selectUiOption()`으로 실제 control을 연다. 검색형 control의 제한된 결과 목록은
실제 입력으로 필터링한다. 전체 브라우저 목록의 직접 `selectOption()` 10곳을
갱신했으며 multiple/size/native 제외 조건을 현재 select-controller와 대조했다.
분포 표시 회귀는 실제 DEU/FRA 원본 형상 두 개를 production 정적 serializer로
저장·복원하여 검사한다. 논리 ID/저장 값/단일 표시/겹침/경계 토글 assertions를
유지한다. 전 세계 형상 준비 시간이 기존 90초 action 예산을 소진한 실패 기록은
남기고 이 focused 실행과 구분한다.

## CI

기존 workflow의 감시 경로에 검사 script·공통 helper·Python 검사·도구·생성 자산을
포함한다. Python 3.12와 GIS/raster 의존성을 명시적으로 설치한다.
루트 discover에서 누락되던 별도 DEM discover를 CI 및 `test:python`에 연결한다.
syntax/ESLint는 tools와 tests/helpers도 검사한다. 현재 generated preview 및
역사 라이브러리 검사를 별도 data job에서 실행한다.

일반 browser spec의 단독 변경도 workflow를 시작한다. 기존 changes job이
변경된 spec과 변경 helper를 직접·간접 사용하는 실제 spec을 선택하고,
기존 Playwright로 파일별 실행한다. 이미 기존 job이 전체를 담당하는 M1/M2
등의 spec은 중복 실행하지 않는다. 일부 grep만 담당하던 selection/interaction
spec은 파일 전체를 검사한다. 공통 서버·fixture 변경에는 관련 smoke 파일을
선택하며 모든 실패 로그·trace를 업로드한다. 이 설정의 로컬 선택기/YAML
검증과 GitHub에서 해당 job이 실제 성공했다는 증거는 구분한다.
수동 실행과 package/lock/ESLint 설정 변경에도 7개 smoke 파일을 선택한다.
`tests/unit/current-browser-contracts.test.mjs`는 실제 workflow의 inline 선택기를
실행하고 git diff 입력만 대체하여 파일 선택·실제 helper 사용처·중복 제외·
수동 실행을 검증한다. 복제한 선택 로직으로 테스트하지 않는다.

## 실행 기록

실행 로그 및 브라우저 trace/screenshot은 worktree의 ignored `test-results/`에
보존한다. 아래 값은 실제 실행한 범위만 기록하며 전체 browser 통과와 구분한다.

| 검사 | 결과 | 증거 |
| --- | --- | --- |
| 변경 전 전체 Node unit | 1668 통과 / 0 실패 / 0 skip | validation-unit-baseline.log |
| 변경 전 Python root | 225 실행 / 102 실패 / 22 오류 / 0 skip | validation-python-baseline.log |
| 국기 표시 회귀 | RED 1 → GREEN 1 / 0 실패 / 0 skip | object-property-controller.test.mjs |
| 역사 생성 보존 회귀 | RED 1 → GREEN 1 / 0 실패 / 0 skip | test_historical_generator_contract.py |
| 역사 라이브러리 strict 검사 | 통과, 26 항목 | validation-historical-verified.log |
| Canvas 기존 실패 3건, 변경 전 | 3 통과 / 0 실패 / 0 skip | validation-canvas-baseline.log, validation-canvas-river-baseline.log |
| Canvas 편집선 동일 3건, 보정 후 | 3 통과 / 0 실패 / 0 skip | validation-canvas-verified.log |
| 최신 통합 전체 Node unit, 수계 캐시 보정 전 | 1669 통과 / 0 실패 / 0 skip | validation-unit-final.log |
| 수계 캐시 보정 포함 전체 Node unit | 1670 통과 / 0 실패 / 0 skip, `node --test --test-concurrency=4 "tests/unit/*.test.mjs"` | validation-unit-candidate.log |
| CI 선택기·라이브러리 통합 보정 포함 전체 Node unit, GIS 복원 보정 전 | 1682 통과 / 0 실패 / 0 skip, 동일 명령, exit 0 | validation-unit-final-integrated.log |
| GIS 실패 복원 보정 포함 최종 전체 Node unit | 1683 통과 / 0 실패 / 0 skip, 동일 명령, exit 0, 77.3초 | validation-unit-final-candidate.log |
| 삽입 hover 보정과 신규 4 회귀 포함 전체 Node unit | 1687 통과 / 0 실패 / 0 skip, 동일 명령, exit 0, 59.2초 | validation-unit-final-hover-candidate.log |
| 수계 복원 캐시 회귀와 관련 unit, 보정 후 | RED 6 통과 / 1 실패 → GREEN 42 통과 / 0 실패 / 0 skip | validation-hydro-restore-red.log, validation-hydro-restore-final.log |
| 실제 라이브러리 조립/GIS/Store 통합 회귀 | RED 3 통과 / 2 실패 (`PL-SCHEMA-MISSING`) → GREEN 5 통과 / 0 실패 / 0 skip | validation-browser-audit-library-unit-red.log, validation-browser-audit-library-unit-green2.log |
| 최신 Python root / DEM | 247 / 14 통과, 각각 0 실패 / 0 오류 / 0 skip | validation-python-final.log |
| 마지막 라이브러리 전달 보정 후 관련 Python | 10 통과 / 0 실패 / 0 오류 / 0 skip | validation-python-library-final.log |
| 전체 ESLint | exit 0 | validation-lint-final.log |
| 아키텍처 | 302 모듈 순환 없음, 관련 unit 181 통과 / 0 실패 / 0 skip | validation-architecture-final.log |
| 마지막 신규 CI 회귀 포함 JavaScript 구문 | 728 파일 통과, exit 0 | validation-syntax-final-integrated.log |
| UI audit / unit | 6 audit 통과, 18 unit 통과 / 0 실패 / 0 skip | validation-ui-audit-final.log |
| 생성 preview strict 검사 | 258 canonical / 258 preview 형상 유효, 생성 자산 동일 | validation-preview-final.log |
| WebGL 직접 편집선 영향 경로 | 2 통과 / 0 실패 / 0 skip | validation-webgl-handoff.log |
| 수계 색상·Undo 실제 GPU paint | 1 통과 / 0 실패 / 0 skip (동일 batch의 자르기·저장 준비 실패와 구분) | validation-browser-audit-green6.log |
| 공통 객체 편집·Undo·자동저장·재시작 복원 | 1 통과 / 0 실패 / 0 skip (동일 batch의 자르기 실패와 구분) | validation-browser-audit-green7.log |
| 현재 CI 선택기 지속 회귀 | 10 통과 / 0 실패 / 0 skip, YAML 4개 구문·matrix 검증 통과 | current-browser-contracts.test.mjs |
| 국기 focus/wheel/제거 실제 frame 및 metadata | 1 통과 / 0 실패 / 0 skip, trace 없는 동일 assertion 실행 | validation-ui-flag-static-current.log 및 해당 proof JSON |
| GIS 게시 전 거부/외부 mutation/게시 후 복원 관련 unit | RED 5 통과 / 1 실패 → GREEN 6 통과 / 0 실패 / 0 skip; 실제 7개 소비자 파일 45 통과 / 0 실패 / 0 skip | validation-gis-unpublished-restore-red.log, validation-gis-unpublished-restore-green.log, validation-gis-restore-consumers.log |
| GIS 정본 상태 접근 audit | 58 분류 접근, 금지 위반 없음, exit 0 | validation-gis-storage-audit.log |
| 두 국가 분포 단일/겹침/경계 토글 실제 UI 및 모델 | 1 통과 / 0 실패 / 0 skip, 8.9초 | validation-distribution-two-country.log |
| native select 갱신 8 spec | ESLint/diffcheck exit 0, list 21 case; list는 실제 실행 통과가 아님 | validation-current-select-contract-eslint.log, validation-current-select-contract-inventory.log |
| 정보 v9 파일 복원/metadata/유한 기간 거부/부모 UI, 부모 변경 ID/형상/Undo | 2 통과 / 0 실패 / 0 skip, 23.9초 / 36.2초 | validation-current-select-browser.log |
| 동독 유한 기간 실제 UI 거부 전체 session 원자성/Undo/Redo | 1 통과 / 0 실패 / 0 skip, 1.1분 | validation-browser-audit-history-green12.log 및 finite-activation-atomicity.json |
| 북슐레스비히 유한 기간 실제 UI 거부 전체 session 원자성/Undo/Redo | 1 통과 / 0 실패 / 0 skip; 같은 batch의 소련은 원자성 통과 뒤 redo action 대기 timeout으로 실패 | validation-browser-audit-history-green13.log 및 proof JSON |
| 소련 유한 기간 실제 UI 거부 전체 session 원자성/Undo/Redo 최종 | 1 통과 / 0 실패 / 0 skip, 1.8분; 큰 archive의 native 복원 command만 아래 조건으로 재검증 | validation-browser-audit-history-green15.log 및 proof JSON |
| 국가 mesh 품질 전환 첫 프레임/정확한 편집·Undo·delta 자동저장·재시작 | 2 통과 / 0 skip; 같은 수정 전 batch 전체 결과는 2 통과 / 10 실패 / 0 skip | validation-browser-audit-green11.log |
| 최종 전체 ESLint / JavaScript 구문 | exit 0 / 728 파일 통과; 이후 바뀐 browser spec은 별도 focused lint를 적용 | validation-lint-final-candidate.log, validation-syntax-final-candidate.log |
| 현재 desktop/compact/mobile 편집·국기·검색·표시 UI | 3 통과 / 0 실패 / 0 skip, 36.0 / 39.6 / 39.6초 | validation-boundary-responsive-current.log의 wide, validation-responsive-current-small.log의 2 case |
| 실제 GeoPackage SQL 및 프로젝트 불러오기 roundtrip | 1 통과 / 0 실패 / 0 skip, 3.4분, 약 23MB 파일 | validation-browser-audit-gpkg-green18.log |
| draft 삽입 hover의 실제 renderer/domain 통합 | RED 1 통과 / 2 실패 → 관련 2 suite GREEN 23 통과 / 0 실패 / 0 skip; 제품/회귀 ESLint exit 0 | validation-draft-insertion-red.log, validation-draft-insertion-focused-final.log, validation-draft-insertion-final-eslint.log |
| mobile native focus/표시 bounds/카메라 보존/전체지도 reset | 1 통과 / 0 실패 / 0 skip, 34.4초 | validation-mobile-focus-native-current.log |
| 실제 mobile touch/겹침 chooser/작은 자식 객체 정체성·편집창 | 1 통과 / 0 실패 / 0 skip, 46.9초 | validation-browser-audit-touch-green22.log 및 입력/선택 proof JSON |
| desktop 실제 child 선택/겹침 chooser/지도 pan/편집창 모델 | 1 통과 / 0 실패 / 0 skip, 1.0분 | validation-browser-audit-territorial-desktop-green25.log |
| 꼭짓점 입력 순서 보정 후 기존 packet/domain 회귀 | 23 통과 / 0 실패 / 0 skip, 제품·회귀 ESLint exit 0 | validation-draft-hit-priority-focused-final.log, validation-draft-hit-priority-final-eslint.log |
| 꼭짓점 입력 순서 보정 포함 전체 Node unit, 마지막 수계 review 보정 전 | 1687 통과 / 0 실패 / 0 skip, 동일 명령, exit 0, 65.8초 | validation-unit-final-hit-priority.log |
| 최종 전체 ESLint | exit 0 | validation-eslint-final-hit-priority.log |
| 최종 JavaScript 구문 | 728 파일 통과, exit 0 | validation-syntax-final-hit-priority.log |
| 경계 편집과 후속 모바일 입력을 합친 중간 실행 | 0 통과 / 1 실패 / 0 skip, exit 1, 1.1분; 경계/저장/archive Undo·Redo 통과 뒤 모바일 버튼 action 10초 timeout, CDP 터치는 미실행 | validation-browser-audit-cut-green32.log, cut-geometry-history.json |
| 분리한 실제 경계 편집·저장·archive 회귀 | 1 통과 / 0 실패 / 0 skip, 24.9초; 같은 batch의 mobile은 숨긴 primary 버튼 폭을 비교하는 낡은 UI 기대값으로 실패 | validation-browser-audit-cut-final-split.log |
| 마지막 수계 review 회귀 및 기존 소비자 unit | 17 통과 / 0 실패 / 0 skip, exit 0; `node --test tests/unit/annex-drawn-selection.test.mjs tests/unit/tool-controller.test.mjs`; source/test ESLint exit 0 | validation-hydro-review-focused-green.log, validation-hydro-review-focused-eslint.log |
| 최종 모바일 native CDP/취소/검토 표시/저장 불변 | 1 통과 / 0 실패 / 0 skip, exit 0, 9.3초; 위 desktop 통과와 별도 실행 | validation-browser-audit-cut-mobile-a8-final.log |
| 최종 분리 spec ESLint / Node 구문 | 각각 exit 0 | validation-browser-audit-cut-final-split-eslint.log, validation-browser-audit-cut-final-split-node-check.log |

소련 검사의 원자성 proof는 처음에도 통과했지만, 실제 Redo의 동기 archive 복원
중 기본 10초 action 제한을 두 번 초과했다. Worker p95 약 28.5초를 기록한
큰 프로젝트 실행 비용이며, 실패를 통과로 바꾸어 기록하지 않는다. 전체 240초
제한과 모든 exact 모델/Undo/Redo assertions를 유지한 채 해당 native 복원
command만 30초로 제한하고 페이지 이동 없는 버튼의 navigation 대기를 제거한
최종 실행을 별도로 기록한다. 제품의 복원 성능을 개선했다는 증거는 아니다.

반응형 편집 행은 정적 HTML만 읽지 않고 `app-editor-bindings.js`의
`syncEditorCommandRows()`가 실제로 붙이는 아이콘을 검사한다. 현재 8개 명령
ID, 각 행의 아이콘 하나·설명 텍스트·화살표 없음과 별도 삭제 행을 검증했다.
GeoPackage 재열기는 `gis-io.js`가 full-project를 벡터 GIS 입력에서 거부하는
현재 계약에 따라 실제 파일 메뉴의 프로젝트 불러오기를 사용한다. 실제
4326 공간 테이블/국기 blob/분포 73/독립 권역 coverage와 저장 후 정본 객체의
정확한 복원을 검증한다. MultiPolygon→Polygon 및 ring 시작점 정규화는
입력 bytes와의 equality 대신 독립 XOR/네 꼭짓점/면적 1로 검증하며,
저장 후 roundtrip의 정확한 정본 equality는 유지한다.

경계 편집의 잘못된 입력은 실제 마우스로 내부 두 점을 이동하여 명백한
자기 교차를 만든다. 입력 좌표의 두 선분 방향 곱이 각각 음수임을 독립적으로
검증한 뒤 `self-intersection` 거부·완료 비활성화·Undo의 정확한 좌표 복원을
확인한다. 화면 픽셀 반올림으로 정확한 경계 중첩을 만들지 못한 실행은
별도 실패로 남긴다. 키 이동의 SVG transform은 키 이벤트 완료가 아니라
실제 다음 표시 프레임의 동일한 transform 변경을 기다린다.
경계 편집·저장·archive 회귀와 모바일 draft 입력은 같은 production fixture를
사용하는 독립 케이스로 구분한다. 긴 archive 복원 직후 발생한 native action
timeout은 미확정 실행 부하 문제로 남기고 성능을 해결했다고 보고하지 않는다.
모바일은 합성 DOM PointerEvent 대신 기존 Chromium CDP 터치 입력을 사용하며,
실제 draft 좌표·stroke 종료·hit 영역·레이아웃·취소 확인을 검증한다.
두 버튼의 동일 폭은 둘 다 표시되는 검토 단계에서 비교한다. 그리기 중에는
현재 계약대로 primary가 숨겨진 상태임을 먼저 확인한다. 실제 3점 입력의
확인 취소, 재진입 후 review 취소와 전체 저장 payload의 정확한 불변을 검증했다.
검토 단계의 실패를 올바른 동작으로 채택하지 않고 위 수계 제품 결함을 보정했다.

전체 Node 1,687개와 Python root/DEM 261개, ESLint와 JavaScript 구문 검사를
실행했다. 마지막 수계 review 보정은 관련 회귀만 실행하고 전체 suite는 다시
실행하지 않는다. 브라우저는 수정에 영향을 받는 경로만 실행했으며 위 표의 범위를
넘어 성공했다고 판정하지 않는다. 중간 실패 실행도 삭제하지 않았다.
검수 시작 시 전체 목록은 97파일의 302 browser case였다. 이 전체 목록과
앱 교차검증은 미실행이다. Linux 원격 CI는 위 로컬 검수 단계에서 실행하지 않았다.
전체 목록의 성공 또는 웹·앱 동등성을 보고하지 않는다.

검수 완료 당시 원격 main은 기준 SHA와 동일하고 기존 checkout은 깨끗했다.
수정은 격리된 `codex/validation-current-contracts` 브랜치에서 검수했다.
2026-10-06 후속 사용자 요청에 따라 해당 변경을 커밋·푸시하고 main 반영 및
GitHub Pages 배포를 진행한다. 검사 결과와 원격 배포·실제 사이트 확인은 구분한다.
