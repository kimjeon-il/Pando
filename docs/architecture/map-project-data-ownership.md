# 지도 프로젝트 콘텐츠 소유권: 0~2단계 전환

기준: `work/optimization@8f3155775651b8b23307eea96b3010c6760ae957` (2026-11-09). 이 문서는 작업 시작 시점의 현재 연결을 기록한다.

## 목표

Viewer는 지도, 영토 객체, 강, 호수, 지명, 지형, 메시를 **처리하는 범용 계약**을 소유한다.
실제 어떤 세계와 어떤 자료 집합을 사용할지는 프로젝트별 콘텐츠 매니페스트가 결정한다.
객체·지명·강·호수의 **개별 목록은 각 자료 카탈로그에 하나만 존재**하고, 프로젝트는 그 카탈로그를 참조한다.
GIS 원본, 정밀 좌표, 아카이브는 `PandoLab-library-data`에 보존한다.

## 0단계: 현재 소유 관계

| 현 소비자 | 현재 직접 지정하는 자료 | 옮길 책임 |
| --- | --- | --- |
| `scripts/lib/frontend-build.mjs` | 세계, 국가 인덱스, Hydro, 지명, 물리 육지, 지형, 메시: 7개의 고정 경로 | 선택 프로젝트의 `resources` |
| `src/data/runtime-manifest-assets.js` | 위 7개 자료를 항상 배포 목록에 포함 | 프로젝트가 선택한 카탈로그만 포함 |
| `scripts/lib/product-assets.mjs` | 일부 Worker와 연결된 자료 경로 | 코드/Worker 의존성만 유지하고 데이터 의존성은 프로젝트에서 수신 |
| `src/document/builtin-session.js` | `buildMeta.builtinWorld` 국가 인덱스 | 프로젝트의 `territorial` 카탈로그 |
| `src/rendering/territorial-labels.js` | `places/manifest.json` | 프로젝트가 선택한 지명 카탈로그 |
| `src/data/physical-resources.js` | 기본 물리 육지와 수역, 수계 런타임 자료 | 자료 처리기는 그대로 두고 참조 선택의 출처만 전환 |
| `tools/build/build-builtin-world.mjs` | 국가별 역사 소스에서 내장 지도 인덱스를 생성 | 프로젝트가 참조하는 국가 목록의 생성·검증 주체 |

내장 지도의 국가·시대·이름·국기는 이미 `builtin-world/generated/v1/index.json`에 표현된다.
새 국가 목록을 두 번째 JSON으로 복사하지 않는다. 강·호수는 Hydro 카탈로그,
물리 호수는 물리 육지의 dated water catalog, 지명은 Places 카탈로그를 그대로 사용한다.

## 1단계: 프로젝트 선언과 범용 스키마

- `projects/default-world/manifest.json`은 기본 프로젝트가 참조하는 지도/territorial/rivers/lakes/places/terrain/physicalLand/preparedMeshes 카탈로그를 선언한다.
- `src/data/map-project-manifest.js`는 프로젝트 ID, 계약 버전, 역할, 안전한 자료 경로 및 중복/누락을 범용 검증한다.
- `documentId`와 프로젝트 콘텐츠 `id`는 별개다. 사용자의 파일 프로젝트에 기본 세계지도 원본을 자동으로 합치지 않는다.
- 기존 `pandolab-project-state` 스키마 14와 C++ `timelineRecords` 스키마 3은 변경하지 않는다.

## 2단계: 기본 세계지도를 독립 프로젝트 입력으로 연결

- 기존 데이터 바이트·URL을 그대로 참조한다. 원본 GIS·국가 payload·프로젝트 파일을 이동·복사하지 않는다.
- Viewer 빌드가 위 프로젝트의 `resources`에서 자료 매니페스트 목록과 build-meta를 생성한다.
- 국가 로더는 build-meta에 검증된 프로젝트 참조를 우선하고 같은 C++ 수용·날짜 커서를 사용한다.
- Viewer 게시 목록은 프로젝트에 선언된 자료와 그로부터 추적되는 파생 파일만 포함한다.
- 초기 내장 프로젝트 외 다른 프로젝트의 사용자 작성 객체, 카메라, 선택, 시간축을 공유하지 않는다.

## 유지할 회귀 및 다음 단계

기존 기본 세계지도의 모든 자료 역할은 계속 같은 불변 파일을 선택하고 같은 SHA를 검증해야 한다.
부재·손상된 목록이나 미등록 유형을 조용히 기본 세계지도로 대체하지 않는다.
문서/세션 별도 소유, 캘린더 이동, Worker stale 응답, 완전한 저장 파일, GPU 장면은 현행 검사를 유지한다.

