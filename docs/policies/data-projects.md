# 프로젝트·자료 정책

## 프로젝트와 외부 자료

- Pando는 Viewer·공통 제품 계산·런타임 빌드/저장 지원·계약·fixture·앱 검사를 소유한다. 외부 `kimjeon-il/PandoLab-library`는 라이브러리 객체·원본 GIS·런타임 지도·보고서와 비Viewer 작성/관리 도구 및 해당 집중 검사를 소유한다. 자료 전용 worktree는 storage-only다.
- 프로젝트는 역사 객체·작성 지명·작성 수계·타임라인·작성 표현의 소유 경계다. 불변 원자료 바이트·검증된 형상은 재사용할 수 있으나 프로젝트 간 객체·선택·편집·이력·세대 등 가변 상태는 공유하지 않는다. 외부 자료는 명시적인 ID·리비전·해시 참조 또는 검증된 스냅샷으로 수용한다.
- `config/library-data.json`은 브랜치별 자료 커밋을 고정한다. `node tools/data/library-data.mjs`는 고정 캐시·마운트를 준비하며 마운트 자료를 앱 Git에 넣지 않는다. 도구 코드 핀과 자료 핀, 보고서 revision은 독립적이다. 브랜치의 자료/WASM 짝을 검토 없이 다른 브랜치 핀으로 바꾸지 않는다. 보고서 원본·판본·발행과 공개 배포는 AGENTS.md의 별도 소유권·완료 규칙을 따른다.

## 문서·세션·원본 조회

- `src/document/project-state.js`의 `PROJECT_STATE_FIELDS`가 문서·표현·세션 필드의 정본이다. `projectSetup`은 `initialMonth`, nullable `timelineRange`·`initialMapBounds`, `sourceMode: builtin | empty`를 소유한다. 커서는 유효한 비영년 월이며 선택 범위 안에 있어야 한다. 초기 bounds는 카메라에만 영향을 주며 형상 archive를 자르지 않는다.
- `territorialEntities`, `timelineRecords`, `geometries`, 작성 `labels`·`hydroEdits`, Generic·분포 자료·출처와 작성 스타일은 프로젝트 콘텐츠다. `timelineCursor`, `projection`, `view`, `layerVisibility`, `itemVisibility`, `physicalSettings`는 세션 상태다. 문서별 보기 상태는 `documentId`로 격리하고 늦은 복구 응답이 다른 문서/세대를 바꾸지 못하게 한다.
- 기본 세계지도는 검증된 국가별 원본의 정체성·전체 유효기간 기록·참조 형상을 하나의 프로젝트로 수용한다. 최초 표시 월 때문에 이력을 잘라내거나 무기한으로 바꾸지 않는다. 진입 시 수용한 뒤 날짜 이동은 같은 문서와 본문을 유지하며 Core의 커서·`resolveWorld`를 사용한다. 월마다 문서나 국가 요청을 다시 만들지 않으며 화면 게시 실패는 이전 커서로 복원한다.
- `src/document/project-resource-overlay.js`는 작성 객체와 참조 자료의 읽기 전용 투영이다. 영역은 현재 Core 유효 객체만 사용한다. 작성 지명의 `sourcePlaceId`, 수계의 `sourceFeatureId`는 표시·선택에서만 원본을 대체하며 원본·타일·명칭 이력을 삭제하지 않는다. 복수 작성 기록은 모두 보존하고 물리 수계 마스크 충돌은 기존 등록 순서를 따른다. 날짜마다 현재 유효 집합과 준비 완료 여부를 확인한다. 기본 지명·수계 전체를 프로젝트 JSON에 복제하거나 사전 로딩/재해시하지 않는다.

## 프로젝트 파일과 복원

