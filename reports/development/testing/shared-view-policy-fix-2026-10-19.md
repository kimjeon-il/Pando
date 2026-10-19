# 웹·앱 공통 열람 규칙 연결 수정

> 보고서 ID: `UI-POLICY-FIX-20261019` · 상태: `focused-verified / release-pending` · 지도 반영: `not-applicable` · 색인일: 2026-10-19
> 원문 최종 수정: 2026-10-19
> 조사 기준: 제품 `83dfdf70f40effa48634dfed566ed6dbba1ae1f7`, 작업 기준 `0bb54fa7207ce06975d6b8d0474ebcc617542ff9`, 제품 수정 `5a07e8b276a4284114990eddee0d08ef6e85b80e`
> 근거: [추가 조사](independent-view-policy-audit-2026-10-19.md), 실제 공통 소유자와 Core/WASM, 관련 회귀 검사

## 수정 범위

추가 조사에서 확인한 R1~R8을 수정한다. 상설 UI 워크트리의 기존 Core/WASM·프로젝트 설정·시점 비교·편집 작업은 보존하고 이 배포에 섞지 않는다. GIS 자료와 C++ 엔진은 변경하지 않는다.

| 항목 | 수정한 실제 소유자와 제거한 경로 |
| --- | --- |
| R1 선택 환경설정 | 앱의 선택 스타일·palette·물리 스타일·base 갱신 절차를 `RenderQuality.applyMapAppearanceChange`로 옮겼다. 앱과 웹이 이 메서드를 사용하고 웹의 독자적인 전체 프로젝트 갱신을 제거했다. 선택 스타일은 `PreferencePresentation`의 값을 읽는다. |
| R2 선택 패스 | `MapHost.attachMapOutput`이 host와 선택 패스를 생성·등록한다. 앱의 기존 생성 코드를 이 메서드로 옮기고 웹도 같은 메서드·패스·렌더러를 사용한다. 웹의 `selectionResources`에 실제 패스를 연결했다. |
| R3 경위선 | 웹에도 공통 base 렌더러에 실제 projection graticule과 공통 geometry builder를 연결했다. 별도 경위선 알고리즘은 만들지 않았다. |
| R4 슬라이더·보기 후속 처리 | 웹의 `--range-progress` 인라인 함수와 지형 라디오 동기화 중복을 제거했다. 실제 `PhysicalSettings` 함수를 사용한다. `MapSettings`의 제품별 조기 반환 네 곳을 제거하고 동일한 표시·검색·palette·캐시 갱신 절차를 수행한다. 저장 대상만 문서 명령과 열람 상태로 나눈다. |
| R5 지형 끄기 | `PhysicalSettings.terrainModeSettings`가 UI의 세 모드를 해석한다. 앱과 웹이 같은 결과를 만들며 끌 때 기존 방식을 보존한다. 웹의 독자 `setTerrain`을 제거했다. 읽기 전용 상태 반영은 기존 `ProjectSession`이 맡는다. |
| R6 형상·월 이동 | `TerritorialEntityStore`가 이전/현재의 accepted world에 있는 형상 ID·버전과 상위 역할 변경을 비교한다. 문서 교체 ACK는 별도 경계로 처리해 다른 archive의 같은 ID·버전과 혼동하지 않는다. 앱의 별도 root 판정 코드를 제거했다. 웹은 이 변경 신호가 있을 때만 mesh를 준비하고 실제 country/territorial revision을 사용한다. 열기·복구는 새 렌더 세대에 맞게 준비하며 실패한 준비는 재시도할 수 있다. |
| R7 resize·배율 | 웹의 자체 ResizeObserver를 제거했다. 공통 `MapHost`의 host 등록·프레임 병합·signature 검사·DPR watcher와 종료 처리를 사용한다. 편집기 HUD 출력만 제품 모드로 구분한다. |
| R8 복구 진단 | 웹의 모든 렌더 진단을 일반 작업 오류로 바꾸던 처리를 제거했다. 기존 `createDiagnosticLog`에 기술 원인을 기록한다. 사용자 작업 실패는 기존 작업 오류 경계를 유지한다. |

웹 초기 프레임이 문서 열기보다 먼저 준비될 수 있으므로 선택·프로젝트 포트는 이미 생성된 단일 DocumentSession을 읽도록 했다. 임시 `session`을 읽다 실패하던 연결을 제거했다. 라벨의 시점 snapshot과 라벨 갱신도 실제 MapHost/RenderingDomain으로 연결한다. 공통 resize의 `workspaceUiB`는 실제 WorkspaceSurfaces에 연결하고 visualViewport 리스너는 시작·종료 시 중복되지 않게 등록·해제한다. 수명 종료 시 host·관찰자·렌더러를 해제한다. 지명 소유자에도 renderingDomain을 초기 null 값으로 복사하지 않고 getter로 연결하며, 내장 지명 발행 오류가 발생하면 브라우저 회귀 검사가 실패한다.

