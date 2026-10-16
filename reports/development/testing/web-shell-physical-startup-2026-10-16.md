# DEV-084 — 신규 WebView 전체 세계지도 물리 자료 로딩 경량화

> 검증 상태: `implementation-verified-linux-unit` · 지도 반영: `not-applicable` · 2026-10-16
> 대상: `work/integration-ui-objects-20261016` (F 단계 구현 `91f8fa1`, generated module map `0c1b37f`, CI 연결 `91b6380`)
> Qt 앱 수정·조사는 제외. 전용 Windows WebView/Android WebView의 정본 웹 UI 로딩 경계만 변경.

## 단계별 현황

**2-3D (물리·지명 데이터 패키징/활성화):**
기존 웹 소유의 DEM 래스터/수계/지명 로더를 앱에서도 사용한다.
현행 패키징 계획은 기본 세계·역사 자료 **597개**와 추가 물리·지명 자료
**13개**(지형 preview manifest와 타일 8개, 수계 manifest 및 packfile, 지명 manifest 및 packfile)를 포함한다.
파일 콘텐츠는 정본 manifest의 바이트 수·SHA-256로 검증한 뒤 앱에 복사한다.
별도 엔진·도형 데이터 중복 구현은 없다.
[Windows WebView 검증 38877295611](https://github.com/kimjeon-il/Pando/actions/runs/38877295611) 통과 및
[Android arm64 APK 빌드 38877295960](https://github.com/kimjeon-il/Pando/actions/runs/38877295960) 통과.
**개별 물리 레이어의 최종 픽셀 표현과 Android 실기기 로딩은 검증 범위에 포함되지 않았다.**

**2-3E (프로젝트/GIS 대형 파일):**
웹 메뉴는 공통 파일 컨트롤러를 유지하고, 네이티브 파일 교환은
`apps/web-shell/native-storage.js`와 Rust `document_transfer.rs`에서
**256KiB Base64 청크**로 스트리밍하며 최대 **256MiB** 문서 용량을 지원한다.
단일 전체 파일을 Base64 문자열로 한 번에 넘기지 않도록 임시 파일(spool)을 사용한다.
Windows의 Rust 저장·명령 계약 검증 및 Android APK **빌드**는 완료됐다.
실제 OS 파일 선택창에서 수십~수백 MiB 프로젝트를 열고 재저장하는 E2E 및 Android
문서 공급자별 이름 복원은 후속 실기기 검증 대상이다.

**2-3F (자원 로딩 경량화):**
기존 웹은 미리보기 표시 직후 지형 manifest를, 정본 메시 준비 시 수계 Worker를 시작한다.
전체 세계지도 Tauri 프로필에는 `deferPhysicalUntilReady: true`를 주입해
지형 및 수계 준비를 `pandolab:ready` **이후**의
`requestIdleCallback` (미지원 WebView는 0ms 예약)으로 넘긴다.
기본 브라우저와 소형 시험 앱의 로딩 순서는 유지한다. 국가·타임라인 자료는
지금처럼 정본 C++/WASM과 WebGL에서 먼저 준비한다.
지명은 기존 viewport 요청 기반으로 처리하며 임의로 전체 지명 파일을 메모리에 전개하지 않는다.

## 검증 결과 및 제한

- 이전 통합 전체 세계지도 Windows WebView, Rust 및 Android APK CI:
  38877295611, 38877295635, 38877295960 모두 `PASS`.
- 추가 물리 로딩 연기와 유휴 콜백/미지원 폴백 계약:
  `tests/unit/deferred-physical-startup.test.mjs` 3건 추가.
- 새 정본 모듈을 `index.html` 버전 고정 import map에 추가함.
  `91b6380` 변경으로 Linux 통합 계약 테스트
  [38879199833](https://github.com/kimjeon-il/Pando/actions/runs/38879199833) 성공.
- 이 시점에는 변경 후 Windows WebView CI
  [38879199695](https://github.com/kimjeon-il/Pando/actions/runs/38879199695) 결과 확인 중이다.
  따라서 **부하 감소와 초기 로딩 시간 단축을 실측했다고 주장하지 않는다.**
  물리 리소스 유휴 시작의 표시 성공·레이어별 정본 픽셀 동등성·RAM/VRAM·앱 재개 성능은 미검증이다.

## 후속 검증

Windows WebView 실행에서 최초 편집 가능 시간, 지형/수계 시작 시각과 성공 여부,
브라우저 기존 런타임 대비 처리시간·메모리를 같은 조건에서 비교한다.
1989년 소련 대형 도형 편집은 이미 확보한 GPU 버퍼 재사용·자동저장
경량화 회귀 결과와 구분해 실측한다.
Android 실기기 파일 대화상자·외부 지명/수계 표시 검사는 2-4 범위다.

기존 Qt 앱, `main`, 공개 배포판은 변경하지 않음.