- 현재 파일은 GPKG의 `pandolab_project_settings.project_state`에 저장한 `pandolab-project-state` schema 14다. 정본 JSON과 C++ 문서가 `documentId`, 전체 타임라인·형상 archive·객체·출처를 소유한다. 공간표는 표시/교환 파생물이며 정본 날짜·관계·형상을 역으로 덮어쓰지 않는다. 구형/미래 스키마 및 autosave를 파일로 위장한 입력을 거부하고 원래 파일은 덮어쓰지 않는다.
- 기존 프로젝트의 `sourceEntityId`, `sourceGeometryVersion`, `metadata.libraryOrigin` 등 출처를 보존하며 최신 카탈로그로 묵시적 재연결·ID 재발급을 하지 않는다. 저장/복원은 카탈로그 접속이나 현재 달에 의존하지 않는다.
- `pandolab_source_info`가 있으면 정본 `sourceInfo`와 일치해야 하며 현재 writer의 null/빈 객체 표현은 동등하게 처리한다. 표가 없으면 정본으로 충분하다. `pandolab_country_assets`는 정본에 없는 국기만 복구한다. 상충 값·중복 ID·미존재 객체·잘못된 인코딩은 거부한다. 정본 국기·출처·형상을 sidecar로 교체하지 않는다.
- 검증은 분리된 후보에서 완료한 뒤 활성 프로젝트를 교체한다. 손상된 파일·Worker 응답·참조·기간·형상은 기존 문서·선택·이력·저장 대상을 변경하지 않는다. full autosave는 전체 archive를 보존한다. 현재 지원 delta 복원은 정확한 `baseDataset`과 `baseDatasetFingerprint`가 일치해야 하며 이름/자산 버전만으로 대체하지 않는다. Viewer IndexedDB는 문서별 보기 상태이며 별도 편집 autosave writer를 만들지 않는다.

## 국가 원자료·파생 자산

- `assets/data/territorial-entities/source/countries/`의 객체별 원본은 메타데이터·존속기간·날짜별 `geometryVersions`를 소유한다. lineage는 명시적 참조·관계만 가지며 좌표를 복제하지 않는다. `metadata.representativeGeometryVersionId`는 무일자 대표 선택일 뿐 과거 자료 공백의 fallback이 아니다. 미상 기간은 null로 보존하며 역사 정확성을 뜻하지 않는다.
- `source/views/world.json`은 공통 관측일 없는 명시적 entity/version 표시 선택이다. `source/snapshots/`의 실제 날짜 선택과 구별한다. current-world·chunk·미리보기·mesh·국가별 런타임은 파생물이며 소스의 좌표·속성을 대체하는 별도 정본이 아니다. donor 형상이 다르면 먼저 정본 선택 버전에 출처·검토와 함께 수용해야 한다.
- sourceIndex를 사용하는 reader/생성기는 소비 원본마다 정확히 한 행과 저장 chunk SHA·해독 객체·메타데이터·bbox를 확인한다. 주입한 `entities`/`readSource`도 같은 검증 책임을 가진다. 국가별 날짜 기록·원본 binding·coverage는 각각의 현행 payload 계약을 따르며 별도 datePrecision·device-current mode를 만들지 않는다. 경로의 v1/v2 이름을 payload schema로 추정하지 않는다.
- 현재 내장지도 index의 저장 layout은 `src/data/builtin-country-files.js`가 검증하는 `descriptor-geometries-v1`이다. 좌표 없는 국가 descriptor의 geometryRefs와 별도 geometryAssets를 연결하고 불변 readIndex로 날짜를 조회한다. 이전 country-files/합본 packed 형식의 compatibility reader를 만들지 않는다. 국가 gzip의 물리 파일은 최대 512KiB이며 큰 국가는 국가 소유 parts로 나눈다. 각 part와 재조립한 전체 gzip의 해시·길이·encoding, 해독 형상 content hash를 검증한다. 전체 국가 합본 전송이나 저장된 세계 프로젝트를 요구하지 않는다. 불변 archive payload와 chunk 원본·과거 판본은 보존하고 현재 런타임 참조 여부와 구별한다.
- 국가별 생성과 delta finalizer는 바뀌지 않은 파일의 경로·해시·encoding·저장/해독 길이를 그대로 재사용한다. 런타임 로더는 최대 여섯 개 읽기와 동일 자산의 in-flight 요청을 공유한다. 만료된 조회가 다른 소비자의 읽기를 취소하거나 오래된 장면을 게시해서는 안 된다. 표시 시점에 필요한 형상만 읽으며 별도 국가 문서/세계 모델을 재구성하지 않는다.
- 선택 생성은 기존 원본/chunk와 `config/generated-artifacts.json` 의존 그래프를 사용하고 무관한 출력은 재사용한다. 연결된 부모·형상 겹침·표시 대체 입력 범위와 실제 검증 대상 ID를 구분한다. 연결 범위에 미선택 WIP가 있으면 중단한다. 이름 전용 생성은 비명칭 변경을 거부하고 형상·기간·관계·coverage를 유지한다. 국가/월 및 연결 부모에 필요한 범위만 생성하고 비대상 출력 receipt를 유지한다. 생성만으로 런타임 자료 pin을 전진시키지 않는다.
- 기본 관계·영토 합성 예외의 데이터 소유자는 외부 `assets/data/builtin-world/display-policy-v1.json`이다. 생성기는 검증 후 적용하고 출처·적용된 표시 정보를 프로젝트 metadata에 보존한다. 표시 정책은 법적 주권 판정이 아니며 기존 프로젝트나 원자료 좌표를 재분류하지 않는다. 날짜별 명시적 부모 규칙은 근거와 bounded interval을 요구하고 자기 참조·중첩·순환·누락을 거부한다. lineage 승계로 행정 부모를 추론하지 않는다.