## 검증 방법과 수정 전 실패

`shared-view-policy.spec.mjs`에서 웹·앱의 실제 공통 메서드와 렌더 내부 값을 관찰한다. 알고리즘 대역 없이 선택 설정·패스·경위선·25% 슬라이더·지형 끄기·다음 달 버튼·공통 host/observer·복구 진단의 동작을 검사한다. 수정 전 웹에서 8건의 실패를 확인했다.

형상 ID·버전이 같은데 메모리 객체만 달라진 경우를 별도 단위 검사로 추가하고 수정 전 실패를 확인했다. 별도 리뷰가 재현한 archive 간 ID 충돌과 visualViewport 종료 후 콜백 잔존도 회귀 검사에 넣었다. 현재 Core의 accepted geometry version을 사용하며 좌표 전체를 반복 직렬화하는 비교는 추가하지 않았다.

기존 Store 검사 5건은 수정 전 소스에서도 `GEOMETRY_OUTSIDE_PARENT`로 실패했다. 서로 떨어진 root에 자식을 이동하거나 부모만 이동하면서 자식을 옛 위치에 두는 합성 fixture였다. 부모가 포함하는 영역과 함께 이동하는 자식 형상을 명시해 현재 계약에 맞췄다. 잘못된 부모·순환·원자성·Undo/Redo·전체 archive 검증은 유지한다. 실제 지도 자료는 변경하지 않았다.

## 조사 해석 정정 및 추가 리뷰

이전 R6의 내장 지도 `2026-10 → 2026-11`은 존속기간 때문에 실제 객체 집합이 달라질 수 있다. 준비 호출 횟수 차이는 당시 관찰이지만, 그 관찰만으로 불필요한 재계산을 입증했다는 해석은 정정한다. 최종 검사는 모든 객체의 기간을 제한하지 않은 현재 형식 GPKG를 실제로 열고 다음 달 버튼을 눌러 형상이 유지되는 조건에서 준비 횟수를 비교한다.

별도 읽기 전용 리뷰가 재현한 resize 의존성 누락·문서 간 형상 ID 충돌·viewport 리스너 잔존은 모두 수정했고 리뷰 측 재현 검사도 통과했다. 숨긴 master layer에서 호버 강조가 남는 현상도 관찰했으나 공통 코드의 기존 `objectRefVisible` 규칙이며 이번 수정의 제품별 독자 규칙이나 새 회귀로 집계하지 않는다. 별도 기존 정책 위험으로 남긴다.

## 실행 결과

- 설정·포트·제품 자산·앱 UI 경계 검사 48/48 통과.
- 소유자·ACK·열람 불변·Store 검사 22/22 통과. 형상 버전 회귀 추가 후 관련 15/15 통과. 중복 실행 수를 별개 검사 수로 합산하지 않는다.
- 리뷰 후 Store·열람 불변·MapHost·신규 회귀 검사 20/20 통과. 변경 파일 ESLint 통과.
- 앱 계층·속성·깃발·Undo/Redo 및 웹의 실제 GPKG 열기·손상·취소·연속 요청 검사 통과.
- 라벨 paint 순서·centroid 재사용, 세로·태블릿·가로 레이아웃 검사 통과. 설정 preview·취소·저장·새로고침·휴대폰 640×360 검사 통과. 새로고침 뒤 HTML 버튼 존재만 기다리던 검사는 실제 지도 준비 완료를 기다리도록 수정했다.
- SwiftShader `webgl2`의 웹·앱 통합 규칙 검사 통과. 두 제품 모두 호버 선분 256개, drawSucceeded=true, 같은 형상의 2026-10→11 이동 mesh 준비 2→2, DPR+크기 변경 후 layout DPR=2, pageerror 및 console error 0개였다.
- 제품별 staging·dependency closure·보기 ACK 검사 15/15 통과. 앱 staging은 두 프로필의 합성 fixture 계약 검사이며 실제 배포 앱 패키지를 재빌드했다는 뜻이 아니다.
- 기본 선택 렌더러(webgl2)에서도 웹·앱 통합 검사 통과. 강제 `canvas` 경로(실제 canvas-worker)도 웹·앱 통과했으며 pageerror·console error가 없었다. Canvas 결과를 WebGL draw 성공으로 집계하지 않는다. 중간 검사에서 초기화 순서의 null 참조와 내장 지명 발행 오류를 발견해 수정했으며 그 실패를 통과로 집계하지 않는다.

원시 로그와 관찰 JSON은 `.superpowers/sdd/shared-view-policy-20261019/`에 둔다. 검증은 별도 export의 제품 수정본과 커밋된 기준 WASM에서 수행한다. 상설 UI의 별도 미완성 WASM으로 검증하지 않는다.

