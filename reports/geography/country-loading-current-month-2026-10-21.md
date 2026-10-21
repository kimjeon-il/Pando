# 국가별 내장 지도 로딩과 기존 단일 프로젝트 보관

> 보고서 ID: `GEO-LOAD-20261021` · 상태: `implemented / focused-verification` · 지도 반영: `work-gis-only` · 색인일: 2026-10-21
> 원문 최종 수정: 2026-10-21
> 조사 기준: Web/App 공통 소스 `ab4112e0ec47b552153257986ef83a3a37b89411` + 이 보고서와 함께 커밋한 `work/gis` 변경
> 원본·출처: `assets/data/territorial-entities/source/countries/`, `source/views/world.json`, 기존 역사 경계 정책

## 대상과 기준일

기존 `world-project.json.gz`를 게시·앱 스테이징·실행 경로에서 제거했다.
국가별 정본과 GIS 좌표는 수정하지 않았다. 국가별 원본 281개를 기존 ID 병합과
하위 객체 규칙으로 파생한 실행 객체 파일은 277개다. 전체 파생 파일과 목록은
13,581,015바이트이며, 단일 세계 프로젝트를 저장하거나 배포하지 않는다.

내장 뷰어는 기기 현지 달력의 현재 월로 시작한다. 자동 상태에서 월 전환,
포커스 복귀, 표시 상태 복귀를 확인하며, 수동으로 선택한 과거 월은 고정한다.
내장 지도 다시 열기는 현재 월 자동 상태로 돌아간다. 날짜 미확인 현대 형상은
현재 월의 잠정 참고 맥락에만 포함하며 원본 관측일이나 과거 유효일을 만들지 않는다.

## 구현과 보관

- 정본 국가 파일 → `tools/builtin-world-compiler.mjs` →
  `assets/data/builtin-world/generated/v1/index.json` 및 해시 이름의 국가별 gzip.
  목록에서 선택 월의 가용 국가를 고른 뒤 최대 6개 병렬 읽기로 가져온다.
- 공유 로더가 선택 월의 장면을 메모리에서 조립하고 기존 Core에 gzip 입력으로
  검증·인계한다. 원본 존속기간, 정확한 형상 유효일, 출처 버전과 경계 참조는
  국가 파일 및 객체 출처 metadata에 보존한다. 과거 전체 자료를 미리 다운로드하지 않는다.
- 편집 프로젝트는 선택 장면의 정적 복사본이다. 프로젝트의 무기한 레코드는
  편집 인스턴스의 의미이며 역사 자료의 무기한 유효성을 주장하지 않는다.
  기존 출처 계약처럼 역사 자료 조회와 프로젝트 편집을 분리한다.
- 앱 자동저장은 필요한 형상을 포함하는 `pandolab-autosave-full`을 사용한다.
  선택 월·달력 전환·자료 갱신 뒤에도 원래 기준 데이터 지문을 재구성하지 않는다.
  폐기된 개발 자동저장의 이행 기능은 추가하지 않았다.
- 국가 로더, 게시 데이터 채널, 독립 라이브러리 게시, Web 정적 파일 폐쇄 목록,
  native full-world/소형 fixture 스테이징, 준비된 폴리곤 mesh 생성 경로를 함께 변경했다.
  기존 알고리즘과 형상이 일치하는 mesh는 재사용하며 물리적 육지 mesh도 유지한다.
- 사용자 파일을 읽기 시작할 때 자동 월 요청을 무효화한다. 실패 시 이전 모드만
  복원하며, 이미 더 최신 요청이 있다면 그 모드를 덮어쓰지 않는다.
  내장 기준 데이터의 Core 인계는 이전 교체/롤백 종료 후 수행한다.

기존 파일 5개는 다음 저장소 외부 폴더에 원래 상대 경로와 함께 보관했다.

`D:/dev/release-evidence/PandoLab/legacy-world-project/ab4112e0/`

`backup-manifest.json`에는 원본 커밋, 경로, 크기, SHA-256이 있다.
단일 프로젝트·manifest·coverage·expected trace·기존 날짜 recipe의 보관본을
바이트/해시로 확인하고 활성 원본을 제거했다. 과거 trace의 작은 복사본은
테스트 oracle로만 유지하며 게시하지 않는다. 작업 중 생성한 이전 해시 파일
277개는 삭제하지 않고 무시되는 고정 작업 출력 폴더
`build-native/lsib-supplement/country-intermediate/`에 보존했다.

