# P1 — 원격 개발환경 표준화 실행 기록 (2026-10-14)

> 보고서 ID: `DEV-071` · 상태: `implemented / scoped CI verified` · 지도 반영: `not-applicable`  
> 기준: `Pando/main`의 병합 시점 `f2cfe79e874c71a22e0fff78580e76a3f139cd31`, 작업 브랜치 `work/objects`  
> 범위: CMake 공통 진입점, 설치 버전 계약, 4개 상설 작업 브랜치의 변경 범위별 원격 검증. 전체 Qt 앱 실행/성능 계측/Windows·Android 패키징은 P3 범위.

## 수정 파일

공통 설치 구성과 CMake: `CMakeLists.txt`, `CMakePresets.json`, `config/toolchain-versions.json`, `.nvmrc`, `.python-version`.

원격 검사: `scripts/p1-plan-remote-checks.mjs`, `tests/unit/p1-remote-scopes.test.mjs`, `.github/workflows/remote-development-p1.yml`.

운영 문서: `docs/development/remote-development.md`.

기존 객체 브랜치 전용 CI 2개(`object-timeline-regression.yml`, `native-object-timeline-native-parity.yml`)의 무조건적 push 실행을 변경 파일 경로 조건으로 제한했다. 기존 단위·네이티브 계약 및 `workflow_dispatch`는 유지한다.

## 확인된 원격 실행

| 대상 | 변경 커밋 | P1 실행 결과 | 관측 범위 |
|---|---|---|---|
| `work/objects` | `c0d289fb83694e41c4986f930971696a811d10bf` | [Run 38531698270: SUCCESS](https://github.com/kimjeon-il/Pando/actions/runs/38531698270) | plan, web-smoke, native-core, native-engine, gis-cpp-tools, wasm-compile |
| `work/gis` | `a5c5241715e7ee63a262de56be95264908562a93` | [Run 38531911375: SUCCESS](https://github.com/kimjeon-il/Pando/actions/runs/38531911375) | plan, web-smoke, native-core, native-engine, wasm-compile |
| `work/ui` | `252d799852ca1d0ed34ad58f330c18d32eee4ea2` | [Run 38531899899: SUCCESS](https://github.com/kimjeon-il/Pando/actions/runs/38531899899) | plan, web-smoke. `native/`, `shared/` 소스 없어 네이티브 검사 생략 |
| `work/places` | `467bc09757b08394646e8db751bfd4f604a8d53c` | [Run 38531926195: SUCCESS](https://github.com/kimjeon-il/Pando/actions/runs/38531926195) | plan, web-smoke. `native/`, `shared/` 소스 없어 네이티브 검사 생략 |

`work/gis`에는 `tools/cpp/CMakeLists.txt`가 없으므로 해당 C++ GIS CLI job은 실제 소스가 있는 `work/objects`에서만 실행했다. 생성 결과와 앱 소스는 다른 브랜치로 무단 복사하지 않았다.

객체 브랜치의 추가 CI 범위 제한 커밋 `28017d02dbff893111dc6f4ddda8faefe8dff5b0`에서는 [타임라인 웹 회귀 성공](https://github.com/kimjeon-il/Pando/actions/runs/38532229693) 및 [네이티브 타임라인 회귀 성공](https://github.com/kimjeon-il/Pando/actions/runs/38532229696)이 별도로 확인됐다.

## 결과 해석과 남은 항목

- **입증 완료**: 원격에서 동일 CMake preset으로 Qt 비의존 C++ 공통 코어·지도 엔진을 빌드하고, 필요한 경우 Emscripten 4.0.20으로 WASM을 컴파일할 수 있다. 작업 브랜치별 스코프 선택과 경량 JS 검사가 정상 실행됐다. Qt가 설치되어 있는 기존 네이티브 타임라인 CI도 정상 실행됐다.
- **설치 격리**: Node는 scope 분류/웹 JS 및 남은 Qt 생성기에만, Python은 GIS/연구 Python 필요 시에만 설치하도록 새 P1 파이프라인을 구성했다. 기존 60여 개 GitHub Actions의 모든 도구 버전을 이 단계에서 변경하지는 않았다.
- **미검증**: 새 `qt-app` full build job은 이번 변경에 native 앱 소스가 포함되지 않아 **SKIPPED** 상태다. Windows Qt 앱 실제 실행, Android, GPU/VRAM, 전체 앱 성능과 크기가 큰 GIS 데이터 재생성도 수행하지 않았다. P3/P9에서 필요한 범위만 검증해야 한다.
- **기존 실패와 분리**: 현재 main의 `CUT_GENERATED_DRIFT`, P4 메시 채색/외곽선 경계 불일치, 영토 index/구버전 자산 회귀, 웹 readiness 문제는 P1 성공으로 해결됐다고 주장하지 않는다. P2 생성물 정합성 및 제품 영역에서 별도 수정이 필요하다.
- `main` 브랜치에 P1을 직접 반영하거나 Pages를 배포하지 않았다. 보고서 커밋을 포함한 모든 제품 개발 변경은 기존 `work/*` 브랜치에만 남는다.

**최소검사 준수:** 고비용 GUI/브라우저/실기기 검사는 추가 실행하지 않았고, 필수 인프라 변경을 입증하는 작은 CMake 타깃·CTest 3종·WASM 컴파일과 Node 단위 검사에만 한정했다.
