# 웹 T2-2 프로젝트 영속성

## 계약과 소유권

프로젝트 형식은 schemaVersion 9, timelineRecords는 schemaVersion 1이다.
현재 형식만 읽으며 구형 개발 저장본의 reader·migration·별칭은 없다.

`territorial-entity-store`가 ID, general/regional 종류와 메타데이터를 소유한다.
저장되는 territorialEntities는 geometry:null인 정체성 Feature다. lifetimes,
geometryBindings, parentRelations가 각각 존속기간, 형상 선택, 부모/coverageMode를
소유한다. 부모나 root로 sovereignty를 추론하지 않는다. 대체된 단일 기간/관계
필드와 지원하지 않는 정치 관계를 받으면 저장/게시 전에 오류를 반환한다.

T2-2a `snapshotTimelineStorage`/`restoreTimelineStorage`를 사용한다. geometries는
{id,version,geojson} 전체 archive다. 공유 형상과 미참조 과거 버전도 보존한다.
이미 검증된 불변 형상은 분리된 registry 사이에서 안전하게 공유하며, 임의의
외부 객체는 검증·복사·동결한다. 정적 편집은 기록을 갱신하고 새 형상 버전을
추가한다. 기존 archive 항목은 변경하지 않는다.

## 실제 연결 경로

| 경로 | 구현과 경계 |
| --- | --- |
| 파일 저장 | 기존 파일 controller → projectDomain.save → project-serializer.buildProject → app-domain-assembly.createProjectFile → PandoLabGIS.exportGeoPackage → gis-gpkg-worker |
| 파일 읽기 | gis-gpkg-worker → GIS 파일 검사/가져오기 wizard → import-service/계획 → gis-import-transaction → projectDomain.load → prepareProjectForActivation → 기존 복원/객체 저장소 |
| 자동저장 | 기존 history/application command → persistence-service → project-serializer.buildAutosave → IndexedDB 및 기존 fallback |
| 자동복구 | persistence-service의 비동기 후보 검증 → 정본 baseline 준비 → storage/activation 검사 → 기존 startup/session 복원 |
| Undo/Redo | 기존 history-service/command/transaction → app-project-snapshots → entityStore.restoreProject + 기록/전체 archive 복원 |
| GIS 내보내기 | 기록/형상 저장소에서 파생한 정적 Feature를 기존 GIS exporter에 전달 |

GeoPackage 내부 프로젝트 JSON이 정본이다. 공간 레이어를 읽어 JSON 형상을 덮어쓰지
않는다. 정적 프로젝트에는 파생 공간 레이어를 쓰고, 빈 프로젝트나 복잡한 시간
프로젝트에는 날짜를 임의 선택하지 않고 공간 레이어 없이 프로젝트 JSON을 쓴다.

`prepareProjectForStorage`는 복잡한 시간 프로젝트 전체의 스키마·기간·참조·객체
불변조건을 검사한다. `prepareProjectForActivation`은 그 뒤 정적 활성화 조건을
검사한다. 분리된 후보 객체/형상 저장소를 검증하고 성공한 뒤 게시한다. 스키마,
중복, 누락 참조, 기간 중첩/공백, 다른 객체 형상 오류 및 활성화 거부는 현재 프로젝트,
선택, history/future, dirty, 저장 대상과 렌더링/세션 초기화보다 먼저 발생한다.

full/delta 자동저장은 모두 완전한 기록과 archive를 포함한다. delta에서 생략한
정체성은 기준 데이터셋 이름과 `baseDatasetFingerprint`가 모두 일치할 때 복원한다.
fingerprint는 정규화된 기준 객체·메타데이터·정확한 형상 내용에 대한 SHA-256이며,
단순 데이터셋 이름/자산 버전으로 대체하지 않는다. 시작 시 delta 검증에 필요한
정본 로딩은 기존 loader/gate에서 먼저 수행한다. 로딩 실패는 후속 후보 검사에도
PL-SCHEMA-BASE로 반환하며 대기 상태로 남지 않는다.

