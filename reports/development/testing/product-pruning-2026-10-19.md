# 웹·앱 불필요 기능 정리와 공통 소유자 유지 검증

> 후속: 생성 UI와 초기 상태 저장 계약은 [UI-PROJECT-CREATION-20261019](project-creation-storage-2026-10-19.md)에서 대체했다. 아래 schema13·별도 프로젝트 설정 내용은 당시 기록으로 보존한다.

> 보고서 ID: `UI-PRODUCT-PRUNING-20261019` · 상태: `focused-verified / android-device-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-19  
> 조사 기준: 웹·앱 `work/ui` / `44fb6d41977123b5220cde8078f1e9a7e38b2728` + 작업 전 미커밋 변경 + 이번 수정  
> 원본·출처: 공통 UI fragment와 생성기, ProjectDomain, 제품별 자산 수집기, `.superpowers/sdd/2026-10-19-product-pruning/` 실행 기록

## 대상과 기준

승인한 한 계획의 구현이다. 앱의 시점 비교를 완전히 제거하고 중복 복구 버튼·고급 기능의 기본 메뉴 노출을 줄였다. 웹은 현재 지도 자료가 실제 참조하는 데이터만 포장하며 진단 API와 프로젝트 변경 API의 등록 범위를 제한한다. 현재 프로젝트 schema13과 공통 C++·Worker·지도 모델·렌더러를 유지한다. 일반 시점 조회, 프로젝트 시작 설정과 기간 편집은 유지한다.

작업 전 상태와 소스 사본은 실행 기록의 `baseline-status.txt`, `baseline.patch`, `baseline/`에 보존했다. 원격 확인 후 `origin/main`이 작업 기준보다 44개 커밋 앞선 것을 확인했다. 자동 stash 없이 ff-only 동기화를 시도했지만 기존 미커밋 파일을 덮어쓴다는 Git 거부로 적용되지 않았다(`main-sync.log`). 기존 작업을 보존하고 위 기준에서 구현했으며, 최신 main 반영이나 통합 검증으로 표현하지 않는다.

## 변경과 소유자

- 앱 시점 비교의 패널·버튼·비교 월 상태·계산 모듈·비교 렌더링·구독·전용 스타일과 해당 기능 테스트를 제거했다. 편집 기준 시점 표시는 기존 Core cursor의 읽기 경로를 유지한다. 공유 시점 계산 엔진을 별도 구현하지 않았다.
- 자동저장 복구는 파일 메뉴의 `autosaveRecoveryFileBtn` 하나로 연결한다. 상태바의 저장 상태·오류 표시는 유지하고, 취소 후 복구 재시도와 원본 저장본 보존을 검증한다.
- 경위선·그림자는 앱의 **보기 → 고급 보기**로 옮겼다. 웹의 기존 위치와 설정 기본값·환경설정 저장은 유지한다. 두 제품의 체크박스는 `map-decoration-controls.html` 한 소스를 포함하며 기존 map settings가 처리한다. 데스크톱 서브메뉴 등록·포커스·모바일 펼침도 기존 소유자를 확장했다.
- GIS 가져오기·내보내기는 **파일 → 고급 작업**에 둔다. 기존 import/export 작업은 유지한다. 메뉴 페이지는 workspace surfaces가 소유하며 뒤로·Escape·좌우 방향키·파일 선택기/가져오기 취소 후 포커스 복귀를 연결했다. DOM은 표시 결과이며 별도 도메인 상태로 사용하지 않는다.
- `createProjectDomain`은 명시적인 `productMode`를 요구한다. 뷰어는 문서 열기·조회·교체를 공유하되 명령·Undo/Redo·프로젝트 생성·설정·저장·자동저장 API를 등록하지 않는다. 편집기는 기존 공통 구현을 그대로 등록한다. 제품 권한을 URL이나 화면 크기로 바꾸지 않는다.
- 웹의 `__PANDOLAB_VIEWER__` 진단 표면은 정확히 `debug=1`인 경우에만 등록한다. 디버그 표시는 읽기 전용 Core 정책에 영향을 주지 않는다. 진단을 사용하는 회귀 검사만 명시적으로 디버그 실행을 선택한다.

## 웹 데이터 포장

이전 `assets/data` 전체 포함을 현재 world·historical-world·territorial library·prepared polygons·hydro·places·terrain manifest의 런타임 참조로 교체했다. 출처·생성 입력·오래된 파생 자료를 실행 자산으로 간주하지 않는다. 정적 import, 동적 import, Worker와 런타임 URL 검사는 기존 제품 수집기에서 계속 수행한다. 참조 자원이 누락되면 실패한다. 공통 폰트·vendor·WASM의 기존 포함 계약은 유지한다.

현재 작업 소스 기준 정적 수집 결과(`asset-audit.json`):

| 데이터 선택 | 파일 수 | 바이트 |
| --- | ---: | ---: |
| 종전 전체 폴더 포함 | 1,535 | 418,652,647 |
| 현재 manifest 참조 | 610 | 95,384,486 |
| 웹 포장 대상에서 제외 | 925 | 323,268,161 |

전체 웹 선택은 1,314개 파일이다. 저장소 원본 GIS 파일은 삭제하지 않았다. 이 수치는 로컬 포장 목록 비교이며 실제 배포 용량·네트워크 전송량·메모리·FPS 개선 측정은 아니다. 미커밋 소스의 실제 Pages 게시 staging을 수행하지 않았으며, committed-byte 보호를 해제하지 않았다. staging 단위 검사는 임시 Git fixture에서 실제 staging 도구를 실행한다.

## 검증 결과

- 관련 단위·Core/WASM 동작·제품 HTML·웹 자산·Pages staging·앱 두 데이터 프로필 staging 검사: **137 통과, 0 실패, 1 건너뜀** (`final-units-green.log`). Windows에서 심볼릭 링크 생성이 허용되지 않아 해당 기존 보안 fixture 한 건만 건너뛰었다.
- 변경 JS와 관련 테스트 ESLint: **통과** (`final-lint.log`). 전체 테스트와 무관한 아키텍처 검사는 실행하지 않았다.
- 앱 상태바/선택·시점 보존, 프로젝트 시작 설정·기원전 범위, 웹 프로젝트 열기의 원자성, Canvas 선택, 일반 웹 진단 API 비등록은 `browser.log`의 최종 개별 통과 결과로 확인했다. 이 실행 전체는 고급 메뉴의 초기 실패 때문에 통과 실행으로 표시하지 않는다.
- 파일 메뉴 겹침/키보드, 복구 취소 후 재시도·즉시 복구와 저장소 원본 보존, GIS provenance 회귀는 `final-browser.log`에서 통과했다. 고급 메뉴 테스트의 펼침 유지 상태를 반영한 후속 결과는 아래 별도 실행을 기준으로 한다.
- 고급 보기의 오른쪽 방향키 진입·왼쪽 방향키 복귀, 실제 경위선 상태 변경·원복, PC/640×360/844×390 전환 시 카메라·선택·시점·Undo 상태 보존, GIS 선택 레이어 내보내기의 실제 GeoPackage 테이블, 모바일 GIS 단계/뒤로/취소/포커스 복귀: `menu-gis.log`의 해당 **3개 시나리오 통과**. 같은 실행의 오래된 기본 파일 메뉴 기대값은 후속 검사를 구분해 기록한다.
- 기본 파일 메뉴의 현재 목록·End/Escape 포커스, 설정/도움말 대화상자와 반응형 상단바: **1/1 통과** (`shell-final.log`). 이전 기본 메뉴 직접 자식·GIS 노출 기대값을 현재 고급 페이지 계약으로 갱신했다.
- Windows full-world 고정 디버그 빌드 **성공** (`windows-build.log`, 4분 51초). 같은 경로의 실제 WebView2 시작 **12/12 통과** (`windows-probe.log`, `windows-verified/world-windows.json`). 원본 258개/현재 객체 254개/최상위 207개, 공통 Core·Worker·메시·렌더러·내장 역사 자료 준비를 확인했다. `staging-ui-parity.json`에서 수정 자산 18개가 소스와 바이트 일치하고 비교/시점 이동/중복 복구 DOM 및 비교 모듈이 없음을 확인했다. `windows-parity.json`에서 내장 Core 원본 SHA와 WASM 3개 자산 해시, staging HTML 해시를 대조했다. 기존 Rust `unused_mut` 경고 하나는 이번 범위에서 변경하지 않았다.

초기 검사에서 고급 보기 데스크톱 서브메뉴 등록 누락과 파일 메뉴 Escape 처리를 수정했다. 비교 제거·API 축소 뒤 남아 있던 테스트와 현재 Core admission snapshot의 기대값을 갱신했다. 기간 조회의 문서 비변경 및 교체 실패/Undo 검증 자체는 유지한다. 최종 독립 검토에서 기존 Important 3건과 비교 CSS 잔여 제거를 재확인했으며 추가 Important는 없었다. 검토는 실행 검증을 대신하지 않는다.

## 한계와 반영

Android 연결 기기는 `adb devices`에 없었다. 실제 휴대폰 방향 전환·키보드·파일 선택기·뒤로 가기는 **미검증**이다. 브라우저 크기 검사는 네이티브 검증으로 대체하지 않는다. Windows 시작 probe도 직접 마우스로 모든 메뉴를 조작한 결과와 구분한다.

로컬 `work/ui` 소스와 고정 Windows 실행 파일 갱신 범위다. 커밋·푸시·main 통합·배포·포터블 패키지는 수행하지 않았다. 지도 원본 형상과 schema13은 변경하지 않았다. 중간 실패·trace·원시 로그는 보존한다.

## 판본

[작업표시줄 시점 이동 제거](editor-status-timeline-removal-2026-10-19.md)의 후속 변경이다. 이전 보고서의 시점 비교 유지 부분은 이번 제거로 대체하며 당시 검증 기록은 그대로 보존한다. [앱 편집 집중과 저장 범위](editor-focus-project-storage-2026-10-19.md), [객체 표시 통합](unified-object-display-2026-10-19.md)의 기존 변경을 보존했다.
