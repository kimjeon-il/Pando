# 프로젝트 빌드·런타임 소유권 정상화 및 잔여 코드 정리 (6–7단계)

## 적용 범위

- 지도 자료 선택의 단일 출처는 `projects/<projectId>/manifest.json`이다.
- Viewer 빌드는 선택된 9개 역할의 카탈로그 존재, 원본 바이트 SHA-256, 크기 및 교차 카탈로그 호환성을 검증한다.
- 생성되는 전역 `build-meta.js`는 `mapProject`, `mapProjectManifest`, `projectCatalogs`(역할·경로·해시·크기·수계 버전), Worker 및 초기 미리보기 배포 영수증을 제공한다. 국가/세계/메시/물리 카탈로그를 별도 전역 필드로 복제하지 않는다.
- `map-project-runtime.js`가 활성 프로젝트의 역할별 주소를 구성하고 기존 `createStoredAssetLoader`로 실제 카탈로그 바이트를 인증하여 선택한다. 최초 표시를 위한 육지·수역 카탈로그는 실행 시 한 번 읽고, 국가와 준비 메시 Worker는 기존처럼 지연 로딩한다.
- 준비 메시 Worker의 상대 경로 허용 범위는 고정된 `prepared-polygons/generated/v2` 디렉터리가 아니라 프로젝트가 선택한 카탈로그 디렉터리다.
- 불변 데이터 라이브러리의 리비전 핀, 저장 바이트 검증, Pages 스테이징의 전송 해시 및 기존 배포 절차는 변경하지 않았다.
- `initialLandPreview`는 최초 화면에 사용되는 별도 생성 자산이므로 검증 가능한 단일 배포 영수증으로 유지한다.

## 7단계 소비자 조사에 따른 정리 경계

- Viewer의 날짜 탐색은 기존 5단계 공통 C++ 커서이며, `builtinActive` 및 `builtinClock` 실행 분기는 없다.
- 현재 월을 계산하는 UI 기능은 중립적인 `calendar-month.js`로 이전하였다.
- `builtin-session.js`는 현재도 C++ 원장용 내장 국가 로더, 형상 지연 로딩, 준비된 소스 후보 및 첫 렌더의 데이터를 제공한다. 삭제하지 않는다.
- `builtin-month-clock.js`의 구 UI 컨트롤러는 현재 Viewer가 사용하지 않지만, 과거 날짜 회귀 테스트 및 저장된 계약에서 사용한다. 테스트와 소비자를 모두 이관할 때까지 삭제하지 않는다.
- `runtime-manifest-assets.js`의 구 비프로젝트 조회 fallback은 기존 자료 도구용으로 유지한다. 일반 Viewer 빌드는 매니페스트의 실제 카탈로그만 발행한다.
- `territorial-labels.js`의 옛 지명 기본 경로는 비프로젝트 테스트를 위한 호환용이다. 실제 Viewer는 `map-owner-composition.js`에서 현재 프로젝트가 고른 두 지명 카탈로그를 주입한다.

## 집중 검증

- 기본 프로젝트의 world/territorial/physicalLand/terrain/preparedMeshes 카탈로그 경로를 대체해도 Viewer 소스 변경 없이 해당 자료만 선택되는지 검사한다.
- 잘못된 카탈로그 해시, 세계/국가/메시/지형 간 출처 불일치, 두 Hydro 역할의 분리를 허용하지 않는다.
- 최초 미리보기는 계속 보존하고, GeoPackage 교체/롤백/날짜 변경과 함께 국가·수계·지명 선택의 기존 C++ 규칙을 변경하지 않는다.
- Pages 배포 방식과 운영 중 `main`은 수정하지 않는다.

코드 변경이 검사를 통과했다는 것과 공개 웹 배포가 완료되었다는 것은 별개다.