기존 편집기는 읽기 전용 정적 Feature를 사용한다. 콘텐츠 snapshot은 정체성,
기록, 불변 archive를 함께 담고 Worker 요청은 분리된 snapshot을 전달한다.
세션 커서 값은 콘텐츠 snapshot, dirty, Undo/Redo에 포함하지 않는다. 새 커서 UI는 없다.

## 활성화 제한

T3/T4 전에는 각 객체에 무기한 lifetime, geometryBinding, parentRelation이 각각
하나인 정적 프로젝트만 기존 UI를 활성화한다. 복잡한 시간 프로젝트의 저장과
교환은 지원하지만 UI 열기·렌더링·기존 편집은 게시 전에 `TIMELINE_ACTIVATION`으로
거부한다. 날짜 resolver/날짜별 편집으로 특정 시점을 선택하지 않는다.

## 교환 파일

`tests/fixtures/timeline-exchange`에 정적/복잡 시간 `.json`, 실제 production Worker가
작성한 `.gpkg`, `.expected.json`을 제공한다. 상세 의미와 재생성 명령은 그 디렉터리의
README에 있다. 1914-06/v1 → 1914-07/v2, 날짜별 부모/coverage 변화, 불연속 lifetime,
연·월·일 정밀도, BCE/CE, 구멍·섬·날짜변경선, 공유/미참조 형상과 이름·수도·출처를
포함한다. 별도 앱 작업은 expected 문서와 의미를 비교해야 한다.

## 검증 기록 (Windows, 2026-10-04)

실행 시작의 feat/timeline-web 원격/커밋 기준은
`cfeaab285f623129384c039662d69fa76df90eb7`이었다. 기존 추적 checkout의 작업 변경과
ignored 산출물, 원래 사용자 checkout을 보존했다. 커밋 기준은 분리된 archive에서
검사했다.

- 커밋 기준 T1/T2-1/T2-2a + 기존 저장/history 집중 검사: 150 통과, 실패 0, skip 0.
- 추가 관련 경계의 커밋 기준: 20개 중 15 통과, 기존 실패 5. 상위 객체 오류 문구와
  서비스 호출 방식의 낡은 기대값, 취소 toolbar의 필수 의존성 누락이었다.
- Python 현재 스키마 검사의 커밋 기준: 3개 중 1 통과, 기존 실패 2. 퇴역 스키마/필드
  기대값이었다. 현재 계약으로 갱신한 뒤 3 통과, 실패 0, skip 0.
- 기존 작업 변경의 초기 집중 검사: 40개 중 38 통과, 실패 2. 함수가 들어 있는 state를
  structuredClone하던 fixture를 실제 snapshot 계약으로 바꾸고 삭제/실패 원자성 검사를 유지했다.
- 새 통합 회귀 실패를 먼저 확인한 뒤 구현했다. 중복/누락/시간 중첩/하루 공백/잘못된
  필드, 실제 프로젝트 소유자의 실패 원자성, baseline 불일치, 비동기 복구 실패,
  정적 편집과 archive 보존, 실제 파일 Worker를 검사한다.
- 관련 unit/Worker/직접·간접 소비자 회귀 최종 검사: 666 통과, 실패 0, skip 0.
  마지막 baseline 로딩 실패의 재시도 회귀는 이후 다시 1/1 통과했다.
- 변경 JS/MJS lint: 오류 0. JS 구문 및 territorial storage/command/Worker/version
  계약 검사도 통과했다.
- 실제 headless Chromium 브라우저 최종 묶음: 6 통과, 실패 0, skip 0 (5.0분).
  메타데이터/삭제, 실제 Worker 병합/형상 Undo·Redo, 부모 변경/Undo, 정적 파일
  저장·열기/full 복구, 복잡 시간 파일 왕복/활성화 실패 원자성, builtin delta 복구를 검사했다.
