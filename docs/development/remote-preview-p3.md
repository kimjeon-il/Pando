# P3 — 원격 웹 미리보기 및 브라우저 검증

적용 브랜치: `work/ui`, `work/objects`, `work/gis`, `work/places`. CI: `.github/workflows/remote-preview-p3.yml`. 현재 메인 사이트는 `.github/workflows/web-pages.yml`이 배포하며 **P3에서는 main Pages를 변경하거나 배포하지 않는다**.

## 브랜치별 웹 미리보기

브랜치의 웹 소스가 변경되면 해당 브랜치의 GitHub Actions 실행에 **두 종류의 산출물**이 생긴다.

1. `p3-web-work-objects-<SHA>` 같은 브랜치/커밋 식별 정적 사이트 묶음. 원본 커밋·파일별 SHA·파일 크기를 `preview-manifest.json`에 기록한다. `index.html`, `.nojekyll`, 정적 `assets/`만 포함하며 네이티브 C++·원본 연구 스크립트·보고서는 제외한다.
2. `p3-browser-work-objects-<SHA>` 같은 Playwright 브라우저 검증 보고서·데스크톱(1280×800)과 모바일 에뮬레이션(390×844) 화면 캡처·실패 로그. 실제 브라우저로 URL 로드, 지도 영역 노출, 런타임 오류, 기본 performance telemetry를 확인한다.

GitHub 저장소 **Actions → P3 Remote preview and browser verification → 해당 브랜치 실행 → Artifacts**에서 두 파일을 받을 수 있다. 정적 사이트 묶음을 내려받고 압축 해제한 디렉터리에서 `python -m http.server 8080`을 실행하거나 같은 동작의 정적 HTTP 서버를 사용하면 테스트할 수 있다. 단, `file://` 직접 실행은 Worker/fetch 정책 때문에 지원하지 않는다.

**이것은 다운로드 가능한 브랜치별 미리보기이지 자동 공개 URL이 아니다.** GitHub Pages의 사이트는 배포 대상 1개이므로 브랜치별 `deploy-pages`를 병렬 실행하면 운영 사이트를 덮어쓸 수 있다. 독립 도메인/별도 정적 호스팅을 연결하지 않는 한, P3에서 공개 웹 미리보기 URL이 생겼다고 주장하지 않는다.

## 브랜치별 원격 브라우저 직접 미리보기 (Codespaces, 선택)

정적 ZIP을 내려받지 않고 원격 브라우저에서 직접 확인하려면 각 작업 브랜치의 Codespace를 연다. GitHub 계정의 Codespaces 이용 가능 여부와 실행 요금·한도는 사용자 계정 정책에 따른다. **Codespace 인스턴스는 요청한 사용자만 생성할 수 있으며 이 커밋만으로 자동 실행되지는 않는다.**

