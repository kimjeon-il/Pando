# 지도·프로젝트 중복 검사 정리 (2026-11-08)

## 설계 및 검수 소유권

- 유일한 사용자 제품은 Web Viewer이며 내장 세계지도는 처음 한 번 공통 C++/WASM Project/DocumentSession에 수용되는 **독립적인 읽기 전용 프로젝트**다. 사용자 GPKG를 열더라도 두 번째 전용 타임라인/문서 정본을 만들지 않는다.
- 검수 패널은 현재 프로젝트의 변경 증거, 원본/후보 SHA 및 화면 진단을 다룬다. 다만 `viewer-inspector-state.js`는 위상 검증을 아직 **미실행**으로 표시하므로 검수기 화면을 열었다는 이유로 실제 Native/GEOS 위상 검증 완료라고 주장하지 않는다.
- 원본 GIS 무결성, Native 위상, Core 파일 바이트, 오류 시 프로젝트 교체 원자성, GPU 생명주기는 서로 다른 독립 실패 조건이므로 유지한다.
- 데이터 내용에 대한 고정된 국가별 날짜·국명·국기·영토 예시는 공통 프로젝트 검증과 데이터 발행 절차 및 검수 증거로 관리한다. 새 역사 사실은 관련 출처 증거와 발행 리뷰가 필요하며 단위 검사에 사실 목록을 다시 복제하지 않는다.

## 실행 검사에서 폐기한 전용 진입점

| 종류 | 삭제한 단위 검사 파일 | 대체/남은 책임 |
| --- | --- | --- |
| 연구된 국가별 연표 스냅샷 | `post-2000-generated-world-display`, `indonesia-territory-timeline`, `sudan-ukraine-transition`, `soviet-republic-transitions` | `timeline-resolver`와 `builtin-world-catalog`의 일반 날짜 계약, 원본 근거 및 `viewer-calendar` 실제 게시 검증 |
| 국명·국기 편집 이력 결과 고정 | `gis-2000-2026-attribute-history` | 실제 적용 스크립트의 `--plan` 불변성 검사, 국가별 생성물 검사, Viewer와 읽기 전용 리뷰 |
| 폐기된 Map Plugin 작성·첨부 경로 | `map-plugin-cutover` | `file-access-contract`, `p6-project-persistence`, `timeline-geopackage`의 현행 파일 입력·거부 및 Core 프로젝트 검증 |
| 폐기된 Map Plugin 명칭으로 분리된 Core 사례 | `map-plugin-hydro-history` | 실제 `hydro.geometry` / Undo 사례는 `core-hydro-create-wasm`로 이전 |

## 중복된 내장지도 특례 제거

`builtin-world-loader`의 내장지도 전용 자동저장 복구/분리된 Core 비변경/별도 파일 항목 3개 및 `builtin-world-catalog`의 동일 일반 스키마 프로젝트/현재·전월 실데이터 확인 항목 2개를 제거했다. 이미 남아 있는 동일 Core 프로젝트 ID 유지, 월 커서 전환, 전체 연표 보존, 정본 형상 선택, 입력 손상 거부 및 source cache 검사를 보존했다.

`application-checks.json`의 `project-file-contracts` 그룹은 현재 Viewer 파일 선택, 공통 저장 형식, 실제 GPKG 왕복을 소유한다. 역사 데이터 변경 바인딩은 나라별 스냅샷 대신 일반 Loader/Catalog/타임라인 검사를 선택한다. 연관 워크플로에서 삭제된 파일 호출을 제거했다.

**주의:** 개별 국가 역사 사실에 대한 고정 기대값은 제거되었다. 이는 검수기가 원본 지리적 사실을 완전히 자동 검증한다는 뜻이 아니며, 지리 자료의 실증·출처 검증은 기존 GIS 발행·검수 절차에서 계속 수행해야 한다.

작업 중 Node 테스트, 린트, 브라우저, C++/WASM 빌드 및 CI는 실행하지 않았다. 실제 통과 여부는 확인하지 않았다.
