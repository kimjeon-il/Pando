# 공통 웹 초기화 및 전체 세계 데이터 패키징 — 2-3A~C

> 보고서 ID: `DEV-080` · 상태: `investigating` · 지도 반영: `not-applicable` · 색인일: 2026-10-16
> 원문 최종 수정: 2026-10-16
> 조사 기준: `work/ui`, 2026-10-16
> 원본·출처: [앱 실행법](../../../apps/web-shell/README.md), [세계 데이터 manifest](../../../assets/data/world/current.json)

## 목적과 구현

2-3A: 전체 세계지도 앱은 `apps/web-shell/startup.js`에서 웹의 `assets/js/bootstrap.js`를 호출한다.
기존 웹 `data-loader-worker.js`가 빠른 미리보기 → 원본 국가 packet → 정본 메시를 로딩한다.
`assets/js/app.js`는 Tauri가 미리 주입한 platform 기능만 선택적으로 넘기고, 웹에서는 기존 기본값 `{}`를 사용한다.
소형 15좌표 검증 프로필은 변형하지 않고 따로 유지한다.

2-3B: `apps/web-shell/stage.mjs`의 `full-world` 프로필은 정본 manifest에서 포함 파일을 자동 산출한다.
정본 258개국용 다섯 메시/국가 자산, 공유 국경선 캐시, 역사 프로젝트, 국가·지역 라이브러리,
미리 계산한 정밀 다각형 메시의 현재 참조 파일만 포함한다.
개별 pin을 가진 파일은 staging 전에 압축 크기와 SHA-256을 대조한다.
전체 세계 패키징 한도는 256 MiB, 소형 시험 한도는 80 MiB로 분리한다.

2-3C: 실행 모드의 `stage-profile.json`과 빌드된 자산 리비전을 일치시키고,
로컬 origin 이외 모든 네트워크 요청을 계속 차단한다.
`full-world` 프로필만 로컬 `assets/data/` 요청을 허용한다.
웹의 기본 역사 자료 공급자를 재사용하며 전체 세계와 시험 데이터의 IndexedDB 이름을 분리한다.
수계·지형·내장 지명은 비활성화된 상태로 유지한다.

## 검증 근거

- 실제 저장소 `assets/data/world/current.json`의 국가 수는 258.
- published metadata + world/historical/library/prepared manifest에서 해석된 대상은 **597개 파일**.
- 실제 GitHub 디렉터리 목록과 비교해 대상 경로(상위 manifest 포함) 존재 여부 및
  제공된 파일 크기의 불일치 **0건**. 선별 데이터 크기는 약 **79.8 MB**
  (GitHub directory metadata 기반이며 실제 앱 패키징 실행 실측 아님).
- 순수 manifest 계획 단위 테스트 2건(경로 폐쇄, 잘못된 pin·원격/상위 경로 거부):
  소스 대상 격리 JavaScript 실행에서 **PASS**.
- 전체 저장소의 공식 Node 단위 테스트 명령, 실제 전체 세계 바이너리 패키징, Windows/Android Tauri 빌드,
  WebGL 전체 화면·타임라인·대용량 반응성: 아직 **NOT_RUN**.
- 기존 소형 앱 소스·검증 수치는 2-3 이후 재빌드하여 비교해야 함.

### 독립 실행 환경 검증 추가 (2026-10-16)

최신 `work/ui` 기반의 2-3A~C 자료를 GitHub 연결로 재확인했고,
작동 가능한 Linux/Node.js 22 테스트 환경에 관련 JS 원본과 테스트를 옮겨 실제 실행했다.
단, 전체 저장소 체크아웃은 불가능했으므로 staging 테스트의
`fixture.mjs`(복잡한 실제 Core fixture 의존성)는 동일한 3객체/15좌표의
최소 로컬 대체 자료를 사용했다. **이를 전체 저장소의 정식 Node 테스트 통과로 표현하지 않는다.**

- `node --test apps/web-shell/tests/{network-guard,stage-world,stage,world-data-plan}.test.mjs`
  에 해당하는 소스 4개 묶음을 별도 Node 실행 환경에서 실행: **12 PASS / 0 FAIL**.
  검사 범위: 소형 모드 복귀, W​​ASM 스테이징 pin 오류,
  패키징 출력물 소유권 보호, Worker strict 유지, 네트워크 출처 제한,
  전체 세계자료 파일 선택, 변조된 데이터 거부.
- 원본 `stage.mjs`를 이용하여 **597개 가상 데이터 파일**을 가진 전체 세계자료 manifest를 생성한 뒤
  패키징을 끝까지 수행: **PASS**. 출력 총 **607개 파일**의 SHA-256을 재검사: **607건 일치**.
  선택되지 않은 구버전 자료 및 수계 자료의 배제도 확인했다.
  **가상 파일 자료로 실행한 것으로 실제 세계지도 79.8 MB 바이너리 패키징 결과가 아니다.**
- 실제 GitHub manifest 4종을 적용한 계획은 **597개 파일**을 선택한다.
  GitHub 디렉터리 목록에서 597개 경로의 존재와 등록된 파일 크기를 대조:
  **누락 0건, 크기 불일치 0건**, 목록상 **79,780,645 bytes**.
  현재 세계지도의 근거 국가 수는 **258개**.
  실제 바이너리 SHA-256 전체 재검사와 본앱 패키징은 **NOT_RUN**.
- `startup.js`, 공용 `app.js`, 웹 `bootstrap.js`, 실제 `data-loader-worker.js`,
  빌드 metadata, Tauri 패키징 설정의 12개 중요 연결 조건은 소스 검사 **12 PASS**.
  이는 브라우저 실동작 검증이 아닌 정적 연결 검증이다.