## 한계 및 배포

로컬 Windows 앱의 수동 조작 및 Android 실기기 회전·멀티윈도·모니터 이동은 수행하지 않았다. 제품 `5a07e8b2`의 Windows CI는 MSVC 빌드 후 실제 Tauri WebView 앱을 실행했으며 full-world·canonical mesh·모델 개수·오프라인 요청 12개 항목이 통과했다([run 39178426026](https://github.com/kimjeon-il/Pando/actions/runs/39178426026)). 이 검사는 모든 편집 흐름의 실기기 검증은 아니다. Chromium CDP의 DPR 단독 변경은 resolution media 이벤트를 발생시키지 않아 단독 OS 배율 변경 증거로 사용하지 않았다. 단위 검사에서 query 재등록·해제를, 브라우저에서 크기 변경 후 DPR 반영을 분리한다. 브라우저 DPR 에뮬레이션과 SwiftShader는 이 항목의 대체 증거가 아니다. FPS·메모리·지연 감소율도 측정하지 않았다. 초기 preview 시작 경로 차이는 기존 보고서의 제한대로 남으며 전체 저장소의 모든 동작이 동일하다고 주장하지 않는다.

제품 수정 커밋 `5a07e8b276a4284114990eddee0d08ef6e85b80e`를 push하고 main에 fast-forward했다. Pages [39178625484](https://github.com/kimjeon-il/Pando/actions/runs/39178625484)가 성공했다. 최초 로컬·CI staging 2,237개 파일 / 431,919,668 bytes의 path·blob·bytes·SHA-256이 모두 일치했다. 공개 파일 23개가 HTTP 200·커밋 해시 일치, 편집 전용 경로 5개가 404였으며 실제 포인터의 알제리 이름·깃발 및 공개 프로젝트 열기·월 이동·설정·크기 검사도 통과했다.

후속 CI에서 낮은 기기 자원의 초기 품질 적용이 resize를 동기 요청해 미초기화된 `mapResizeReasons.add`에 접근하는 시작 회귀가 확인됐다. `deviceMemory=2`, `hardwareConcurrency=2`에서 재현했고 host 상태를 렌더러 생성 전에 초기화하도록 수정했다. 저사양 회귀는 오류 없이 시작·문서 로드·Canvas accepted frame 표시가 통과했고 일반 웹·앱 통합 검사도 통과했다. 별도 빌드 ID `20261019-shared-policy.2`로 후속 게시한다.

P2의 build-metadata 산출물 계약에는 생성되는 앱 HTML이 누락돼 있었다. 실제 output contract로 viewer/editor HTML을 stage·publish하는 실패 회귀를 추가하고 앱 HTML을 정확한 허용 출력에 넣었다. 분포 렌더 행·현재 GPKG 읽기의 두 읽기 함수만 storage audit에 분류하고 쓰기 허용은 추가하지 않았다. Core Undo 검사는 시간 이동 후 저장되는 `editorState.lastViewedMonth`를 기대값에 포함하며 나머지 archive 전체 동등성을 유지한다. 관련 검사 32/32 통과.

## 전체 CI의 기존 실패와 구분

전체 Application Architecture를 통과했다고 주장하지 않는다. `83dfdf70`과 `5a07e8b2`의 관련 구현·검사 blob이 동일한 다음 실패는 기존 범위로 분리해 남긴다.

| 항목 | 현재 확인 및 영향 |
| --- | --- |
| domain-split 검사 | 사용하지 않는 `createEditingPresentation` import로 lint 실패. 해당 topology·terrain·M4-M6 브라우저 검사는 실행 전 종료. |
| M3 검사 대역 | objectLookup의 필수 `isObjectAvailable` 누락. 실제 owner를 연결한 제품 검사는 별도 실행했다. |
| M2/M7 packet 재사용 | 동일 packet 재결합 때 fill/stroke mesh alias cache를 다시 준비하는 기존 결함. assertion을 약화하거나 이번 출력 연결 수정에 섞지 않았다. 별도 수정 필요. |
| source 위치 검사 | extraction 전 rendering-domain의 함수 위치를 찾는 기존 assertion. |
| viewer asset 분류 | 공통으로 쓰는 `app-accent`, `app-map-settings`도 모두 금지하는 기존 app-* blanket 분류. Pages 실제 closure 검사는 별개로 통과했다. |

이번 새 시작 회귀는 위 기존 실패로 분류하지 않고 직접 수정·재검증한다. 원시 CI 실패 로그·후속 상태·실행 범위는 `.superpowers/sdd/shared-view-policy-20261019/`에 보존한다.

## 판본

[독자 규칙 추가 조사](independent-view-policy-audit-2026-10-19.md)의 수정·검증 후속이다. 조사 당시의 재현 결과는 보존한다.
