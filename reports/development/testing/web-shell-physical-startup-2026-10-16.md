# DEV-084 — 신규 WebView 전체 세계지도 물리 자료 로딩 경량화

> 검증 상태: `verified-windows-paired-30s` · 지도 반영: `not-applicable` · 2026-10-16
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
- 변경 후 Windows WebView CI
  [38879199695](https://github.com/kimjeon-il/Pando/actions/runs/38879199695)에서 실행 검증을 통과했다.
  당시에는 물리 로딩 순서 변경의 성능 효과를 확정할 수 없었으나,
  이후 [38917373538](https://github.com/kimjeon-il/Pando/actions/runs/38917373538)의
  동일 러너 A/B 실측으로 **초기화 시간 감소**를 재현했다.
  개별 물리 레이어의 픽셀 정확도·GPU VRAM·앱 재개 성능은 별도 검증 대상이다.

## 2-3F Windows A/B 실측 결과 — 동일 러너 비교 (2026-10-16)

**최종 검증:** [GitHub Actions 38917373538](https://github.com/kimjeon-il/Pando/actions/runs/38917373538) · `c312c3b7db1a0cd547397f5e95a2f1a869202ed4` ·
`windows-2022` + Tauri WebView2 / WebGL2 · 6회 전부 검사 통과.
[검증 원본 아티팩트](https://github.com/kimjeon-il/Pando/actions/runs/38917373538/artifacts/12053417230):
`paired-startup-memory.json`과 실행별 `world-pair-*.json` 6개, `stage-evidence.json`.

**비교 방식:** 동일 실행 파일·같은 Windows 러너·동일 manifest 610개 파일·동일 운영체제에서
전용 진단 옵션으로 물리 자료의 *즉시 로딩*과 *정본 준비 후 유휴 로딩*만 변경.
각 3회, 실행 순서 `immediate → deferred → deferred → immediate → immediate → deferred`.
각 실행은 다른 WebView2 프로필(Cold browser cache)을 사용하고, 정본 준비 뒤 **30초 관측**.
표 값은 모드별 **3회 중앙값**이다.

| 측정 지표 | 즉시 로딩 | 지연 로딩 | 지연−즉시 |
| --- | ---: | ---: | ---: |
| 정본 지도 준비 완료 | 20,143.90 ms | **16,013.30 ms** | **−4,130.60 ms (−20.5%)** |
| 프로세스 트리 최고 사유 커밋 | 1,773.20 MiB | 1,742.30 MiB | −30.90 MiB |
| 프로세스 트리 최고 Working Set 합 | 1,833.15 MiB | 1,805.94 MiB | −27.21 MiB |
| 종료 직전 구간 사유 커밋 | 1,383.98 MiB | 1,380.31 MiB | −3.67 MiB |
| 종료 직전 구간 Working Set 합 | 1,447.66 MiB | 1,440.26 MiB | −7.40 MiB |

개별 ready 시간 즉시 `20,975.6 / 20,012.2 / 20,143.9 ms`,
지연 `15,970.6 / 16,013.3 / 16,466.1 ms`. 반복 세 번 모두 지연 모드가 빠름.
지연 모드의 지형/수계 서비스 초기화는 ready 후 약 **0.46초**에 시작되었고,
세 실행 모두 `['fulfilled','fulfilled']`를 반환했다(각종 타일·지명의 픽셀 정확도 통과를 뜻하지 않음).

**메모리 귀속:** Windows `Get-Process` 및 `Win32_Process` 하위 트리 기준;
모든 실행에서 앱 포함 약 8개 프로세스 관측. 종료 전 개별 `msedgewebview2`
최대 프로세스의 사유 커밋은 대략 **1.06–1.14 GiB**,
다음 주요 하위 프로세스는 약 **234–243 MiB**;
`pandolab-web-shell` 호스트 자체는 약 **7–9 MiB**.
따라서 사용량의 상당 부분은 WebView2 쪽이지만,
개별 렌더러/Worker의 JS·WASM 힙이나 VRAM을 별도 측정한 것은 아니다.
`PrivateMemorySize64`는 사유 커밋(할당 예약/커밋 개념)이지 실제 RAM/PSS가 아니며,
`WorkingSet64`의 프로세스별 합은 공유 페이지 중복 계산을 포함한다.
초기화 시간의 인과관계는 같은 코드/러너 내 로딩 정책만 전환하여 상대적으로 신뢰할 수 있으나
모드별 3회는 정밀 회귀 임계값 산정에 부족할 수 있다.

**판정:** 지연 로딩은 이 환경에서 **초기화 시간을 약 4.13초(20.5%) 단축**했다.
30초 후반 사유 커밋은 **−3.67 MiB로 사실상 동등**하다.
12초 관측 [38915702909](https://github.com/kimjeon-il/Pando/actions/runs/38915702909)에서는
지연 로딩의 종료 직전 메모리가 약 274 MiB 더 높았지만,
이번 30초 측정에서는 지속적으로 나타나지 않았다.
이는 짧은 관측 구간에서 할당/회수 타이밍이 달랐을 가능성과 양립하며,
**지속 누수를 입증하지도, 누수가 없음을 입증하지도 않는다.**
참고로 지연 모드 한 번에서는 종료 직전 사유 커밋이 **1,541.20 MiB**였으며,
다른 두 번은 약 1,380 MiB였다. 중앙값만으로 실행 간 편차를 감춰서는 안 된다.

본 A/B는 최초 정본 지도를 띄우는 테스트다.
1989년 소련 편집 반복, 시점 왕복·캐시 해제 후 PSS 잔류,
Android 실기기, 레이어별 물리 렌더링 정확도,
실제 사용자 GPU 및 디스크 성능은 별도 검증이 필요하다.
Android 실기기 검증은 사용자 요청으로 **이번 단계에서 제외하고 2-4로 연기**했다.

## 후속 검증

Windows WebView 실행에서 최초 편집 가능 시간, 지형/수계 시작 시각과 성공 여부,
브라우저 기존 런타임 대비 처리시간·메모리를 같은 조건에서 비교한다.
1989년 소련 대형 도형 편집은 이미 확보한 GPU 버퍼 재사용·자동저장
경량화 회귀 결과와 구분해 실측한다.
Android 실기기 파일 대화상자·외부 지명/수계 표시 검사는 2-4 범위다.

기존 Qt 앱, `main`, 공개 배포판은 변경하지 않음.
