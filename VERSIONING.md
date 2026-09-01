# PandoLab 버전 정책

## 앱 버전

앱 릴리스 버전은 `package.json`의 `version`을 단일 원본으로 사용한다. 현재 개발 단계에서는 `0.MINOR.PATCH` 형식을 따른다.

- `MINOR`: 사용자 기능 추가, UX 정보구조 변경, 새 객체 유형, 호환되지 않는 저장 계약 변경
- `PATCH`: 기능 계약을 유지하는 버그 수정, 시각 조정, 성능 개선, 내부 리팩터링

커밋 하나마다 버전을 올리지 않는다. 릴리스 단위와 사용자에게 설명할 수 있는 변경 범위를 기준으로 결정한다.

## 저장 스키마와 데이터셋

프로젝트·분포·레이어 표현·라이브러리 같은 저장 스키마 버전은 앱 버전과 독립적인 정수로 관리한다. 저장 구조가 기존 파일과 호환되지 않을 때만 해당 schema version을 올린다. UI 변경만으로 schema version을 올리지 않는다.

Natural Earth, 수계, 지형, 역사 라이브러리 등 데이터셋 revision도 앱 버전과 분리한다. 실제 데이터가 변경된 경우에만 해당 데이터셋 revision을 갱신한다.

## 배포 빌드와 캐시

배포마다 생성되는 build ID가 정적 자산 URL, Worker URL, Cache Storage 이름, cache recovery 값에 동일하게 사용된다. 수동 `rN` 증가값은 사용하지 않는다. 기본 build ID는 소스 내용 fingerprint이며, CI에서는 `PANDOLAB_BUILD_ID`로 명시적인 빌드 식별자를 주입할 수 있다.

`package.json`의 버전은 사람이 관리하고, `scripts/generate-build-metadata.mjs`가 HTML·런타임·Worker에 필요한 파생 값을 생성한다. 브라우저 코드는 `package.json`을 직접 읽지 않는다.

## 릴리스 기록

README의 `변경 이력`은 최신 버전부터 수동으로 작성한다. 과거 릴리스 설명은 Git 커밋이나 해당 시점의 README에서 확인되는 내용만 기록하며, 없는 버전의 기능을 추정해 추가하지 않는다.

## 예시

- 단순 모바일 정렬 버그 수정: `0.30.1`
- 지도/추가/편집 Surface 체계 개편: `0.31.0`
- 저장 구조가 함께 호환되지 않는 Generic Feature 도입: 앱 `0.31.0`, 프로젝트 schema `3`