- 최종 읽기 전용 코드 검토에서 baseline 오류의 후속 호출 대기를 수정했고,
  같은 loader Promise의 두 요청 모두 실패를 반환하는 회귀를 재검증했다. 잔여 중요 지적은 없었다.

production 파일 검사는 테스트 전용 serializer로 대체하지 않고 실제
`project-serializer`, 프로젝트 소유자, GIS Worker와 실제 sql.js WASM을 사용한다.
브라우저에서는 실제 파일 chooser/download, GIS importer, 편집 명령, Worker,
IndexedDB와 reload 경로를 실행한다. 전체 세계 snapshot을 검증하는 병합 미리보기는
처리 중임을 trace로 확인한 후 작업 대기 한도를 8초에서 30초로 바꿨으며 결과 형상,
Undo/Redo, 자동저장/재열기 검사를 유지했다.

집중 codec 회귀 재실행 예:

```powershell
$env:NODE_OPTIONS='--experimental-vm-modules'
node --test "tests/unit/timeline-*.test.mjs" tests/unit/temporal.test.mjs tests/unit/project-serializer.test.mjs tests/unit/project-state.test.mjs tests/unit/place-label-workflow.test.mjs tests/unit/app-builtin-session.test.mjs
$env:PANDOLAB_TEST_PORT='4206'
node node_modules/@playwright/test/cli.js test tests/browser/timeline-persistence.spec.mjs tests/browser/territorial-common-commands.spec.mjs tests/browser/territorial-parent-edit.spec.mjs
```

Windows headless Chromium과 실제 파일 codec을 검증했다. Linux 실행, 앱 왕복,
Qt configure/build/CTest는 이번 웹 작업에서 실행하지 않았으며 통과로 표시하지 않는다.
main/통합 브랜치 병합이나 배포는 수행하지 않는다.


## main 통합 (2026-10-04 후속 요청)

사용자의 후속 main 병합 요청에 따라 원래 feature 작업의 병합 제외 경계를 변경했다.
통합 기준 main은 e2911cd8eb2cf15c065d7afefbf8bdfdb2c6567e,
feature는 788f43fd27062851bdadf7fa6964819d43534685다. 원래 checkout의
미커밋/ignored 내용과 별도 feature 브랜치는 보존하고 격리 checkout에서 통합한다.

충돌한 세 모듈은 main의 경계 표현·국가 기본색과 v9 baseline/후보 검증을 함께
유지하도록 결합했다. builtinCountries의 renderCountryBoundaryStyle을 유지하고
builtinBaseline 포트를 별도로 연결했다. 렌더러·메뉴와 지명 검토 파일은 main의
후속 변경을 유지한다. main에 이후 추가된 색상 회귀 두 개는 기록/archive를
초기화하는 실제 현재 fixture 계약으로 바꿨다.

- 최신 main 집중 기준 검사: 44 통과, 실패 0, skip 0.
- 관련 통합 unit/Worker 회귀: 757 통과, 실패 0, skip 0.
- 현재 스키마 Python 검사: 3 통과, 실패 0, skip 0.
- 변경 파일 lint와 저장소/명령/Worker/버전 계약 검사 통과.
- Windows headless Chromium 브라우저 회귀 8개 모두 통과, 실패 0, skip 0.
  최초 6개 통과 후 아래 두 테스트의 fixture를 수정하고 해당 2개 재실행 통과.
- JavaScript 구문 검사 687개 통과.
- 읽기 전용 최종 검토에서 중요 지적 없음. main의 경계·기본색, startup,
  동결된 정적 view, history, full/delta 및 GeoPackage 경계를 재검토했다.

