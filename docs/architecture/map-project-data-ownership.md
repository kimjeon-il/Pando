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
