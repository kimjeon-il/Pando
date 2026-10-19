# 새 프로젝트 생성 통합과 보기 상태 저장 분리

> 보고서 ID: `UI-PROJECT-CREATION-20261019` · 상태: `focused-verified / baseline-test-failures / android-device-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-19  
> 조사 기준: 웹·앱 `work/ui` / `44fb6d41977123b5220cde8078f1e9a7e38b2728` + 작업 전 미커밋 변경 + 이번 수정  
> 원본·출처: 공통 ProjectSession·ProjectDomain·C++ ProjectCodec, 생성 UI, `.superpowers/sdd/2026-10-19-project-creation-storage/` 실행 기록

## 대상과 기준

승인한 새 프로젝트 생성·저장 범위 계획을 구현했다. 작업 중 추가 지시인 **분포도 기존 유지**를 반영하여 분포 모델·편집·표시 모드·경계 표시·저장 기능은 유지했다. 분포 설정은 기존 read-model의 `distributionSettings` 필드를 schema14 최상위 저장 필드로 사용하며, 제거한 `defaultView`에 중복 포장하지 않는다.

기존 `work/ui` 상설 워크트리의 미커밋·미추적 작업을 보존했다. 원격 확인 후 자동 stash 없이 `origin/main`의 ff-only 반영을 시도했으나 겹치는 WIP 때문에 Git이 거부했다. 기준 SHA와 기존 작업 위에서 진행했으며 최신 main 통합 검증으로 표현하지 않는다. 작업 전 상태·소스 사본·바이너리 해시는 실행 기록의 `baseline-status.txt`, `baseline.patch`, `baseline/`, `baseline-binary-hashes.json`에 보존했다.

## 변경과 정본 소유자

- **새 프로젝트** 한 창에서 시작 연월, 선택적 기간, 초기 지도 범위, 내장 지도/빈 지도 소스를 정한 뒤 생성한다. 기본값은 로컬 현재 월·기간 제한 없음·세계 전체·내장 지도다. 별도의 프로젝트 설정 버튼·설정 모드와 기본 화면 캡처/초기화 동작을 제거했다. 취소·검증 실패는 현재 문서를 바꾸지 않는다.
- 공통 C++ 문서와 현재 Web/native 형식은 **schema14**, 필수 `projectSetup { initialMonth, timelineRange, initialMapBounds, sourceMode }`를 사용한다. 초기 월은 여기 한 번만 저장한다. `defaultView`, `project.configure`, `project.default-view`와 해당 typed command·호출부·obsolete 테스트를 제거했다. 현재 파일만 지원하며 schema13 이전 개발 파일을 변환하지 않는다.
- 객체 표시·숨김은 공통 **ProjectSession**이 소유한다. 프로젝트 파일·프로젝트 자동저장에 `layerVisibility`·`itemVisibility`를 넣지 않으며 현재 Web/native reader도 이 필드를 허용하지 않는다. 작성한 색상·스타일·형상·기간·메타데이터·출처는 유지한다. 연월·카메라의 일시적 탐색도 작성 데이터와 분리한다.
- 기존 브라우저 저장소의 문서별 workspace 행을 양 제품이 공유한다. 웹에는 workspace 읽기·쓰기만 등록하고 편집 자동저장 읽기·쓰기·삭제·복구는 등록하지 않는다. 명시적으로 파일을 열면 시작 월·초기 범위를 적용한 뒤 같은 documentId의 유효한 표시 설정을 복원한다. 편집기 시작 복구의 자체 문서 월·카메라 복원은 유지한다.
- 표시 키 정리는 accepted document의 전체 객체 ID를 사용한다. 지연 로딩되는 내장 지명·수계는 현재 메모리 카탈로그가 전체 ID 집합이 아니므로 미로딩 개별 숨김 ID를 임의 삭제하지 않는다. 이 두 그룹의 존재하지 않는 키는 workspace에 남을 수 있으나 문서나 파일에는 들어가지 않는다.
- 지원하지 않는 이전 자동저장이나 읽기 오류는 원본 슬롯과 쓰기 정지를 유지한다. 이 상태에서도 새 프로젝트 생성과 명시적 파일 저장은 가능하며, 새 프로젝트 생성 중 기존 자동저장을 지우지 않는다. 이 경우 백그라운드 자동저장은 계속 정지되어 있다. 유효 저장본 간 충돌은 선택을 마친 뒤 생성한다.
- 생성 HTML은 원본 템플릿에서 재생성했다. 공통 WASM은 현재 C++에서 다시 빌드·포장했고 역사 지도 생성 입력도 현재 형식으로 재생성했다. 별도 렌더러나 프로젝트 모델을 만들지 않았다.

## 근거와 검증

실행 로그는 위 실행 기록 폴더에 있다. 임의 전체 테스트 대신 변경한 문서·저장·생성·보기·배포 자산의 소비 경로만 검사했다.

| 범위 | 결과 | 근거 |
| --- | --- | --- |
| Core/WASM·프로젝트·자동저장·생성·공통 보기 | 112/112 통과 | `focused-final.log` |
| 표시·영토 삭제·제품 API·작성 clock 소비자 | 24/24 통과 | `consumers-final.log` |
| 변경한 공통 테스트 fixture의 보기·스타일·삭제·Undo 소비자 | 32/32 통과, 위 검사와 일부 중복 | `viewing-consumers-final.log` |
| 제품별 자산·Pages staging·앱 두 프로필·분포 | 37/37 통과 | `staging-green.log` |
| 공통 표시 복원·기존 저장본 보존 추가 검사 | 8/8 통과 | `shared-view-final.log` |
| C++ native codec·문서 세션·소스 admission·시간 편집 | 4/4 통과 | `native-core-tests.log` |
| 변경 JS/MJS ESLint | 통과 | `lint-final.log` |
| 브라우저 생성·보기·열기·분포 | 8개 시나리오 통과: 최초 실행 5개 + 파일 열기 재검사·분포 3개 | `browser-final.log`, `browser-opening-distribution.log` |
| Windows full-world 고정 debug 실행 파일 | 빌드 성공, 실제 WebView 12/12 PASS | `windows-build.log`, `windows-probe.log`, `windows-verified/world-windows.json` |
| Android 실기기 | 미검증 | `adb devices`에 기기 없음 |

초기 검사에서 발견한 앱/viewer의 신규 공통 포트 누락은 정식 wiring에서 수정했다. schema 변경 후 남아 있던 예전 테스트 저장 필드는 실제 공통 viewing owner와 현재 문서 검증기로 교체했다. 이름 수정의 대형 지도 roundtrip은 정적 identity가 아니라 실제 월별 property binding과 재열기 후 resolved world의 이름을 확인한다. 초기 실패 로그는 삭제하지 않았다.

파일 열기 브라우저 검사의 최초 실패는 비동기 Worker의 손상 파일 처리 완료 전 8초 제한이 끝난 것이었다. 파일 검사에는 Canvas 렌더링을 사용하고 Worker 완료를 기다리도록 수정한 뒤 통과했다. 별도로 실제 실패 뒤 작업 상태 표시가 로딩에 남는 문제를 수정하여 기존 지도 개수·ready 상태를 복원하고 오류는 원래 작업 경계로 다시 전달한다. 손상 파일·선택 취소·늦게 끝난 이전 열기가 문서·형상·현재 상태를 바꾸지 않는 것을 재검사했다.

확대 소비자 검사에서는 별도 기존 테스트 오류 **9건**을 발견했으며 전체 검증 통과로 표현하지 않는다. `core-generic-conversion-wasm` 1건과 `core-label-gesture-wasm` 3건은 고정된 schema10 oracle에 작업 전부터 schema13인 공통 seed를 전달하는 오류다. 작업 전 seed로 직접 재현한 `baseline-oracle-failure.json`을 남겼다. `territorial-command-storage` 5건은 누락된 `propertyEditingA.distributionLayerById` 포트와 이미 제거된 `createCountryFeature` API 호출이다. 해당 두 구현 파일과 세 테스트 파일이 작업 전 상태와 동일함을 `baseline-test-ownership.json`으로 확인했다. 현재 작업에 따른 표시 분리 실패 4건은 실제 shared viewing owner와 현재 계약으로 수정한 뒤 통과했으며, 고정 oracle·별도 객체 삭제 UI 테스트의 기존 정비는 이번 범위에서 확장하지 않았다. 원본 실패는 `viewing-helper-consumers.log`에 보존했다.

Windows는 고정 경로 `apps/web-shell/src-tauri/target/x86_64-pc-windows-gnu/debug/pandolab-web-shell.exe`로 full-world debug/no-bundle 빌드를 완료했다. 실제 네이티브 프로세스의 WebView가 canonical-ready에 도달했고 원본 국가 258·현재 객체 254·최상위 일반 객체 207을 확인했다. 이 검사는 renderer·mesh·geometry·Worker·오프라인 요청 차단·공통 Core를 포함하며 생성 창의 모든 네이티브 파일 선택기 조작을 수동 검증했다는 뜻은 아니다. 생성·취소·기간·재열기 상호작용 증거는 브라우저 검사로 구분한다.

최종 읽기 전용 검토에서 이전 자동저장 때문에 생성이 막히는 문제와 내장 객체 숨김 상태가 pruning으로 사라지는 문제를 수정했다. 재검토에 Critical/Important 지적은 없었으며 검토자가 관련 unit 15개를 별도 통과시켰다. 이 검토는 Windows/브라우저 실행 증명을 대신하지 않는다.

포장한 Core source SHA는 `18b9265509c33f107e0915cd5830cd54387c8ae07df3374a15d15cc958b338fb`, WASM SHA는 `6e480812333ddf9c2d4fac7794b92b5dbd1febd2a17e82f6639ea15834e9ee87`이다. Windows 실행 보고서의 embedded build도 같은 source SHA를 기록한다. 바이너리 WASM·생성 gzip은 별도 해시 기록 대상이며 텍스트 변경 목록만으로 전체 산출물을 나타내지 않는다.

`windows-stage-parity.json`에서 변경된 앱 공통 자산 25개의 원본/포장본 일치와 생성 전용 HTML을 확인했다. 제품별 생성 메타데이터와 앱에서 실행하지 않는 viewer composition은 이 바이트 비교에서 제외했다. 마지막 웹 전용 파일 열기 실패 표시 수정은 Windows 빌드 뒤에 적용했으므로, 실행 파일에 들어 있는 사용하지 않는 viewer composition 사본까지 현재 웹 소스와 동일하다고 주장하지 않는다. 앱에서 사용하는 공통 Core·프로젝트 생성·저장·보기 소스는 비교 범위에 포함했다.

역사 지도 데이터는 형상·객체·기록·속성 변경 없이 컨테이너와 시작 설정만 갱신했다. `historical-content-parity.json`의 authored content 비교가 동일하며, 비교 SHA는 `d8b3799a1fe94ca5fca8a28eb7983710efd0994be8478f98d48aab44a564c4b0`이다. 독립 역사 형상이나 화면 오차 검증을 수행했다는 뜻은 아니다.

## 한계와 판본

기존 개발 파일·자동저장 호환 및 마이그레이션은 제공하지 않는다. Android 방향·키보드·폴더블 등 실기기 동작은 이 보고서로 확인되지 않는다. 이번 작업에서는 커밋·푸시·main 통합·Pages 게시·휴대용 번들 생성을 하지 않았다.

[이전 제품 정리 보고서](product-pruning-2026-10-19.md)의 schema13·별도 프로젝트 설정 유지 내용은 당시 기록이다. 생성·초기 상태 저장 계약은 이 보고서와 [현재 기술 계약](../../../docs/architecture/versioning-migrations-exchange.md)이 대체한다. 분포도에 대해서는 중간 계획의 저장 제외안을 적용하지 않았다.
