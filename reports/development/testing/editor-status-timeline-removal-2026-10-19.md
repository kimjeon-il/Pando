# 편집기 앱 작업표시줄의 시점 이동 제거

> 보고서 ID: `UI-EDITOR-STATUS-TIME-20261019` · 상태: `focused-verified / android-device-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-19  
> 조사 기준: `work/ui` / `44fb6d41977123b5220cde8078f1e9a7e38b2728` + 기존 미커밋 변경 및 이번 수정  
> 원본·출처: 공통 HTML 생성원, 앱 composition/presentation 소유자, `.superpowers/sdd/2026-10-19-editor-status-timeline/` 실행 기록

> 후속 변경: [UI-PRODUCT-PRUNING-20261019](product-pruning-2026-10-19.md)에서 시점 비교 유지 부분을 제거로 대체했다. 아래 검증은 당시 구현의 기록이다.

## 요청과 수정

앱 작업표시줄에서 전년·전월·직접 연월 입력·다음 달·다음 해 컨트롤을 제거했다. 앱 템플릿이 시점 이동 fragment를 포함하지 않으며 앱 composition도 해당 입력 이벤트를 등록하지 않는다. CSS로 숨기는 방식은 사용하지 않았다. 웹은 기존 공통 시점 이동 구현을 유지한다.

앱의 현재 편집 기준 시점 표시는 기존 작업 presentation 소유자가 실제 Core cursor에서 갱신한다. 프로젝트 교체 알림과 기존 앱 시점 변경 진입점의 성공 후 처리를 연결했다. 저장 상태와 기존 시점 비교는 유지한다. 비교 시작 버튼은 앱 템플릿에 두고 웹의 이동 fragment에서 분리했다. 비교 버튼의 클릭 영역을 유지하고, 제거된 모바일 이동 행의 CSS와 지도 도구용 예약 여백도 없앴다. 프로젝트 시작 설정, 시간 기록, 기간 편집과 Core의 시점 조회 기능은 변경하지 않았다.

제거된 앱 DOM을 사용하던 모델·저장·성능 회귀 테스트는 기존 editor-entry 테스트 경계에서 실제 시점 명령 소유자를 호출하도록 갱신했다. 제품에 테스트용 API를 추가하지 않았다. 시점 이동 UI 자체의 브라우저 검사는 웹 시작점으로 이동해 문서 비변경, 날짜 입력 오류와 모바일 접근 검사를 유지했다.

## 검증과 한계

- 앱 HTML에 이동 컨트롤이 없어야 한다는 검사 실패를 먼저 확인했다: `red.log`.
- 관련 HTML·자산·앱 staging 두 프로필·작업 presentation·시점 입력·editor 테스트 시작점·공통 CSS bundle 검사 **29/29 통과**: `focused-tests-final.log`. bundle 검사의 오래된 ‘뷰어에 dialogs.css 없음’ 기대값은 현재 공유 설정 대화상자 계약으로 맞췄고, 편집 폼 제외 검사는 유지했다.
- 변경한 production JS 5개와 관련 테스트 ESLint 통과: `lint-focused-final.log`. 기존 P9 helper의 브라우저 전역 `PerformanceObserver`, `addEventListener`는 해당 파일 검사에 명시했다: `lint-p9-browser-globals.log`. 기본 lint 실행의 기존 전역 인식 오류 3개는 `lint.log`에 보존했다. 관련 브라우저 소스 **29개 구문 검사 통과**: `browser-syntax-final.log`.
- 브라우저 **5개 시나리오의 최종 개별 결과 통과**. 웹의 월·연도 이동/문서 비변경, 직접 입력·오류·Enter/Done, 모바일 배치 3개는 `browser-final.log`에서 통과했다. 앱의 PC·640×360·844×390 작업표시줄/선택·시점 보존/기준 시점 갱신/비교 종료와 프로젝트 시작 설정·기원전 날짜·비교 2개는 `app-final.log`에서 **2/2 통과**했다. 전자의 통합 실행에서 실패했던 앱 기준 시점 갱신은 수정 뒤 후자의 실행으로 재검증했다. 처음 통합 실행 전체가 통과했다고 표현하지 않는다.
- Windows full-world 디버그 실행파일을 같은 고정 빌드 위치에 재빌드했다. 실제 WebView2 canonical 시작 검사 **12/12 통과**: `windows-build.log`, `windows-probe.log`, `windows-verified/world-windows.json`. 현재 앱 staging의 HTML에는 이동 컨트롤이 없고, 비교·편집 기준 시점은 존재하며, 변경한 JS 5개와 공통 CSS bundle은 소스와 바이트가 일치한다: `staging-ui-parity.json`. probe의 내장 Core 판본·자산 해시와 최종 staging HTML 해시도 확인했다: `windows-parity.json`. 네이티브 검사는 실제 앱 시작·자료·Worker·렌더러 준비 확인이며, 컨트롤과 입력 동작의 직접 검증은 앞서 명시한 앱 시작점 브라우저 검사다.

기존 미커밋 변경과 상설 워크트리를 보존했다. 작업 시작 확인에서 main과 작업 HEAD는 같았으며 원격 work/ui의 생성물 커밋 한 개는 겹치는 미완료 변경 위로 병합하지 않았다. 전체 테스트, Android 기기 실행, 커밋·푸시·main 통합·배포는 이번 검사에 포함하지 않았다. HTML/브라우저 검사를 네이티브 UI 직접 조작 검증으로 표현하지 않는다. 중간 실패와 중단 실행 기록은 보존하고 최종 판정은 위에 명시한 로그로 구분했다.
