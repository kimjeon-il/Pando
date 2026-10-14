# P3 — 원격 웹 미리보기 및 Windows/Linux Qt 검증

적용 브랜치: `work/ui`, `work/objects`, `work/gis`, `work/places`. CI: `.github/workflows/remote-preview-p3.yml`. 현재 메인 사이트는 `.github/workflows/web-pages.yml`이 배포하며 **P3에서는 main Pages를 변경하거나 배포하지 않는다**.

## 브랜치별 웹 미리보기

브랜치의 웹 소스가 변경되면 해당 브랜치의 GitHub Actions 실행에 **두 종류의 산출물**이 생긴다.

1. `p3-web-work-objects-<SHA>` 같은 브랜치/커밋 식별 정적 사이트 묶음. 원본 커밋·파일별 SHA·파일 크기를 `preview-manifest.json`에 기록한다. `index.html`, `.nojekyll`, 정적 `assets/`만 포함하며 네이티브 C++·원본 연구 스크립트·보고서는 제외한다.
2. `p3-browser-work-objects-<SHA>` 같은 Playwright 브라우저 검증 보고서·데스크톱(1280×800)과 모바일 에뮬레이션(390×844) 화면 캡처·실패 로그. 실제 브라우저로 URL 로드, 지도 영역 노출, 런타임 오류, 기본 performance telemetry를 확인한다.

GitHub 저장소 **Actions → P3 Remote preview and Qt verification → 해당 브랜치 실행 → Artifacts**에서 두 파일을 받을 수 있다. 정적 사이트 묶음을 내려받고 압축 해제한 디렉터리에서 `python -m http.server 8080`을 실행하거나 같은 동작의 정적 HTTP 서버를 사용하면 테스트할 수 있다. 단, `file://` 직접 실행은 Worker/fetch 정책 때문에 지원하지 않는다.

**이것은 다운로드 가능한 브랜치별 미리보기이지 자동 공개 URL이 아니다.** GitHub Pages의 사이트는 배포 대상 1개이므로 브랜치별 `deploy-pages`를 병렬 실행하면 운영 사이트를 덮어쓸 수 있다. 독립 도메인/별도 정적 호스팅을 연결하지 않는 한, P3에서 공개 웹 미리보기 URL이 생겼다고 주장하지 않는다.

## 브랜치별 원격 브라우저 직접 미리보기 (Codespaces, 선택)

정적 ZIP을 내려받지 않고 원격 브라우저에서 직접 확인하려면 각 작업 브랜치의 Codespace를 연다. GitHub 계정의 Codespaces 이용 가능 여부와 실행 요금·한도는 사용자 계정 정책에 따른다. **Codespace 인스턴스는 요청한 사용자만 생성할 수 있으며 이 커밋만으로 자동 실행되지는 않는다.**