## 허용되는 원자료 수정과 활성화

- 현대 원본 채택은 기존 `tools/gis/historical-display-review.mjs`의 source-only 검토 경계로만 한다. 미일자 단일 현대 버전 또는 두 대표 선택기가 이미 가리키는 선택된 dated open-ended current proxy 한 버전만 허용한다. 열린 끝점만으로 현대 자료 자격을 추정하지 않는다. 다른 버전·순서·기간·명칭·존속·부모·기존 불확실성과 출처를 유지한다.
- `modernBoundarySupplement.sourceAdoptionReview`는 보관된 JSON의 경로·SHA로 entity/version·전후 형상 digest·원본 receipt·좌표 roundtrip·위상/소유 검사를 연결한다. 종전 attribution은 `priorPreparedAttribution`에 남긴다. 새 sourceInfo 형상 digest는 선언한 `sha256(JSON.stringify([geometry.type, geometry.coordinates]))` 기준으로 검증한다. source-only 채택에 역사 복원·생성 chunk·표시 출판물을 섞거나 다른 역사 버전을 함께 바꾸지 않는다. 원본 수용은 렌더링 승인이 아니다.
- 확인된 잘못된 current identity의 폐기는 기존 `--retirement-manifest` 경계를 사용한다. 역사적 소멸일·과거 형상 재귀속을 만들지 않는다. 단일 선택 버전·관계 없는 단독 lineage·짝지어진 display subunit만 허용하고 모든 유입 참조를 검사한다. 일반 entity scope나 전체 prefix는 폐기 승인이 아니다.
- 같은 scoped write lease에서 이전/활성 index·world view·display policy·builtin index/coverage/current-world 및 대상 source/chunk/lineage의 정확한 `{path,sha256}` 원본 receipt를 보존·검증한다. 선언한 파일과 정확한 view 선택만 제거하며 남은 descriptor·국가 bytes·비대상 revision을 유지한다. 폐기 producer의 정확한 file Map과 recovery receipts를 검증한 후 index를 마지막에 게시한다. 실패 시 이전 bytes를 복원하고 복원 실패는 불완전 복구로 보고한다. 이를 파일 여러 개의 원자적 filesystem 쓰기라고 주장하지 않는다.
- 최종 scoped storage도 동일 manifest·정확한 prefix·명시적 `--remove-path`와 원래 archive receipts를 검증한다. 앞선 소스 revision 변경을 unchanged compiled payload로 숨기지 않는다. 원시 참고 자료·원본 증거·기존 content-addressed payload는 폐기 대상이 아니다.

## 읽기 전용 검수와 자료 revision