- Linux Chromium의 로컬 HTTP 및 `tauri.localhost` 탐색은
  `ERR_BLOCKED_BY_ADMINISTRATOR`로 차단됨.
  브라우저 부트스트랩·WebGL 동작은 **BLOCKED / NOT_RUN**.
- 이 환경에는 Windows Tauri 빌드 환경, Rust/Cargo, Android SDK/실기기,
  전체 세계바이너리 597개 사본이 없으며, Windows/Android 실제 빌드와
  OS 파일 선택창·성능·세계지도 렌더링은 **NOT_RUN**.

검증용 임시 파일은 별도 환경에 생성했으며 실제 저장소 코드·GIS 자료와
Qt 앱 코드는 이 검증 과정에서 수정하지 않았다.
실제 전체 자료 패키징 및 Windows·Android 실행이 통과해야 2-3A~C를
**실행 검증 완료**로 전환할 수 있다.

## Windows 실제 전체 세계자료 패키징·WebView 실행 검증 (2026-10-16)

**최종 PASS 실행:** [GitHub Actions 38868061025](https://github.com/kimjeon-il/Pando/actions/runs/38868061025),
`work/ui` 커밋 `bcdb6de1b7b56fc656fd5fd26a0e870c8dfde565`.
실행 환경: GitHub-hosted `windows-2022`, Windows MSVC, Tauri 2, WebView2.
검증 대상은 종전 Qt 앱이 아닌 `apps/web-shell`의 전체 세계자료 프로필이다.

| 검증 항목 | 실제 결과 |
| --- | --- |
| 관련 Node.js 집중 테스트 | PASS |
| 실제 정본 파일 패키징 및 길이·SHA-256 검사 | PASS |
| 대상 전체 세계자료 | **597개 파일, 79,795,768 bytes** |
| 앱 스테이징 전체 | **1,486개 파일, 135,439,907 bytes** |
| Windows Tauri MSVC 디버그 앱 빌드 | PASS |
| Windows WebView 앱 실행 및 자동 진단 | **PASS, 12/12 검사** |
| 원본 국가·영토 형상 | **258** |
| 정본 편집 모델 객체 | **254** (상위 국가 207개 + 하위 영토 47개) |
| 부모 국가 형상에 통합된 원본 항목 | **4** |
| 지도 렌더러 | **WebGL2**, 활성 컨텍스트 1개, 삼각형 **140,558개** |
| WASM 코어, 정본 국가 packet·GPU 메시, 로더 Worker | PASS |
| 의도하지 않은 외부 자료 요청 | **0건** |
| 미리보기 준비 | 약 **443 ms** |
| 정본 형상 수신 | 약 **4,824 ms** |
| 정본 메시 수신 | 약 **16,277 ms** |
| 정본 렌더링 준비 완료 | 약 **19,190 ms** |

실제 Windows 앱의 `world-windows.json`은 `ok: true`, `phase: canonical-ready`이며
`packageProfile`, `historicalWorld`, `sourceCountryCount`, `modelEntityCount`,
`sovereignRootCount`, `preview`, `canonicalGeometry`, `canonicalMesh`, `renderer`,
`sharedCore`, `dataLoaderWorker`, `blockedRequests` 총 **12개 항목 PASS**로 기록했다.
실행 파일에 내장된 staging 출처 커밋 및 공통 코어/WASM 해시도 보고서에 포함되어 있다.

[정본 진단·stage evidence ZIP](https://github.com/kimjeon-il/Pando/actions/runs/38868061025/artifacts/12031894268)

최초 3회 실행에서는 애플리케이션의 데이터가 아니라 진단 검사의 **대상 수량 정의**와
PowerShell 최종 비교 기준이 실제 세계지도의 분류 규칙과 일치하지 않았다.
원본 형상 258개 중 일부는 하위 객체가 되거나 상위 국가 형상에 통합되므로,
정본 편집 객체는 254개다. 정확한 기준으로 재검증한 4번째 실행은 워크플로 전체가 성공했다.
최초 실패 결과를 현재 앱 오류로 해석하지 않는다.

**한계:** 이 결과는 Windows 호스티드 러너의 전체 세계지도 시작·렌더링에 대한 실증이다.
Android 실기기 실행, 물리 수계·지형·지명 표시(2-3D), 1MiB 초과 프로젝트 파일(2-3E),
대형 객체 편집/소련 1989년 성능(2-3F 및 2-4), 실제 OS 파일 대화상자 조작은
이번 자동 실행의 PASS 범위에 포함되지 않는다.
`main` 및 기존 Qt 앱을 변경하거나 웹사이트에 배포하지 않았다.

## 후속 단계

1. Node 환경에서 `node --test apps/web-shell/tests/world-data-plan.test.mjs apps/web-shell/tests/stage.test.mjs apps/web-shell/tests/network-guard.test.mjs`.
2. `pnpm --dir apps/web-shell stage:world`를 실행하고 `apps/web-shell/dist/shell/stage-evidence.json`의 파일 SHA와 개수를 검사.
3. `PANDOLAB_SHELL_PROFILE=full-world` 환경에서 시험용 Windows 앱을 빌드하여 실제 화면과 역사 자료를 확인.
4. 나머지 물리 데이터·지명 로딩 및 대형 프로젝트 파일 IPC는 2-3D~F, Android 실기기 성능은 2-4.

기존 Qt 앱과 `main` 배포는 수정하지 않음.
