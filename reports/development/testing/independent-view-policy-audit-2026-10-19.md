# 웹·앱 독자 규칙 추가 조사

> 보고서 ID: `UI-POLICY-AUDIT-20261019` · 상태: `audit-complete / issues-open` · 지도 반영: `not-applicable` · 색인일: 2026-10-19
> 원문 최종 수정: 2026-10-19
> 조사 기준: 배포 제품 소스 `83dfdf70f40effa48634dfed566ed6dbba1ae1f7`, UI 문서 보완 `cdd7c51e04934162c8f3ed6a4b87327b17fffe35`
> 원본·출처: 해당 커밋의 제품 조립부·공통 소유자·실제 브라우저 호출 관찰

## 대상과 방법

사용자의 추가 조사 요청에 따라 공통 모듈의 import 여부뿐 아니라 제품별 포트, 기본값, 후속 갱신, 세대·revision, 오류 처리를 비교했다. 앱과 웹은 같은 제품 소스에서 비교했다. 상설 UI 워크트리의 별도 Core/WASM·프로젝트 설정·시점 비교 작업을 조사 결과에 섞지 않았다.

실행 검증은 기존 검증용 export의 제품 소스와 기준 WASM에서 수행했다. 1440×900의 독립 브라우저 페이지에서 실제 공통 설정 소유자의 메서드를 호출하고 내부 상태·호출·렌더 도메인을 관찰했다. 추가 검사에서는 실제 다음 달 버튼을 눌러 작업 완료를 기다렸다. 알고리즘을 대역으로 바꾸지 않았으며 계측은 소스 응답에 관찰 코드만 삽입했다. 일반 설정의 포인터·키보드 조작 전체나 픽셀 동등성 검사로 확대 해석하지 않는다.

원시 증거는 `.superpowers/sdd/extra-rule-audit-20261019/`의 `runtime-initial.json`, `runtime.json`, `runtime.log`, `runtime-final.log`, `extra-rule-audit.spec.mjs`에 보존한다. 브라우저 관찰 검사 최초 1/1 및 추가 범위 1/1 통과는 **차이를 관찰하는 검사가 완료됐다는 뜻**이며, 제품 결함이 수정됐다는 뜻이 아니다.

## 추가로 확인한 8개 항목

| ID / 우선순위 | 차이와 근거 | 확인 수준 |
| --- | --- | --- |
| R1 / P1 선택 설정 전달 | 웹 `viewer-map.js:301`은 상태와 물리 스타일만 갱신한다. 앱 `app-environment.js:78` → `render-quality.js:50`은 렌더러의 `setInteractionStyle`까지 호출한다. 선택 색 `#ff0088`, 윤곽선 끔, 채움 강도 `0.8` 적용 뒤 웹 렌더러는 `#cda95d / true / 0.35`를 유지했다. 앱은 세 값 모두 새 설정과 일치했다. 웹 setter 호출 0회, 앱 1회였다. | 실제 공통 렌더러 내부 값과 호출로 재현. 최종 선택 픽셀 비교는 미실행. |
| R2 / P1 선택 전용 패스 | 앱 `map-workspace-host.js:251`에서 선택 패스를 생성·등록하고 `app-domain-assembly.js:1019`로 전달한다. 웹은 `GpuScene.initializeSelectionPass`로 null을 만들고 패스를 설치하거나 `selectionResources`에 전달하지 않는다. 공통 `rendering-domain.js:694,795`가 패스 유무로 다른 경로를 고른다. 즉 같은 렌더러를 사용한다는 사실만으로 선택·호버 경계 처리 경로가 같지 않다. | 연결 누락과 분기 소스 확인. WebGL 최종 선택·하위 경계 화면의 차이는 별도 검증 필요. |
| R3 / P2 경위선 | 앱은 `app-domain-assembly.js:998`에서 `baseResources`를 연결한다. 웹 `createRenderingDomain` 호출에는 이 자원이 없다. `map-content-presentation.js:537`은 graticule이 없으면 종료한다. 실제 앱 scene에는 `base-graticule`이 있고 웹에는 없었다. | 실제 scene 도메인 차이 재현. 지구본 SVG shell 연결 차이도 있으나 그 자체의 픽셀 영향은 별도 미검증. |
| R4 / P2 슬라이더 진행률 | 웹 `viewer-composition.js:113`은 `--range-progress`에 값을 쓰고, 앱의 공통 `PhysicalSettings.syncRangeProgress`는 CSS가 실제 읽는 `--ui-range-progress`를 쓴다. 25%에서 웹은 공통 변수 빈 값 / 독자 변수 `25%`, 앱은 공통 변수 `25%`였다. 공통 함수의 min/max 정규화도 웹 인라인 구현에 없다. | 실제 DOM 스타일 값으로 재현. CSS 소비 변수도 확인. |
| R5 / P2 지형 끄기 의미 | 앱의 `SetTerrainPresentation`은 `none`에서 기존 terrainStyle을 보존한다(`shared/core/src/presentationcommands.cpp:104`). 웹 `viewer-map.js:285`는 `none`도 `political`로 바꾼다. 실제 `physical → none`에서 앱은 `physical`, 웹은 `political`이 남았다. | 정상 제공되는 설정 값으로 상태 차이 재현. 끈 상태 자체가 서로 다르게 보인다는 주장은 하지 않음. |
| R6 / P2 재계산·갱신 정책 | 웹의 월 이동은 언제나 `map.update` → `prepareCanonicalMesh`로 이어진다(`viewer-composition.js:78`, `viewer-map.js:230`). 앱은 바뀐 객체의 상위 형상을 비교하고 재색인한다(`app-domain-assembly.js:1142`). 실제 내장 지도 `2026-10 → 2026-11`에서 웹의 mesh 준비 호출은 1→2회, 앱은 1→1회였다. 환경설정 변경도 웹은 `invalidateProject('document-presentation')`, 앱은 선택 스타일·base scene 갱신 경로였다. 웹의 `updateGeneration`은 지형 revision 포트에도 쓰인다. | 추가 mesh 준비 호출과 제품 갱신 호출 차이를 재현. 실제 Worker 재전송량·FPS·지연 개선율은 측정하지 않음. |
| R7 / P2 크기·DPR 처리 | 웹 `viewer-map.js:273`은 자체 ResizeObserver를 설치한다. 앱은 `app-progressive-startup.js:281` → 공통 `MapHost.startMapResizeObserver`의 프레임 병합·signature 검사·DPR watcher를 사용한다. 실제 공통 host/observer는 앱에 생성되고 웹에는 없었다. 웹에도 자체 observer와 renderer DPR 계산은 있으므로 크기 변경이나 DPR 지원이 전혀 없다고 표현해서는 안 된다. | host/observer 차이는 실행 확인, DPR watcher 경로 차이는 소스 확인. 실제 모니터 이동·OS 배율 변경은 미실행. probe의 `dprQuery:null`은 공개 getter가 없어 생긴 값이므로 watcher 유무 증거로 사용하지 않음. |
| R8 / P2 복구 진단 처리 | 공통 경계·선택 렌더러는 이전 프레임을 유지한 실패를 `result:'recovered'` 진단으로 보낸다(`map-content-presentation.js:468`, `rendering-domain.js:980`). 앱은 진단 기록에 남긴다(`app-domain-assembly.js:1126`). 웹은 `viewer-map.js:226`에서 모든 진단을 Error로 바꿔 일반 작업 오류 처리로 보낸다. 오류 분류·노출 정책이 별도다. | 소스상 처리 경로 확인. 이번 검사에서 Worker 실패를 주입하거나 실제 토스트 차이를 재현하지는 않음. |

