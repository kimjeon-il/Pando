# 지도 화면 배율과 표시 준비 상태

> 보고서 ID: `UI-MAP-SCALE-20261020` · 상태: `focused-verified / native-webview2-verified / unpublished` · 지도 반영: `not-applicable` · 색인일: 2026-10-20  
> 원문 최종 수정: 2026-10-20  
> 조사 기준: Web·Windows App 공통 `work/ui`, 기준 커밋 `5973340ffceeccc8fd60c93221c8c57031866d38` 위 작업 변경  
> 근거: `.superpowers/sdd/map-scale-readiness-20261020/`의 실행 로그와 승인된 대화 계획

## 대상과 기준일

고배율 지형의 조작 중 품질 유지와 전환 속도 판단은 후속 [UI-TERRAIN-LATENCY-20261021](terrain-interaction-latency-2026-10-21.md)로 대체한다. 이 보고서의 기존 통과 결과는 상세 지형으로 전환되는 대기 시간까지 검증한 것이 아니다.

지도의 저배율·고배율 판정, 지형 준비, 프레임 표시 완료와 안내를 변경했다. 원본 GIS 형상·프로젝트 저장 형식은 변경하지 않았다. 원격 UI 커밋 11개를 fast-forward로 반영했고, 기존 native 권한 설명·portability fixture·다른 단위 테스트의 미완료 변경은 보존했다. main 통합·push·게시를 하지 않았다.

## 구현과 판정

- CSS px/라디안 기준 `S ≤ 504`는 저배율, `S ≥ 642`는 상세 표시 구간이다. 사이에서는 직전 구간을 유지하고 처음에는 상세를 선택한다. 화면 크기와 투영 변경을 반영하며 DPR·기기 종류·드래그·성능 등급으로 경계가 달라지지 않는다.
- 현재 startup preview는 원본 대비 오차·위상 검증 증명이 없으므로 정밀 자료 준비 이후 재사용하지 않는다. 저배율에서도 정밀 형상이 표시되는 것은 이 안전한 기본 동작이다. 새로운 단순화 GIS 자료나 0.5px 검증 완료를 주장하지 않는다.
- 지형의 목표 해상도는 기존 화면 투영 크기와 source DPR, 12% 여유로 선택한다. 목표 타일과 세계 기본 타일·필요한 tint의 업로드 완료를 판정하고, 원본 최고 해상도가 부족하면 제한을 표시한다. Canvas의 메모리 압박에 따른 목표 DEM 단계 하향을 제거했다.
- 준비 상태는 기존 renderer/terrain owner의 파생 정보이다. 프로젝트·형상 수정·그래픽 컨텍스트·목표 타일과 실제 프레임 표시 결과를 연결한다. 실패 종료와 준비 성공을 구분하며 숨긴 지형은 제외한다. 편집 가능 상태와 저장 상태는 별개이다.
- Canvas는 요청한 DEM/tint가 없는데 raster만으로 완료 처리하지 않으며, 최종 실패 후에도 새 프레임을 요청해 실패·재시도 안내를 갱신한다. 기존 상태 표시에서 단계와 재시도를 제공하고 이동마다 완료 알림을 띄우지 않는다.

## 근거와 방법

단위 검증은 배율 문턱·전환 구간·보호 객체·지형 요청/해석/업로드/캐시/실패/컨텍스트 복구·실제 Canvas Worker 프레임·선택 표시 인계에 집중했다. `red-*.log`와 후속 green 로그로 변경 전 실패와 수정 후 통과를 기록했다. 별도 읽기 전용 코드 검토에서 발견한 DEM 대기·실패 안내 문제를 수정했다.

브라우저 검증은 현재 Core/GeoPackage writer로 만든 프로젝트를 실제 파일 열기 진입점에서 불러온 뒤 수행한다. PC 1440×900, 모바일 390×844, WebGL과 Canvas Worker의 배율 왕복, 드래그 중 정밀 형상 유지, 모델 형상 불변과 숨긴 지형 제외를 확인한다. 전체 세계의 모든 형상·최고 배율 품질이나 실제 휴대전화 검증을 뜻하지 않는다.