첫 통합 실행의 missing ESLint는 공유 의존성 경로의 환경 문제였으며, 유효한
기존 의존성에 연결한 뒤 검사를 다시 실행했다. 색상 fixture 두 개의 실패는
이전 state 계약이 원인이었으며 현재 정본 초기화 후 기존 모든 색상 기대값을
유지해 통과했다. 메뉴 자동저장 검사는 새 전체 archive를 불필요하게 브라우저
프로세스로 복사하지 않고 IndexedDB에서 필요한 layerVisibility만 읽도록 수정했다.
복잡 시간 파일 검사는 import 모달이 닫힌 시점과 실제 프로젝트 게시 시점을
혼동했던 초기 준비 단계를 수정했다. 실제 객체 소유자의 A 이름을 기다리고
메타데이터 명령의 changed 결과를 확인한 뒤 기존 전체 실패 원자성·Undo 검사를
실행한다. 제품 경로와 기존 기대값은 변경하지 않았다.

병합 커밋 뒤 기존 build metadata 생성기를 실행해 JS 자산 캐시 revision을 갱신한다.
앱 버전은 main의 0.34.0을 유지한다. 수동 배포나 공개 사이트 검증은 수행하지 않는다.

기록 정본/불변 archive 및 TIMELINE_ACTIVATION 경계는 feature와 같다.
T3/T4와 새 타임라인 UI, 앱/Qt 구현·검증 및 별도 수동 배포는 추가하지 않는다.

## T2-2 통합 후속 검증 (2026-10-05, 전용 수정 브랜치)

이번 절은 위 feature/main 통합 기록과 별개의 실행이다. 기준은 원격 main
`30b8cf402b4c0fb760c0200a459e5f88e9f5f028`이며,
읽기 전용 앱 참조는 `54aa51d11e38bf17b89f83919bf8443aba32f783`다.
웹 `codex/timeline-t22-followup` 격리 worktree에서만 변경한다. 기존 웹/app
checkout, 다른 worktree, ignored 파일과 기존 빌드 폴더는 보존한다.
main 병합·배포·앱 패키징은 이번 작업에 포함하지 않는다.

### 계약 대조와 이미 해결된 문제

두 저장소의 Git blob 원문 SHA-256은 다음과 같이 일치한다.

| 공통 문서 | 양쪽 Git blob SHA-256 |
| --- | --- |
| `docs/timeline-contract.md` | `6faaa45917b6322d6cbb94bfa85c6eb10518a17e2400b62adea42b49f91e66cc` |
| `docs/timeline-records.md` | `434266403c5ce2bae66979a8d1b404d78e49af49f36f74982547088465e20725` |

`docs/timeline-storage.md`는 구현 checkpoint의 플랫폼 범위 설명이 다르지만,
같은 record/전체 archive 보존을 요구한다. 웹은 `version-contract.js`의
프로젝트 9, `timeline-records.js`의 기록 1을 사용한다. 앱은
`app/projectcodec.cpp`의 native version 9 / web schemaVersion 9와
`core/include/pandoeditor/timeline-records.h`의 기록 1을 사용한다.
문서·버전 선언·기존 static/complex 기대값 사이의 의미 모순은 발견하지 않았다.
공통 계약·스키마·날짜 의미·활성화 정책·제품 runtime 코드는 수정하지 않았다.

발견 기준 웹 `783abdfd2d1f1f5331d37ae19acd4dcd8ddd7ac8` 이후
`c7b4effb3b0d05a3d12a43853d7f1cf8b824979c`에서 순환 의존성과 CI 보정이
이미 이루어졌다. 현재 `project-state.js`가 delta 복원을 소유하고 serializer를
참조하지 않는다. 실제 구조 검사에서 302 모듈의 순환이 없으므로 추가 모듈 분리나
옛 export 복원은 하지 않았다. 검사 규칙도 변경하지 않았다.

### 이전 CI 실패의 분류

Application Architecture 실행 `37214356536`의 원본 로그를 다시 추출했다.
command-contract는 A 한 건(실제 serializer/state 순환), Full unit suite는
1491 통과 / 33 실패 / 0 skip이었다. 실패 테스트 이름·위치·기대값·실제 오류의
전체 diagnostic과 당시 입력을 만드는 테스트 원문은 검증 산출물의
`ci-failures.json`, `ci-37214356536.log`, `old-ci-inputs/tests/unit/`에 보존한다.