## 검증 결과와 한계

실행 로그는 이 워크트리의 무시되는 `build-native/lsib-supplement/`에 있다.

| 범위 | 확인 결과 | 근거 로그 |
| --- | --- | --- |
| 기존 역사 결과 | 보관 trace의 월별 객체·출처 버전·형상 참조·상하위 관계·크림 귀속과 일치 | `country-derived-tests.log`의 baseline case |
| 국가 로딩 | 선택 국가만 요청, 캐시 재사용, 전체 로더 최대 6읽기, 손상 거절 및 재시도 | `country-core-tests.log`, `country-review-regressions.log` |
| Core 복원·경합 | 단일 파일 없는 인계, 달력 기준 데이터 없는 자동저장 복원, 이전 교체 롤백 뒤 마지막 요청 인계 | `country-autosave-final.log`, `country-review-regressions.log` |
| 시작·저장 | 전체 자동저장 및 초기 설정 보존, 저장본 승격, 교체된 세대의 후속 변경 방지 | `country-startup-restoration.log`, `country-startup-generation-final.log` |
| 게시·앱 staging | 국가별 release, 메타데이터, full-world 계획·소형 국가 fixture 계약 | `country-publication-tests.log` |
| Web 정적 파일 목록 | 참조된 국가 포함, 폐기된 단일 파일·고아 파일·정본 GIS 제외 | `country-product-assets.log` |
| 준비된 형상 | 고정 물리적 육지 mesh의 무결성·재사용 | `country-physical-mesh.log` |
| Web 실제 동작 | 10월→11월, 과거 1953-06, 수동 날짜 유지, 2027-01 현재 복귀, 폐기 파일 무요청 | `country-browser-final.log` |
| 사용자 파일과 시계 | 파일 읽기 중 자동 갱신 중지, 실패 시 모드 복원, 열린 파일의 연도 전환 유지 | `country-file-clock-browser.log` |
| 새 편집 프로젝트 | 선택한 2012-10 자료로 생성, 편집 커서 변경 뒤 동일한 복사본 유지 | `country-editor-snapshot-browser-final.log` |
| 소스 정합성 | 변경 JS ESLint, 버전/manifest 정합성, 국가 277개 해시/크기, 보관본 5개 해시 및 활성 파일 부재 | `country-source-lint.log`, `country-final-lint.log`, `country-version.log`, 실행 출력 |

검사 중 발견한 실패는 범위를 좁혀 수정 후 해당 case만 다시 실행했다.
물리적 육지 mesh 누락은 생성 입력을 복구했고, 복원 테스트의 교체 callback 누락은
fixture를 수정했다. 시작 중 교체된 세대가 저장된 월을 적용하던 문제는 인계 직후
세대 검사를 추가했다. 새 프로젝트의 native 모달 설정창이 일반 폐기 확인창을
가리던 문제는 확인 전에 설정창을 닫고 취소/실패 때 복원하도록 고쳐 같은 브라우저
흐름을 재검증했다. 첫 브라우저 시도는 다른 작업의 기존 서버를 재사용했으므로
결과에서 제외하고 빈 포트의 이 워크트리 서버에서 확인했다.

새 역사 좌표·독립 시대별 형상 검증·0.5 CSS px 정밀도 검사를 수행한 작업이 아니다.
전체 테스트나 앱 실행 파일 빌드는 하지 않았다. native 계약 검사는 실제 Windows/
Android WebView 실행 검증을 대신하지 않는다. 기존 편집/Undo 브라우저 전체 묶음도
재실행하지 않았다. main 병합, 원격 push, 배포는 이 작업에 포함하지 않는다.

## 판본

국가별 정본·LSIB 보충의 출처와 미교체 구간은
[GEO-WORLD-20261021](country-files-lsib-2026-10-21.md)을 유지한다.
이 보고서는 그 좌표 검증을 대체하지 않으며 로딩·저장·보관 경로 변경만 기록한다.