이 단계는 **기본 세계지도의 콘텐츠 소유권 분리**까지이며, 프로젝트 여러 개를 고르는 UI,
사용자 프로젝트용 별도 외부 자료 패키지 발행, C++ 문서 스키마 확장은 후속 단계다.

## 0~2단계 구현 결과 (2026-11-09, work/optimization)

- 프로젝트가 실제 콘텐츠를 선택하는 파일은 `projects/default-world/manifest.json`. `src/data/map-project-manifest.js`는 종류/경로/스키마를 검증하지만 실제 국가·강·호수·지명을 열거하지 않는다.
- `world`, `territorial`, `rivers`, `lakes`, `places`, `placeLifetimes`, `terrain`, `physicalLand`, `preparedMeshes`는 9개의 범용 자료 역할이다. 기본 세계지도에서는 강과 호수가 하나의 Hydro 카탈로그를 공유하므로 총 8개의 다른 카탈로그를 참조한다.
- `scripts/lib/frontend-build.mjs`는 위 콘텐츠 설정에서 필요한 자료 경로를 도출하고, 원본 경로·바이트 SHA 및 자료 리비전을 검증해 빌드한다. 게시 Viewer에는 `assets/data/projects/default-world/manifest.json`과 해당 해시가 포함된다.
- `src/data/runtime-manifest-assets.js`와 `scripts/lib/product-assets.mjs`는 **실제 Viewer 빌드에서 프로젝트 참조를 우선**하며, 선언되지 않은 옛 지명 카탈로그를 함께 배포하지 않는다. 자료 저장소의 구형 비프로젝트 뷰를 위한 fallback은 후속 마이그레이션까지 유지한다.
- `src/document/builtin-session.js`, `src/rendering/territorial-labels.js`, `src/data/physical-resources.js`는 국가 카탈로그, 지명/도시 유효기간 카탈로그, 강·호수 카탈로그를 프로젝트 선택에서 가져온다.
- 과거 국가별 형상·타임라인 목록은 `builtin-world` 인덱스와 별도 원본 국가 파일에, 강/호수는 Hydro 카탈로그에, 지명은 Places 카탈로그에 한 번만 존재한다. 프로젝트 선언에 중복된 객체/좌표를 넣지 않는다.
- `pandolab-project-state` 스키마 14, `timelineRecords` 스키마 3, C++/WASM 프로젝트 정본, 원본 GIS 파일·핀, 현행 날짜 전환과 원본 좌표는 변경하지 않았다.

### 확인된 실행 결과

검증용 임시 CI의 `node scripts/generate-build-metadata.mjs --check` 및
`node scripts/generate-build-metadata.mjs --check --product=viewer`는
실제 외부 라이브러리 고정 리비전 `a53f9b319b23678e82c4b9ffdb9f824a040ca5f3`과 함께 성공했다.
Viewer 전용 파일 집합은 1,902개 자산을 선택했고, ESLint 및 프로젝트/프런트엔드/배포 관련 단위 검사 23개가 성공했다.
GitHub Actions 실행 기록: https://github.com/kimjeon-il/Pando/actions/runs/42563192764

### 이 범위에 포함되지 않는 후속 작업

- 프로젝트 선택 UI·다중 프로젝트 lifecycle 통합, 사용자 프로젝트에 별도 원본 집합을 할당하고 활성 프로젝트가 바뀔 때 참조를 전환하는 기능은 3단계 이후다.
- 현재 Hydro 서비스는 강·호수에 하나의 카탈로그를 사용한다. 서로 다른 카탈로그를 강/호수에 지정하는 경우 명시적으로 거부한다.
- 고정 DEM 버전으로 외부 지형을 선택하는 정책과 이전 빌드/자료 저장소의 비프로젝트 fallback은 아직 남아 있다.
- 내장 지도 `sourceMode: 'builtin'`은 기존 C++/WASM 파일 스키마 호환을 위해 유지하며, 콘텐츠 프로젝트 ID와 혼용하지 않는다.
- 이 단계의 검증은 선택된 자료 빌드·검사 범위에 한정되며, 전체 GIS·브라우저·C++/WASM 검사 또는 라이브 배포는 수행하지 않는다.

## 4단계: 프로젝트별 빌드·자료 준비 연결 (2026-11-09 추가)