| 분류 | 당시 실패 파일/입력 | 수 | 원인과 현재 확인 |
| --- | --- | ---: | --- |
| A | runtime import graph | 1 | serializer → state → serializer. 현재 acyclic 검사 통과 |
| B | app-ui-boundaries / distribution-selection | 3 | 현재 identity.properties와 displayEntities 포트를 제공하지 않는 fixture |
| B | gis-adapters / gis-geometry-worker | 2 | entity schema 4 기대값(현재 5), 이전 Worker 소스 텍스트 호출 검증 |
| B | historical-library-controller / historical-library-service | 5 | retired country 표현·라이브러리 schema 대신 현재 general/root·정규화 fixture 필요 |
| B | layer-list-model / layer-tree-controller | 3 | 현재 territorial/entity object reference·정렬 범위를 제공하지 않는 fixture |
| B | selection-ui-reset-regression / view-focus-contract | 4 | 현재 명령 조회·selection/reference 포트 대신 이전 country 입력 |
| C | territorial-gis-export / timeline-geopackage | 16 | Node 22 VM dynamic import 플래그 오류; 기대된 제품 오류까지 도달하지 못함 |

B 17건과 C 16건의 보정은 이미 c7b4eff에 있다. 현재 canonical factory/실제
서비스와 VM main-context loader를 사용하는 변경임을 확인했으며, 이번 브랜치에서
테스트 삭제·skip·assertion 약화나 무관한 재보정을 하지 않았다.
후속 원격 실행 `37238269406`은 정확한 WEB_BASE_SHA에서 architecture와
전체 unit 1526 통과 / 0 실패 / 0 skip이었다. 이는 **기준 main의 과거 결과**이며
이번 후보 SHA의 결과로 재사용하지 않는다. 후보의 새 원격 실행은 별도로 기록한다.

### 이번에 보강한 실제 경로

- 기존 `static/complex.json`, `.gpkg`, `.expected.json`은 바꾸지 않았다.
  production JSON reader와 실제 GeoPackage Worker의 고정 binary 읽기 및 재저장을
  독립 `expected` 파일의 정체성·기록·전체 archive와 비교한다.
- `calendar-boundaries` 한 사례를 추가했다. +12000/-0400/2000의 윤일,
  1900의 평년, 2월 말 → 3월의 binding 전환과 원래 월/일 정밀도를 검증한다.
  기대 기록은 공통 계약에서 직접 도출한 literal이며, 정체성/archive만 기존
  static oracle을 재사용했다. generator는 지정 사례만 생성하고 expected는 쓰지 않는다.
- 연도 0, 1900-02-29, 양끝 포함 경계 중복, 윤일 하루 공백의 최소 입력을
  production 저장 경로에 넣어 거부 코드와 입력 불변성을 검사한다.
- 실제 entity owner + history service + application snapshot 복원으로 형상 편집,
  공유 형상/미참조 Point·Line/과거 version 보존 및 Undo/Redo 전체 복원을 검사한다.
- 실제 project domain·저장 상태 controller에서 잘못된 참조/중복/날짜/복잡 시간
  후보 거부 시 콘텐츠·선택·history/future·dirty·저장 대상·저장 token·세션 게시·렌더
  게시·generation의 불변성을 검사한다.
- 브라우저에서는 파일 선택·다운로드·Worker·IndexedDB full/delta 복원, Undo/Redo,
  complex UI 거부 후 기존 Undo와 **기존 future의 Redo** 사용, 실제 GPU project
  generation과 저장 상태 보존, 실제 baseline fingerprint 불일치의 시작 복원 거부를 확인한다.