- 검수 sidecar는 프로젝트/Core/원자료를 바꾸지 않는다. 서로 다른 확정 library Git SHA의 `baseRevision`·`candidateRevision`에 고정하며 candidate는 base의 자손이어야 한다. 코드 revision, 자료 revision, 역사 시점, 독립 보고서 revision은 각각 구별한다. 같은 역사 시점에서 두 자료 revision을 비교하는 행위를 역사 날짜 이동과 혼동하지 않는다.
- 제안은 불변이며 상태는 append-only 이벤트로 계산한다. 수정 제안은 새 ID와 supersedes 참조를 사용한다. 원본 `sourceEntityId`, 원래 endpoint 정밀도, 필드별 before/after, 고정 보고서 경로·SHA 근거를 보존한다. 좌표·국기 이미지 원문을 제안서에 복제하지 않는다. 이벤트의 ci/actor 문자열만으로 실제 인증·검사·승인·Git 반영을 증명하지 않는다.
- 검증은 실제 실행한 schema·temporal·source-integrity 및 변경에 필요한 topology·parent-graph 결과를 구별한다. failed/not-run을 passed로 바꾸지 않는다. 사람 승인은 validated 뒤에, CI applied는 승인과 실제 반영 revision 근거 뒤에만 기록한다. 자동 비교는 승인·반영 이벤트를 생성하지 않는다.
- E3는 archive index의 논리 해시로 바뀐 국가만 읽고 정확한 payload의 압축/내용 해시를 검증한다. 불명확한 기간 대응·형상/국기 해시·지원 밖 도메인은 issue로 남기며 추정하지 않는다. 배치는 전체 변경 수·index/count·scope.complete를 명시하고 전 배치 근거를 확인하기 전 전체 검증으로 표현하지 않는다. 지도 변경 없음도 정상 결과다. 역사 정확성·인접 국경 위상을 실행하지 않았다면 미검증으로 남긴다.
- Viewer는 선택 파일과 manifest의 크기·SHA, repository·두 revision·비교 월·필드·전후 값을 대조한다. 원본 비교는 변경 객체만 요청하고 객체/형상 ID·version·실제 좌표 해시를 확인한다. 실패한 자료는 기존 패널 상태를 교체하지 않는다. 비교 화면은 현재 pin의 세계지도나 Core에 좌표를 적용하지 않는다. 선택/초점 이동은 정확한 원본↔프로젝트 대응에서만 허용하고 수정 요청 JSON은 로컬 초안이다. 점검기에 편집·저장·자동 승인·Git 쓰기 권한을 추가하지 않는다.

## URL·보존 경계

- 참조가 끝난 구형 정적 URL의 영구 유지·자동 redirect·대체 호스팅 의무는 없다. 현재 pin·Viewer·Worker·생성기·매니페스트·유효 fixture가 참조하는 파일과 원본 무결성·역사 증거는 유지한다. 낮은 버전·오래된 이름만으로 삭제하지 않는다.
- 과거 개별 삭제 승인을 다른 자산의 포괄 삭제나 main 통합·배포 승인으로 재사용하지 않는다. 소비자·정확한 bytes·복구 가능성과 현재 보존 정책을 확인한 범위만 정리한다. 미복원 archive/report의 부재는 삭제가 아니다. 실제 공개는 배포된 앱 main의 자료 pin으로만 결정한다.

- 원본 enclave hole 채택은 원래 ordered ring 좌표와 전후 해시, 대응 객체/version을 hash-bound receipt에 보존한다. 선언하지 않은 좌표·형상·소유 필드는 유지하고 부분 원본을 전체 원본으로 주장하지 않는다. source-only 승인은 표시·compiled 게시 승인이 아니다.
- KAB/BJN/SER/PGA의 활성 identity 정정은 외부 원본·복구 이력·공유 자산을 보존한다. KAZ/COL 및 기존 Spratly 수령국의 해당 층 형상만 검증해 보완하며 역사 버전·UMI·실제 Wake를 바꾸지 않는다. 관련 source/runtime/mesh/index 짝 검증 전 일부만 활성화하지 않는다.
