# Shared Core command boundary

현재 문서·검증·명령·이력의 소유자는 `shared/core`의 `DocumentSession`과
`Project`다. 웹과 앱은 전용 Worker의 WASM으로 같은 C++ 소스를 실행한다. 이전 JavaScript pipeline과 transaction runner는 제거했다.
이번 이전의 기준은 현재 웹 동작이며, 원본 `9300609` 검증 자료는 별도로 보존한다.

## 입력과 조회

UI는 기존 object adapter, 기능 서비스, 편집 workflow에서 입력을 수집한다.
웹 `ProjectDomain`은 application 명령을 순서대로 처리하고 Core에 전달한다.
앱은 `apps/editor`의 웹 입력·Worker 경로와 플랫폼 저장 어댑터를 사용한다.
서비스·UI·렌더러는 문서, revision, 이력 또는 dirty를 직접 수정하지 않는다.

`TerritorialEntityStore`와 Repository는 승인된 읽기 모델과 현재 월의
`ResolvedWorld`를 조회한다. 객체 ID, source ID, FID와 표시 ID는 명시적인
변환 경계에서 구분한다. 카메라·입력·DOM·파일 접근과 GPU 자원은 플랫폼
소유자가 계속 관리한다.

## 변경과 확정

Core가 검증과 후보 상태를 만들고, 최종 후보를 검증한 뒤 하나의 이력 단위로
확정한다. no-op, 잠금, 잘못된 참조, 실패 및 취소는 각 기능의 현재 계약을 따른다.
프로젝트 이력과 geometry 초안 이력은 서로 별개다.

geometry 계산은 기존 JavaScript/WASM 계산 모듈을 사용한다. 계산 결과는
Core 후보로 준비하며 미리보기는 승인 전까지 문서와 이력을 바꾸지 않는다.
문서·월·프로젝트·자료가 바뀐 결과는 폐기한다. 관련 없는 표시 변경은 준비된
후보를 Core에서 재기반하며, 확정 결과에도 현재 표시 상태를 보존한다.

웹 명령의 `applyAccepted`는 해당 작업의 renderer/Worker commit 경계다.
이 경계가 실패하면 같은 Core capsule로 문서·이력·선택·초안을 복원하고
성공 알림과 자동저장을 게시하지 않는다. 정상 확정 이후의 일반 알림·렌더
무효화·자동저장 예약은 기존 소유자에게 전달하며, 알림 실패는 진단으로 보존한다.

## 저장과 자료

저장·자동저장은 `ProjectDomain`이 Core에서 받은 프로젝트와 checkpoint를
사용한다. 앞서 시작한 application 변경의 확정 또는 복원을 기다린 뒤
내보내므로 실패한 platform commit의 중간 상태를 저장하지 않는다.
파일 codec의 형식은 플랫폼별로 유지하고 브라우저/파일 I/O는
기존 어댑터에서 실행한다. 늦은 저장 응답이 새 프로젝트를 saved로 바꿀 수 없다.
자동저장은 명시적인 파일 저장의 dirty checkpoint를 지우지 않는다.

저장된 delta는 검증된 baseline 핸들을 사용한다. 저장 자료의 검증과 미리보기
조회는 `prepareImport`/`inspectImport`로 수행하며 활성 문서를 교체하지 않는다.
GIS 내보내기도 같은 Core file snapshot의 공간 조회 결과를 사용한다.

builtin place/hydro ID와 자료 출처는 기존 로더가 사실을 공급하고 Core catalog에
승인받는다. 렌더러가 hidden-source map을 수정하지 않는다. 캐시의 해석과
파일의 해시·재시도·취소·수명은 해당 자료 소유자와 연결 지점에서 관리한다.

## 검증 범위

명령·읽기 모델·이력·취소·저장 계약은 작은 original Web/native/WASM fixture로
비교한다. `check-command-architecture`는 폐기한 owner의 부활과 별도 쓰기 경로를,
`check-runtime-boundaries`는 실제 capability 연결과 의존 방향을 검사한다.
같은 소스·컴파일러·ABI의 JS/WASM 쌍을 manifest 해시로 확인한다.

현재 작업에서는 앱, BAT, 포터블, offscreen 및 실제 Qt/브라우저 UI를 실행하지
않는다. 실행하지 않은 사용자 화면과 시작 응답성은 통과로 표시하지 않는다.
검증 근거는 [DEV-066 보고서](https://github.com/kimjeon-il/PandoLab-library-data/blob/f4ae4d70579b8c799fba2e507e1a948b7e1e42c2/reports/development/testing/shared-core-startup-implementation-2026-10-12.md)에 기록한다.
