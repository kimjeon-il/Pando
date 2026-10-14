# P2 — 소스 일치 생성물 및 원격 C++ 빌드 증빙

기준: `work/objects` (2026-10-14). 개발 브랜치를 유지하며 제품의 C++ 로직, HTML, 런타임 정책을 바꾸지 않고 **기존 생성기/패키징기**를 원격 CI에 연결한다. P1 `CMakePresets.json`을 모든 C++ 빌드에서 재사용한다.

## 책임 구분과 생성물 계약

| 정본 입력 | 생성기·컴파일러 | 저장 위치 | 검증·해시 |
| --- | --- | --- | --- |
| `shared/**` C++17 원본, CMake 소스 계약 | Emscripten 4.0.20 + `tools/package-shared-core-assets.mjs` | `assets/wasm/pandoeditor-core.js`, `.wasm`, `.manifest.json` | `sourceSha256`, 각 소스 파일 SHA-256, compiler, ABI 1, JS/WASM 바이트 SHA-256, **실제 컴파일된 모듈 초기화** |
| `shared/core/**` + `native/engine/**` | P1 CMake `pando-native-core` | 격리된 `build-native/p1/pando-native-core`의 C++ 정적 라이브러리. **실행 파일을 Git에 추가하지 않음** | `cmake/P2NativeBuildReceipt.cmake` → 빌드 실행 SHA, CMake 버전, 입력별 해시와 정적 라이브러리의 크기·SHA-256·타깃/의존 관계를 JSON artifact로 업로드 |
| 기존 웹 계산 JS·고정 vendor·Qt 어댑터 원본 | `native/tools/m97/cut-kernel-generate.mjs` | `native/assets/geometry/current/**`, `native/resources/current_geometry.qrc` | 정본 JS·고정 Acorn 8.15.0·변환 원본/산출물 SHA, `--check` 및 현행 테스트 |
| 웹 참조이미지 계산 원본 JS | `native/tools/reference-parity/build-runtime.mjs` (esbuild 0.25.10) | `native/app/reference-web/runtime.js`, `manifest.json` | 소스 파일별 SHA·번들 SHA, `--check`, 참조 계산 회귀 |

일반 Web JS UI·지형/수계/역사 GIS 대형 생성물까지 C++로 옮긴 것이 아니다. 그 작업은 P5/P7의 대상이다. 성능이 높은 메시/LOD/캐시는 변경하지 않는다.

## 자동 실행 조건

- `work/objects`의 관련 소스·manifest 변경 시 `.github/workflows/generated-artifacts-p2.yml`이 실행된다. 변경 파일은 실행 **후보**일 뿐이다. `scripts/p2-artifact-plan.mjs`가 현재 원본·기존 매니페스트·파일 해시를 검사해 **WASM / Qt 지오메트리 / 참조 계산을 독립적으로** 선택한다.
- 기본 `auto`에서는 누락/불일치/생성기 변경이 없는 산출물을 재컴파일하지 않는다. CI·계획기 최초 설치 등에서만 재생성 경로의 실제 실행을 확인한다. 수동 실행 시 `wasm`, `geometry`, `reference`, `all`, `verify` 스코프를 선택할 수 있다.
- WASM이 필요한 경우: `emcmake cmake --preset pando-wasm` → `cmake --build --preset pando-wasm` → 패키징 → ABI·소스·파일 해시 대조 → 집중 WASM 계약.
- Qt JS 생성물이 필요한 경우: 기존 `pnpm install --frozen-lockfile --ignore-scripts`로 개발 파서 준비 → 원본 생성기 → `--check` → 집중 계약. **Qt/CMake 앱 전체 빌드는 여기서 실행하지 않는다.**
- 네이티브 C++는 기존 P1의 `native-engine` 경량 빌드가 소유한다. `cmake/P2NativeBuildReceipt.cmake`가 **실제 컴파일된 2개 아카이브**를 확인해 원본·바이너리 영수증을 GitHub artifact로 업로드한다. Qt·Node.js·Python 없이 동작해야 한다. `work/objects`의 중복 Emscripten 컴파일은 P1에서 건너뛰고 P2가 전담한다.

## 게시 및 실패 처리

1. 생성한 산출물의 원본 지문과 출력 해시가 일치하는지 다시 검사한다. 소스 정합성이 없으면 **게시 금지**한다.
2. `assets/wasm/`의 지정 3개 파일, `native/assets/geometry/current/`, `native/resources/current_geometry.qrc`, `native/app/reference-web/`의 지정 2개 파일만 staging한다. `scripts/p2-artifact-plan.mjs --validate-staged`로 허용 경로/실제 변경 종류를 검증한다.
3. 생성물이 기존 바이트와 같으면 **추가 커밋하지 않는다**. 다르면 기존 `work/objects` head SHA를 다시 확인하고 `github-actions[bot]`이 **해당 브랜치에만** 일반 fast-forward push한다. 다른 사람이 새 커밋을 올렸다면 덮어쓰지 않고 실패로 기록한다. 강제 push·stash·reset·clean은 사용하지 않는다.
4. GitHub Actions의 기본 `GITHUB_TOKEN`으로 만든 봇 커밋은 별도의 일반 push 워크플로를 자동 재트리거하지 않으므로 **동일한 생성 작업 내에서 실제 검증**을 완료한다. 생성물은 커밋되므로 이후 PR의 main 대비 검증에서도 동일 바이트를 확인할 수 있다.
5. 출처/ABI 불일치·구문 변환 실패·Qt 원본 동작 회귀·네이티브 컴파일 오류는 다른 성공 검사로 은폐하지 않는다. P4의 국가 폴리곤 채색/외곽선 문제나 역사 GIS 데이터는 이 자동 생성 범위 밖이므로 무단 재생성하지 않는다.

## 후속 분리 작업

- **P3:** Windows/Linux Qt 전체 앱 빌드·실제 실행·화면 캡처·원격 웹 미리보기. `pando-native-qt`의 남은 Node/Acorn 전처리는 P5/P6 전까지 필요하다.
- **P5~P6:** Qt가 JS 계산 소스를 가져오는 경로를 C++로 옮겨 앱 빌드에서 Node 필수를 제거한다.
- **P7:** 국가 메시·GIS·지명 등 대형 데이터의 입력 그래프와 출력 미러까지 같은 자동화 원칙으로 확장한다.

기존 생성물 `sourceSha256` 계산은 `shared/**`의 C++/CMake/테스트 소스 파일에도 걸쳐 있다. 향후 순수 테스트 수정 시 불필요한 WASM 재빌드를 피하려면 CMake와 패키징기의 원본 지문을 **함께** 좁혀야 한다. 현재 계약을 단독 변경해 이미 배포된 소스 해시를 무효화하지 않는다.