- [객체 브랜치 원격 미리보기](https://codespaces.new/kimjeon-il/Pando/tree/work/objects?quickstart=1)
- [UI 브랜치 원격 미리보기](https://codespaces.new/kimjeon-il/Pando/tree/work/ui?quickstart=1)
- [GIS 브랜치 원격 미리보기](https://codespaces.new/kimjeon-il/Pando/tree/work/gis?quickstart=1)
- [지명 브랜치 원격 미리보기](https://codespaces.new/kimjeon-il/Pando/tree/work/places?quickstart=1)

해당 브랜치의 `.devcontainer/devcontainer.json`은 Node 24 컨테이너를 사용하고, `.devcontainer/start-preview.sh`가 프로젝트 빌드나 의존성 설치 없이 `scripts/p3-preview-server.mjs`을 실행한다. Codespaces의 **PORTS** 탭에서 4173 포트를 확인하고 미리보기 링크를 연다. 이 링크는 Codespace가 가동 중일 때만 접속 가능한 **개인용 포트 URL**이며, 별도 영구 공개 호스팅이 아니다. 포트는 기본 비공개 상태로 유지하고, 필요한 경우에만 사용자 본인이 공개 범위를 변경한다.

웹 미리보기 서버는 `index.html`과 `assets/**`만 서비스하고 `.git`, `native`, `reports`, `config` 등 개발·비공개 파일은 제공하지 않는다. Node 내장 HTTP 서버만 사용하므로 Python·Qt·Emscripten이 필요 없다. 워크스페이스의 소스를 수정한 뒤 브라우저를 새로고침해 변경을 확인할 수 있으며, GPU 실기기 동등성 검증을 의미하지 않는다.

## Qt 앱 원격 빌드·CTest

실제 `native/`가 있는 브랜치에서 앱·공통 코어·Qt 리소스·CMake 계약이 바뀐 경우에만 Windows 2022와 Ubuntu 24.04 작업을 각각 실행한다. `native/`가 없는 과거 웹 전용 브랜치는 **앱 빌드를 성공했다고 기록하지 않고 skip**한다.

기존 단일 CMake 진입점과 `CMakePresets.json`에 추가된 프리셋:

- Linux: `cmake --preset pando-native-qt-ci-linux`, `cmake --build --preset pando-native-qt-ci-linux`, `ctest --preset pando-native-qt-ci-linux`
- Windows: `cmake --preset pando-native-qt-ci-windows` (vcpkg zlib toolchain 추가), `cmake --build --preset pando-native-qt-ci-windows`, `ctest --preset pando-native-qt-ci-windows`

CMake 3.31.6, Qt 6.8.3, Node 24, pnpm 11.19.0, Python 3.12는 사용 범위에 따라 설치한다. 현재 Qt 앱 빌드의 JS geometry source admission과 선택한 CTest 때문에 Node/Python이 아직 필요하다. 기존 P2 WASM/Qt 생성물은 이번 Qt 빌드에서 **검사**하지만 별도의 무단 갱신을 하지 않는다.

앱 전체 `pandoeditor`와 선택된 `temporal_tests`, `m72_mapprojection_lifetime_tests`, `interaction_style_policy_tests` CTest를 빌드한다. Linux에서는 Xvfb 가상 디스플레이에서 `pandoeditor --smoke-check`을 실행해 실제 Qt Quick 창 캡처를 시도하며, 결과를 브라우저 캡처와 **분리**한다. 이 캡처는 실제 GPU/모바일 화면 검증이 아니다.

각 OS의 `p3-qt-<linux|windows>-<SHA>`에는 가능한 범위의 빌드 로그, CTest 결과, 실행 파일(포터블 패키지 아님), 빌드 출처 증빙, Linux 가상 화면 캡처를 넣는다. 실패하더라도 생성된 로그와 증거를 업로드한다. 현재 Qt 테스트는 해당 CTest 타깃만 실행하며 전체 테스트를 임의로 돌리지 않는다.

## 실행 조건과 검증 경계

변경 범위 선택기 `scripts/p3-plan-remote.mjs`는 실제 브랜치 소스의 존재와 Git 변경 파일을 확인하여 `preview`, `browser`, `qt` 작업을 독립적으로 선택한다. `scripts/p3-stage-preview.mjs`는 Git-tracked 사이트 파일만 복사하며 금지 경로와 필수 WASM 파일 누락을 거부한다. `tests/unit/p3-remote-plan.test.mjs`에서 선택 및 결과물 보호를 검증한다.

수동 실행은 `auto`, `preview`, `browser`, `qt`, `all` 중 선택한다. 메인에 통합되지 않은 브랜치 전용 워크플로의 수동 실행 노출은 GitHub 제한을 따르며, 브랜치의 소스 push가 기본 실행 경로다.

남은 별도 항목은 실장치 GPU/드라이버, Android 휴대폰 터치·성능, Windows 실제 그래픽 화면, 전체 브라우저 회귀와 대규모 GIS 데이터 교차 검증이다. 경량 브라우저/Qt의 선별 결과만 성공으로 기록해야 하며, 제품 배포·정식 성능 수용은 P9 단계가 담당한다.
