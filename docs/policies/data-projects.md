# 프로젝트·데이터 소유권 정책

**현행 기준:** 앱·Viewer 코드는 Pando, 원본 GIS·런타임 지도·보고서는 별도 PandoLab-library 저장소에 보존합니다. 공개 자료 구성은 [해당 브랜치의 자료 핀](../../config/library-data.json)이 결정합니다. 런타임 생성물은 원본이 아닙니다.

| 구분 | 소유권·실제 참조 | 주의 |
| --- | --- | --- |
| 프로젝트와 외부 자료 구별 | [프로젝트 데이터 정본 계약](../architecture/project-data-ownership.md), [프로젝트 상태 코드](../../src/document/project-state.js) | 불변 원자료 캐시 재사용과 프로젝트별 가변 상태는 분리 |
| 기본 세계지도 콘텐츠 | [default-world 매니페스트](../../projects/default-world/manifest.json), [프로젝트 매니페스트 검증](../../src/data/map-project-manifest.js) | 국가/수계/지명 목록은 각 원본 카탈로그에서 파생 |
| 프로젝트 로딩·전환 | [프로젝트 런타임](../../src/data/map-project-runtime.js), [파일 읽기](../../src/data/project-file-reader.js) | 옛 내장지도 우회 경로를 독립 정본으로 만들지 않음 |
| 외부 자료·핀·보고서 발행 | [외부 라이브러리 운영](../library-data.md), [자료 핀 설정](../../config/library-data.json) | 외부 보고서의 저장은 공개 웹 게시 승인과 다름 |
| 이전 이행 단계 | [현행 계약](../architecture/project-data-ownership.md) | 단계별 계획을 현재 미구현 기능으로 추정하지 않음 |
| 데이터 폐기 및 URL | [구형 GIS URL 현행 정책](../data-url-retention-policy.md) | 당시 삭제 목록·원본 무결성은 별도 보존 |

**검증 계약:** `check-group:project-file-contracts`, `check-group:current-world`, `check-group:assets`. 최종 GIS 원자료의 역사적 정확도·실효지배 판단은 저장 파일의 존재 검증만으로 인증되지 않습니다.

## 다른 문서에 포함된 데이터·생성 규칙

- [GPKG 정본 저장·복원 규칙](../project-persistence-compatibility.md): `project_state` JSON이 정본이며 공간표·출처 sidecar는 제한된 검증·복구 역할만 수행합니다.
- [생성물 계획·게시 계약](../development/generated-artifacts-p2.md): 원본/출력 의존 그래프와 증분 검증의 기계 판독 정본은 [config/generated-artifacts.json](../../config/generated-artifacts.json)에 있습니다.
- [정밀 GIS 부분 조회 도구](../world-data-inspection.md): 원본 수정 금지, BBOX 단편 조회와 전체 시점별 형상의 차이, 원본 해시·출력 한도를 별도 절차로 확인합니다.
- [Map Toolkit 통합 경계](../reference-map-plugin.md): 외부 전용 분석 도구의 소스·배포·자료 핀은 Viewer의 별도 런타임 기능이 아닙니다.