기존 exchange 범위에 정적/복잡 시간, 불연속 lifetime, year/month/date, BCE/CE,
공유/미참조/과거 형상, 날짜별 부모와 coverage, 구멍·섬·날짜변경선이 포함된다.
부족했던 확장 연도·윤년의 **실제 파일** 교환 경계를 calendar 사례가 보강한다.
새 resolver/UI/날짜별 편집이나 월별 GeoJSON 복제는 추가하지 않았다.

### 동결 전 실제 실행 결과

| 명령 | 통과 / 실패 / skip | 실행 범위 |
| --- | --- | --- |
| `node scripts/check-runtime-boundaries.mjs` | 구조 검사 통과 | 302 모듈, 순환 0 |
| `pnpm check:architecture` | JS 179 / 0 / 0; Python 3 / 0 / 0 | 기존 검사 규칙 그대로 |
| `node --test` timeline unit 7개 + place-label-workflow | 188 / 0 / 0 | records/storage/project/entity/Worker/activation/persistence/history |
| 변경 파일 `pnpm exec eslint` | 오류 0 | test/generator/교환 CLI |
| `playwright test tests/browser/timeline-persistence.spec.mjs` 및 집중 재실행 | 각 최종 경로 3 / 0 / 0 | 최초 2 통과/1 실패 후 complex 대기 보정; delta 추가 경계는 1 실패 후 재실행 통과 |
| `ctest -R '^(temporal_tests\|timeline_records_tests\|timeline_storage_tests\|timeline_project_tests\|timeline_editor_persistence_tests)$'` | 5 / 0 / 0 | 별도 Qt/MinGW 빌드에서 실제 앱 코덱·편집기 소유자 테스트 |
| 앱 `timeline-records-parity.mjs` | 60 / 0 / 0 | 공통 기대값·web/native 판정 일치 |
| 앱 `timeline-storage-parity.mjs` | 25 / 0 / 0 | 판정 25건·전체 snapshot 11건 일치 |
| 앱 `timeline-exchange-oracle.mjs` | 16 / 0 / 0 | 실제 QFile/native v9/web 교환·full/복원 delta·숫자 보존 거부 |
| 웹 `tools/check-timeline-exchange.mjs` | **8 / 2 / 0** | 고정 JSON/GPKG → 실제 앱 → web Worker; 날짜 오류 코드 두 건 불일치 |

범위를 제한한 기존 parity 도구는 record의 JS wire-type 사례 8개, storage 6개를
native 값 타입 비교에서 제외한다. 이들은 skip된 성공 테스트로 세지 않으며 웹
fixture 검사에 포함된다. 앱 파일 경계의 모든 잘못된 JSON 타입을 검증한 것으로
보고하지 않는다. full 앱 suite와 수동 앱 화면/패키징은 미실행이다.

환경/테스트 설정의 실패도 보존한다. 첫 CMake 구성은 ZLIB 경로 누락으로 실패했고
기존 MinGW ZLIB를 지정해 통과했다. 링크 중 실행한 첫 CTest는 편집기 binary가
잠겨 4 통과/1 미실행이었다; 빌드 종료 후 위 5개를 재실행했다. complex 브라우저
검사의 transient “저장 중” 기대는 실제 자동저장 완료 조건을 기다리도록 보정했다.
delta baseline 입력은 편집기를 떠나기 전에 심어 beforeunload 정상 저장에 덮였으므로,
편집기를 종료한 동일 origin의 정적 페이지에서 심고 production 시작 경로로 재검사했다.
제품 코드나 기대되는 실패 보장을 바꿔 통과시키지 않았다.

### 남은 앱 파일 경계 차이 — 웹/앱 동등성 확정 아님

정상 고정 파일 교환 6건은 동일한 expected 값과 일치한다. 다음 입력은 양쪽 모두
거부하고 앱 출력 파일도 게시하지 않지만, 실제 파일 decode의 오류 범주가 다르다.
`app/projectcodec.cpp`의 timeline endpoint parser가 record normalizer 전에
`parseTemporal` 오류를 내보낸다. 공통 문서나 fixture 기대값을 수정하지 않았다.