- [객체 브랜치 원격 미리보기](https://codespaces.new/kimjeon-il/Pando/tree/work/objects?quickstart=1)
- [UI 브랜치 원격 미리보기](https://codespaces.new/kimjeon-il/Pando/tree/work/ui?quickstart=1)
- [GIS 브랜치 원격 미리보기](https://codespaces.new/kimjeon-il/Pando/tree/work/gis?quickstart=1)
- [지명 브랜치 원격 미리보기](https://codespaces.new/kimjeon-il/Pando/tree/work/places?quickstart=1)

해당 브랜치의 `.devcontainer/devcontainer.json`은 Node 24 컨테이너를 사용하고, `.devcontainer/start-preview.sh`가 프로젝트 빌드나 의존성 설치 없이 `scripts/p3-preview-server.mjs`을 실행한다. Codespaces의 **PORTS** 탭에서 4173 포트를 확인하고 미리보기 링크를 연다. 이 링크는 Codespace가 가동 중일 때만 접속 가능한 **개인용 포트 URL**이며, 별도 영구 공개 호스팅이 아니다. 포트는 기본 비공개 상태로 유지하고, 필요한 경우에만 사용자 본인이 공개 범위를 변경한다.

웹 미리보기 서버는 `index.html`과 `assets/**`만 서비스하고 `.git`, `apps`, `shared`, `reports`, `config` 등 개발·비공개 파일은 제공하지 않는다. Node 내장 HTTP 서버만 사용하므로 Python·Emscripten이 필요 없다. 워크스페이스의 소스를 수정한 뒤 브라우저를 새로고침해 변경을 확인할 수 있으며, GPU 실기기 동등성 검증을 의미하지 않는다.

## 앱 검증

앱 실행·빌드는 `apps/editor/README.md`와 전용 Windows·Android workflow를 따른다.
P3는 웹 미리보기와 브라우저 검사만 담당한다.

## 실행 조건과 검증 경계

변경 범위 선택기 `scripts/p3-plan-remote.mjs`는 실제 브랜치 소스의 존재와 Git 변경 파일을 확인하여 `preview`, `browser` 작업을 독립적으로 선택한다. `scripts/p3-stage-preview.mjs`는 Git-tracked 사이트 파일만 복사하며 금지 경로와 필수 WASM 파일 누락을 거부한다. `tests/unit/p3-remote-plan.test.mjs`에서 선택 및 결과물 보호를 검증한다.

수동 실행은 `auto`, `preview`, `browser`, `all` 중 선택한다. 메인에 통합되지 않은 브랜치 전용 워크플로의 수동 실행 노출은 GitHub 제한을 따르며, 브랜치의 소스 push가 기본 실행 경로다.

남은 별도 항목은 실장치 GPU/드라이버, Android 휴대폰 터치·성능, Windows 실제 그래픽 화면, 전체 브라우저 회귀와 대규모 GIS 데이터 교차 검증이다. 경량 브라우저의 선별 결과만 성공으로 기록해야 하며, 제품 배포·정식 성능 수용은 P9 단계가 담당한다.


## P7/P8 실행 순서

P2가 입력 그래프에서 오래된 생성물을 찾으면 원본 push의 P3 무거운 작업을 보류한다. P2 게시가 끝나면 `source_sha`(실제 결과), `original_source_sha`(원본), `base_sha`(변경 기준)를 전달한다. P3는 지정 SHA를 체크아웃하고 원본의 후손인지 확인한다. UI/객체/GIS/지명 경량 계약, 브라우저를 실제 변경 범위로 선택한다. 문서 변경은 무거운 작업을 선택하지 않는다.

수동 진단으로 `qt`/`browser` 등을 선택할 수 있다. 구현 중 중간 반복 회귀는 하지 않고 최종 기능·성능 검증은 P9에서 모아 실행한다. 이미 생성한 로그는 재사용하며 실패한 직접 항목만 다시 확인한다.

## P9 final candidate and focused resume

Run scope=acceptance against the committed P2 result SHA, with base_sha set to the fixed pre-P6 source and original_source_sha identifying the generating source commit. This records Web user flows, real software-rendered browser output, matched-run calculation performance. It does not deploy Pages.

Set retry_failed=true only when the preceding acceptance evidence is retained: the workflow reuses completed UI/temporal/place, mesh/boundary, Web snapshot and hydro checks; it checks changed geometry/reference/river contracts and the remaining user flows. Calculation remeasurement selects river/reference only.


For the remaining browser acceptance only, use scope=browser with retry_failed=true. This preserves the user flows and paired browser performance, while calculation timing and completed contracts are omitted. Startup/screenshot checks run first and require the enhanced state during acceptance; an explicit startup error stops that group immediately instead of making each editing case wait for the same failed startup.

browser_tests optionally narrows the Playwright name expression to unresolved cases and reuses the earlier startup/screenshot evidence. The acceptance flows disable full DOM tracing; model/geometry, conservation and Undo assertions remain, and errors/screenshots are retained. The paired timing case also runs without tracing.

Set browser_flows=false only for a performance-only follow-up with retained editing-flow evidence; provide browser_tests to reuse completed startup screenshots. The timing case invokes the existing focus command on both revisions and verifies the view changed, so panel visibility and pointer-hover animation are outside the measured frame scope. Its JSON is saved to the test output directory even when measurement fails.

The P9 browser performance case checks out baseline 8e22982616e3c9ba43eeb84baec17cd886267cfa. It runs one app page at a time with one warmup per side and five alternating rounds; uncertain metrics receive at most one additional five-round group. HTTP cache is disabled identically. It records startup paint/edit readiness, RUS focus frame p95 and main-page JS heap, preserving distributions and unverified scopes. Physical GPU, WebView performance, Android touch, large-edit frame comparison and total Worker/WASM/GPU memory remain distinct requirements.

For a calculation-only local diagnosis against an existing fixed baseline checkout, use tools/p6-calculation-performance.mjs --baseline <baseline-directory> --candidate . --operations river,reference --output <raw-result.json>. Do not run other CPU checks during timing. The required WASM build uses native WebAssembly exception handling; browser execution and operation error contracts must be checked after changing that compiler mode.
