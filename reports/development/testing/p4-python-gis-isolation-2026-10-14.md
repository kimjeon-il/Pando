# P4 — GIS Python 실행 경로 분리 및 일반 빌드 격리 검증

> 보고서 ID: `DEV-074` · 상태: `implemented / bounded CI verified` · 지도 변경: `not-applicable`  
> 작업 브랜치: `work/objects` · 기준: 2026-10-14 · 최초 구현: `cd39e1f8922f74299b77fa741cb0eaf8b5e22835`  
> 별도 완료 범위: GIS Python은 요청된 경우에만, 원본 가공은 명시적 실행 시에만 시행

## 소스·파이프라인 변경

1. `package.json`: 일반 `pnpm test`와 `check:versioning`에서 Python 명령 제거. 동일 범위의 프로젝트 schema 규칙을 새 Node 계약검사로 유지. `test:python`, `test:gis-python`으로 기존 Python 단위검사를 선택적으로 보존.
2. `native/app/CMakeLists.txt`: `PANDOEDITOR_ENABLE_PYTHON_ORACLES=OFF` 기본값. 모든 Python 기반 M6/M972/M974 검사·CMake Python 탐색을 명시적 `ON` 옵션으로 분리. Python을 요구했던 Node river adapter 검사도 opt-in 정책으로 제한.
3. `.github/workflows/remote-development-p1.yml`, `remote-preview-p3.yml`: Python 설치·GIS Python 검사 제거. 순수 Node/CMake/C++/Qt 코어·브라우저 검증 경로 보존.
4. `.github/workflows/application-architecture.yml`: Python 계약·역사 지도 C++ recipe 별도 실행, 앱·웹 명령/데이터 계약 검사에서 직접 Python 설치 제거. `scripts/plan-application-checks.mjs`에서 옛 Python scope 삭제.
5. `.github/workflows/gis-python-p4.yml`: GIS/레거시 Python **전용** workflow. 관련 Python 파일 변경 또는 워크플로 수정 시 문법과 manual launcher의 무실행 계약만 검사; 무거운 Python 테스트와 역사 경계 C++ recipe는 `workflow_dispatch`의 명시적 scope.
6. `scripts/gis/run-source.py`: 역사 경계, 지형 DEM/미리보기, Hydro 원본, 지명 원본 등의 allowlist를 갖춘 명시적 Python GIS 연구 CLI. `--execute` 없이는 파일 생성이나 원본 다운로드 없이 요청만 표시한다.
7. 기존 `world-dataset-stage3-gate.yml`에서 불필요한 Python 설치를 제거하고, 과거 고정 파일 개수 감사 `pando-pretransfer-cleanup-gate.yml`을 수동 실행으로 격리했다. 별도 GIS 생성에만 사용되는 역사 자료와 과거 연구 기록은 보존했다.

## 검증

| 원격 실행 | 관측 결과 | 의미 |
| --- | --- | --- |
| [GIS 전용 Python 실행 #38581423595](https://github.com/kimjeon-il/Pando/actions/runs/38581423595) | **SUCCESS** | Python 3.12 문법·launcher 무실행 단위검사. 재가공 및 전체 GIS 계약 실행 없음 |
| [일반 원격 빌드 #38581423418](https://github.com/kimjeon-il/Pando/actions/runs/38581423418) | **SUCCESS** | P1 변경 범위 분류, Python 비의존성 계약, Node 웹, C++ core, MapEngine, GIS C++ 도구, 기본 Qt 앱 빌드 |
| [P1 추가 회귀 #38582915687](https://github.com/kimjeon-il/Pando/actions/runs/38582915687) | **SUCCESS** | 경량 Python 격리·일반 웹 경로 계약 재확인 |
| [P3 앱·웹 실행 #38581423396](https://github.com/kimjeon-il/Pando/actions/runs/38581423396) | 관측 시점별 CI 상태 참조 | Linux Qt 빌드/선택 CTest/창 캡처 및 브라우저 검증 통과. Windows 결과는 별도로 확인해야 함 |

**해석:** 일반 제품 CMake 스크립트·Node 웹 테스트의 직접적인 Python 요구는 제거됐다. 다만 외부 `jurplel/install-qt-action`이 Qt SDK를 내려받는 과정에서 내부적으로 Python을 사용할 수 있으므로, 이는 runner 이미지에 Python 바이너리가 전혀 없다는 증거가 아니다. 일반 앱의 `find_package(Python3 REQUIRED)` 동작만 기본 경로에서 제외했다.

## 남은 별도 범위

- 일반 개발을 위한 Python 분리는 **구현 완료**, GIS 원본 DEM/Hydro/역사 경계 변환은 **이번에 한 번도 실행하지 않음**. GIS 오프라인 전수 테스트와 역사 recipe도 사용자 명시적 요청 시에만 실행하도록 남김.
- GitHub Actions의 `workflow_dispatch` UI는 워크플로가 기본 브랜치에 등록될 때까지 보이지 않을 수 있다. `main`에 병합하지 않았으므로 현재 확인된 것은 push 기반 GIS syntax CI 및 Python 런처 테스트뿐이다.
- 기존 독립 데이터 생성기, 저장된 국가 메시·수계 바이너리·해안선은 수정하지 않음. 정본·산출물의 종합 자동 갱신은 P7.
- 이전부터 남아 있던 수계 Qt 게이트의 Node `acorn` 패키지 준비 누락은 별도 CI 환경 오류이며, P4 Python 옵션과 혼동하지 않는다. 원인별 설치 보강은 `work/objects`에서 별도 반영.
- GUI 실 GPU/모바일 검증, 확장 성능 수용, 과거 Python 연구 근거의 정확성은 이번 P4 테스트 결과에 포함되지 않는다.

현재 `main` 병합·웹 배포·GIS 원본 재생성은 수행하지 않았다.