| calendar 입력 변경 | 웹 record/storage 기대·실제 | 앱 파일 코덱 실제 |
| --- | --- | --- |
| life:A.validFrom = `0000-02` | `TIMELINE_INTERVAL` | `INVALID_DATE: year zero` |
| B:new.validFrom = `1900-02-29` | `TIMELINE_INTERVAL` | `INVALID_DATE: day` |

새 CLI는 이 차이를 숨기지 않고 두 건을 실패로 기록하고 exit 1을 반환한다.
양끝 중복은 `TIMELINE_OVERLAP`, 윤일 누락은 `TIMELINE_GAP`으로 양쪽이 일치한다.
현재 웹 성공과 native normalizer parity만으로 파일 경계의 범주까지 같다고 보고하지
않는다. **웹 검증 보강 완료, 앱 날짜 오류 코드 교차검증 두 건 실패,
최종 독립 앱 작업자 교차검증 미실행**으로 구분한다. 앱 수정은 앱 작업자가 담당한다.

### 후보 고정과 인계

문서 자체의 commit SHA를 문서에 넣는 자기참조를 피하기 위해, 문서/코드/fixture를
커밋한 뒤 정확한 후보를 `test-results/timeline-t22-followup/manifest-<WEB_CANDIDATE_SHA>.json`
에 기록한다. 산출물에는 WEB_BASE_SHA, WEB_CANDIDATE_SHA, APP_REFERENCE_SHA,
두 저장소의 계약/스키마/사용 fixture/expected 파일 경로와 SHA-256, 명령별 실제
결과와 로그 해시를 포함한다. Git blob hash와 실제 읽은 Windows checkout byte hash
(CRLF 가능)를 구분한다. 기존 앱 provenance.json도 이전 기준의 증거로만 해시한다.
후보 동결 뒤 관련 코드/fixture는 바꾸지 않으며, 후속 변경에는 새 SHA·결과가 필요하다.
동결 후 집중 검사와 branch의 Application Architecture 실행은 이 산출물에 추가한다.

앱 작업자는 WEB_CANDIDATE_SHA를 checkout한 뒤 아래 명령을 그대로 실행한다.
Qt/MinGW runtime PATH와 해당 APP_REFERENCE_SHA에서 빌드한 binary를 사용한다.
아래 예의 `$webRoot`는 고정 후보 checkout을 가리켜야 한다.

```powershell
$webRoot = 'C:/Users/taeeu/.codex/worktrees/timeline-t22-followup/Pandoeditor(Web)'
$appRoot = 'D:/dev/Pandoeditor(App)'
$appBuild = 'D:/build/Pandoeditor-t22-54aa51d'
$env:PATH = 'C:/Users/taeeu/Qt/6.8.3/mingw_64/bin;C:/Users/taeeu/Qt/Tools/mingw1310_64/bin;' + $env:PATH
node "$appRoot/tools/timeline-records-parity.mjs" "$appBuild/core/timeline_records_tests.exe" "$webRoot/assets/js/modules/timeline-records.js"
node "$appRoot/tools/timeline-storage-parity.mjs" "$appBuild/core/timeline_storage_tests.exe" "$webRoot/assets/js/modules/timeline-storage.js"
node "$appRoot/tools/timeline-exchange-oracle.mjs" "$appBuild/timeline_project_tests.exe" $webRoot "$webRoot/test-results/timeline-final-app/existing"
Set-Location -LiteralPath $webRoot
node tools/check-timeline-exchange.mjs "$appBuild/timeline_project_tests.exe" test-results/timeline-final-app/fixed
```

마지막 명령의 오류 코드 두 건을 성공으로 처리하거나 현재 앱 값에 기대값을 맞추지
않는다. 앱을 보정한 뒤에는 APP_REFERENCE_SHA도 새로 고정해 새 검증 쌍을 남겨야 한다.