- `mapProjectManifestSourcePath(projectId)`가 프로젝트 ID를 검증하고 `projects/<projectId>/manifest.json`만 선택한다. 매니페스트 내부의 `projectId`와 요청 ID가 다르면 실패한다.
- `buildFrontendSnapshot({projectId})`, `generate-build-metadata.mjs --project=...`, `frontend-dev-server.mjs --project=...`, `stage-monorepo-pages.mjs --project ...`로 명시적으로 선택할 수 있다. 인자를 생략한 웹 배포는 이전처럼 `default-world`를 선택한다.
- 빌드 결과 `buildMeta.mapProject` / `mapProjectManifest`는 선택된 프로젝트의 9개 데이터 역할과 검증된 매니페스트 바이트·해시를 담는다. 다른 프로젝트의 지명 카탈로그를 암묵적으로 함께 발행하지 않는다.
- `prepareLibraryData({projectId})`는 고정된 외부 자료 저장소 인덱스를 프로젝트의 역할 그래프대로 선택해 read-only 뷰로 준비한다. 비프로젝트 구형 호출은 현재의 호환용 자료 준비 경로를 유지한다.
- Pages 스테이징에서 필수 데이터 경로를 `terrain-preview/v0.13.3-p2`와 `hydro/v0.13.4`로 박아 두지 않고, **선택 프로젝트 매니페스트의 역할별 실제 카탈로그**로 검증한다. GIS 원본과 비선택 자료는 계속 배포되지 않는다.
- 개발 서버는 외부 자료 핀뿐 아니라 현재 프로젝트 매니페스트 변경도 감지해 다시 준비한다.

### 아직 제한된 사항

- 원래의 Hydro 런타임은 강과 호수가 하나의 공동 샤드 카탈로그를 사용하는 설계다. 프로젝트에 두 역할을 선언하되 **서로 다른 두 물리 Hydro 카탈로그를 동시에 렌더링하는 엔진은 아직 구현하지 않았다**. 강/호수 간 실제 데이터 합성이나 별도의 Worker를 임의로 추가하지 않는다.
- Viewer 실행 중 다른 프로젝트로 전환하는 UI 및 서로 다른 C++ 프로젝트 정본을 한 세션에서 교체하는 생명주기는 이번 빌드/데이터 소유권 분리와 별개다.
- 자료 저장소의 비프로젝트 호출용 호환 fallback, 일부 고정 지형 소스 선택은 남아 있다. 기본 프로젝트가 없는 임시 테스트와 이전 GIS 생성 도구를 갑자기 파손하지 않기 위해 일괄 제거하지 않았다.
- 단위 테스트와 CI가 통과해야 기능 검증 완료로 판정할 수 있다. **커밋은 실행 검증 성공을 의미하지 않는다**.


## 후속 단계: 프로젝트 Reader/Adapter 및 로딩 결과 통합 (2026-11-09)

- 입력 파서는 분리한다. 내장 세계지도는 기존 국가 인덱스와 C++ source/candidate를 준비하고,
  GeoPackage는 `src/data/project-file-reader.js`의 별도 Worker를 사용한다.
- `src/data/project-open-adapter.js`가 읽기 전략(`queued`/`eager`)을 등록하고
  양쪽 결과를 동일한 `pandolab-project-read-result`로 변환한다.
  오래된 C++ 교체가 끝나야 준비할 수 있는 내장 source만 대기열 안에서 읽는다.
  GeoPackage 디코딩은 교체 대기열 밖에서 미리 진행하며, 최신 요청만 C++로 진입한다.
- `ProjectDomain.openProject`는 출처에 관계없이 기존 command queue, C++ snapshot validation,
  bounded replacement capsule, Core admission, selection reset, rollback 및 presentation 승인 절차를
  한 번만 실행한다. 서로 다른 C++ admission 명령(`loadBaseline`/temporal candidate vs `load`)은 유지한다.
- 결과는 동일한 `pandolab-project-open-receipt`로 반환한다.
  `accepted`, `source`, `reason`, `documentId`, `generation`, `contentProject`로
  성공과 취소를 구분한다. 과거 `open`의 boolean 반환은 호환용 래퍼로 유지한다.
- Viewer는 같은 영수증에서 받은 generation을 실제 렌더링 완료와 비교한다.
  승인된 C++ 문서와 실제 표시 완료를 구별하며, 후처리(검색, 지형 부가 로딩)는
  이전과 같이 렌더링 준비 신호를 지연시키지 않는다.
- 입력으로 만들어진 국가·수계·지명·지형의 정본을 재작성하지 않는다.
  프로젝트별 리소스 선택과 rollback은 이전 단계의 동일 소유자를 사용한다.
  내장 지도 자동 현재월 추적은 Reader가 아니라 Viewer의 명시적 시간 정책으로 남긴다.

확인 항목: Reader 결과 계약, 큐 순서와 stale read, 실제 C++ 문서 승인,
이전 프로젝트 복구, 외부 프로젝트의 기본 내장 원본 미상속, 기존 지연 형상·캐시 유지.
전체 GIS 재생성, C++ 스키마 변경, GeoPackage 파서 통합, 신규 편집기는 수행하지 않는다.
