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