Windows App은 같은 소스로 별도 GNU debug 빌드하고 WebView2에서 확인한다. 편집기 제품은 지형 레이어가 없으므로 앱에서는 경계·배율·프레임 완료·상태 표시를 검증한다. 내장 small-project 자료를 사용하며, App에서 지형 타일 흐름을 검증했다고 보고하지 않는다. 사용자 프로필은 보존하고 별도 `WEBVIEW2_USER_DATA_FOLDER`를 사용한다. 이 환경 변수의 우선순위는 [Microsoft 공식 API 문서](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl)의 계약을 확인했다.

## 확인 결과와 한계

- 집중 단위 검증 65개 통과(`focused-final.log`). Canvas 실패 안내 후속 검증 9개도 통과했다(`canvas-failure-publication.log`, 위 65개와 중복이므로 합산하지 않음).
- 변경 JavaScript와 테스트의 ESLint가 통과했다(`lint-final.log`, `lint-entry.log`).
- 공유 C++ prerequisite와 생성 metadata 확인은 통과했다. C++/WASM 소스는 변경하지 않았다.
- UI architecture 검사는 수정하지 않은 `components/map-search.css`의 `top/left` 기본값 `0px` 두 항목 때문에 실패했다. 이번 지도 변경의 통과 결과에 합산하지 않는다.
- Web의 PC WebGL·모바일 WebGL·PC Canvas Worker 세 시나리오가 모두 통과했다(`browser-no-trace.log`, 3 passed/1.1분). 실제 파일 열기, 700→570→500→570→700 CSS 배율 왕복, 정밀 형상 유지, 드래그 중 형상 불변과 지형 숨김 후 완료를 검사했다. 앞선 trace 기록을 켠 모바일 실행은 시간 초과했다. 같은 동작의 별도 무추적 probe와 최종 무추적 실행을 구분해 보존했고, 무추적 통과를 trace 실행 통과로 보고하지 않는다.
- 기존 선택 국가의 채움·외곽선 검사를 새 계약에 맞춰 갱신했고, 실제 DEU 선택·배율 이동에서 동일한 정밀 리소스와 형상·선택 강조 유지를 확인했다(`browser-selection.log`, 1 passed/57.1초).
- Windows GNU debug 최종 빌드 완료(`native-build-entry-fix.log`, 1분59초). 기존 `storage.rs`의 `unused_mut` 경고 1건은 남겼다.
- Native 검사에서 small-project 시작 코드의 `productMode: 'editor'` 누락을 재현했다. `The application entry requires editor product mode.` 오류의 원인이며 해당 호출을 수정했다. 기존 실제 CSP preflight가 수정 전 실패·수정 후 통과했다(`red-native-entry.log`, `green-native-entry.log`).
- 실제 Windows WebView2에서 PC·모바일 크기 각각 다섯 배율, 준비 완료·정밀 형상 유지·상태 표시와 실행 중인 JS 세 모듈의 원본 바이트 해시 일치를 확인했다(`native-validation.log`, `native-result.json`). 별도 프로필 경로는 WebView 실행 명령에서도 확인했다. EXE SHA-256은 `EDDB48DB60109B3FC88E0DDF7977E19B6238BFC535DD0FBBB0DDC04C4CE76CED`이다.
- Android 실제 기기·실사용자 사용성 검증·배포 검증은 수행하지 않았다.

## 데이터 반영과 판본

지도 데이터 반영은 `not-applicable`이다. 표시용 단순화의 원본 대비 0.5px 검증과 독립 역사 자료에 대한 정확도 검증을 혼동하지 않는다. 이 보고서는 이번 변경의 로컬 검증 기록이며, 이전 배포나 전체 원격 CI의 성공을 보증하지 않는다.

## 후속 배포 작업

2026-10-20 사용자가 UI 검사 잔여 실패 수정, main 통합·웹 배포·앱 실행 파일 갱신을 승인했다. 검색창 CSS의 `top/left` 기본값을 동등한 `0`으로 바꾼 뒤 UI architecture 검사가 통과했다. 집중 단위 검사 65개와 지도·검색 브라우저 검사 7개도 재실행해 통과했다. 이 절은 위 로컬 검증 당시의 미게시 상태와 구분하며, 실제 배포 결과는 [통합·게시 후속 보고서](map-scale-release-2026-10-20.md)에 기록한다. 근거는 `.superpowers/sdd/map-scale-release-20261020/`이다.