R1·R3·R4·R5·R6은 이번 브라우저 관찰에서 실제 차이를 확인했다. R2·R7·R8은 연결·분기 차이가 확인됐지만 표에 명시한 화면·기기·실패 상황 검증은 남는다. 위 항목을 모두 같은 수준의 재현된 시각 결함으로 집계하지 않는다.

## 별도로 남은 중복과 후보

- 웹 `viewer-composition.js:114`는 이미 존재하는 `PhysicalSettings.syncPhysicalControls`를 다시 구현한다. 현재 제공되는 세 지형 모드에서는 같은 결과였으며 추가 결함으로 세지 않는다.
- 웹은 `createRingHitTester(ring => ring)`을 사용하고 앱의 `LandRelations`는 실제 `ensureClosedRing`을 주입한다. 정규화 경계가 다르다. 현재 형식의 정상적인 닫힌 ring에서 오선택을 재현하지 않았으므로 R1~R8의 제품 결함 수에 넣지 않았다. 미지원 프로젝트나 비정규 입력을 허용해야 한다는 뜻도 아니다.
- 이전 보고서에서 기록한 시작 preview 경로 차이는 여전히 남는다. 이번에 새로 발견한 것으로 세지 않는다.
- 제품별 resource key의 단순 차이는 결함 수에 넣지 않았다. 편집 초안·병합 도구·저장·자동저장·편집기 출력 자원은 허용된 제품 역할 차이이며, 쓰이지 않는 추가 포트도 실제 동작 차이로 세지 않았다.

## 이전 검증이 놓친 범위

이전 비교는 같은 GPKG의 일반 영토·하위 경계·분포·일반 객체 패킷, 외곽선 변환, 호버 이름·깃발에 집중했다. `base-graticule`을 비교하지 않았고 선택 전용 패스, 환경설정의 렌더러 전달, 슬라이더 CSS 변수, 지형 끄기 전후 상태, 월 이동의 mesh 준비 횟수를 검사하지 않았다. 공통 모듈을 사용한다는 설명을 이 경로들까지 공유한다는 뜻으로 확대할 수 없다.

## 수정 방향과 범위

우선 R1·R2의 실제 선택 스타일 전달·패스 등록을 기존 공통 소유자에 연결해야 한다. 이어 base 자원·슬라이더·지형 설정 의미를 공유하고, 월·환경설정 변경과 resize·진단 처리의 제품별 우회를 제거해야 한다. 앱 조립부의 실제 공통 resource 구성을 웹에도 재사용해야 하며, 빠진 포트를 하나씩 덧붙이는 것만으로 전체 공유가 완료됐다고 판단해서는 안 된다.

웹의 열람 상태와 앱의 문서 저장 상태를 구분하는 경계는 유지하되, 그 경계가 값 해석·정규화·후속 갱신 정책까지 독립 구현하는 근거가 되어서는 안 된다.

## 반영 및 미검증

이번 요청의 산출물은 추가 조사와 보고서다. 제품 코드 수정·새 배포는 수행하지 않았다. 공개 제품 SHA는 기준 커밋 그대로다. 전체 테스트, Windows·Android 네이티브 실행, WebGL 픽셀 비교, 실제 배율 변경, 실패 주입, 정량 성능 검사는 실행하지 않았다. 기존 미커밋 작업과 파일은 보존했다.

## 판본

[호버·경계 재점검 보고서](shared-map-rule-parity-2026-10-19.md)의 후속 조사다. 이전 수정의 개별 통과 결과는 유지하되, 공유 범위에 관한 해석은 이 보고서의 추가 누락과 함께 보아야 한다.
