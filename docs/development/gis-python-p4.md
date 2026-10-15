# P4 — 원본 GIS Python 가공을 앱·웹 개발에서 격리

기준 브랜치: `work/objects` (2026-10-14). 역사 국경, 지역별 연구 지도, 좌표계, 지형 DEM, 수계·호수, 지명 후보 가공은 **선택적 오프라인 연구 작업**이다. 일반 웹 개발·검증, Pages 배포, C++ core/WASM, Windows/Linux Qt 앱의 기본 `BUILD_TESTING=ON`에는 Python이 필요하지 않다.

## 원본·제품 경계

- **일반 제품 경로:** `pnpm test`, `pnpm check:architecture`, `pnpm check:versioning`, `cmake --preset pando-native-qt-ci-linux` 및 `pando-native-qt-ci-windows`, `ctest --preset ...`. GIS **생성물 읽기**는 가능하지만 원본을 새로 변환하지 않는다. Qt는 P5/P6 이전까지 기존 Node·Acorn 경로를 유지한다.
- **GIS Python 경로:** `.github/workflows/gis-python-p4.yml`은 `work/gis`, `work/objects`의 **Python 소스·의존성·전용 워크플로 변경**에서만 가벼운 문법·GIS launcher 단위검사를 수행한다. `workflow_dispatch`에서 `contracts`를 지정할 때만 GDAL 계열 Python 라이브러리(현행 Shapely/pyproj, rasterio/numpy 등)를 설치하고 root/terrain Python 테스트를 수행한다.
- **역사 경계 C++ 교차검증:** 별도 GIS 워크플로의 `historical` 수동 실행으로 기존 conda-forge GEOS/PROJ 버전과 C++ recipe / 브라우저 JSON 증거 계약을 검사한다. 일반 Application Architecture 검사에서는 이 heavy job을 실행하지 않는다.
- **실제 데이터 가공:** CI 기본 경로에서는 **절대로** 실행하지 않는다. 대용량 ETOPO, HydroRIVERS, 역사 지도·GeoTIFF 원본은 외부 저장소 또는 별도 사용자가 제공한 파일로 유지하고, 개별 검증 후 정본 반영은 P7 승인 범위에서 한다. 선택적 실행은 아래와 같다.

## 명시적 GIS 작업 실행

Python 3.12 환경에서 필요한 경우에만 개별 도구의 원본 의존 라이브러리를 준비한다. 테스트만 하는 경우 앱·웹에는 rasterio, GDAL, pyproj, Shapely를 설치하지 않는다.

```bash
# 대상 작업과 전달 인수만 표시. 아무 것도 생성하거나 다운로드하지 않음.
python scripts/gis/run-source.py --task terrain-dem -- \
  --etopo /external/ETOPO_2022.tif --tint-zip /external/HYP_HR.zip \
  --glaciated-areas /external/ice.geojson \
  --countries assets/data/countries-ne-5.1.1.geojson --output /external/dem-output

# 필요한 원본과 의존성을 별도로 준비한 뒤 사용자가 명시적으로 실행.
python scripts/gis/run-source.py --task terrain-dem --execute -- \
  --etopo /external/ETOPO_2022.tif --tint-zip /external/HYP_HR.zip \
  --glaciated-areas /external/ice.geojson \
  --countries assets/data/countries-ne-5.1.1.geojson --output /external/dem-output

# 특정 수계/역사/지명 도구 목록 확인
python scripts/gis/run-source.py --help
```

호출 가능한 작업: `historical-border`, `historical-coast`, `historical-topography-probe`, `terrain-dem`, `terrain-preview`, `hydro-tiles`, `hydro-packfile`, `hydro-connectivity`, `physical-data`, `place-candidates`. 지정된 원본 파이프라인은 인수·해시·원본 추적 정책을 기존 도구에서 처리하므로 래퍼가 파일 내용을 임의 변경하지 않는다. `--execute` 없이는 호출 계획만 표시한다. 이들 중 간척·해안선 가공은 **역사 타임라인 자동 조사에서 제외**된 별개 연구 작업이다.

## 선택형 Qt Python 회귀검사 보존

현재 Python 기반 M6 GIS 오라클과 M974 C++ 경계 검사, M972 river adapter 재현은 버리지 않는다. `native/app/CMakeLists.txt`의 `PANDOEDITOR_ENABLE_PYTHON_ORACLES=ON`을 **명시적으로** 켠 CMake 테스트 구성에서만 등록한다. `OFF`(기본)일 때 CMake는 Python을 탐색하지 않으며 기본 Qt CTest 타깃 3개, QML 스모크, C++ core, 앱 빌드를 계속 수행한다. Node-only M972 회귀는 일반 CI에서 Python 하위 검사를 `SKIP`으로 명시하며, 옵션을 활성화하면 별도 Python adapter 테스트가 실행된다.

개별 Python 오라클 검증 예시(별도 GIS/레거시 runner에서 Python 설치 후):

```bash
cmake -S . -B build-native/p4/qt-python-oracles -DPANDO_BUILD_VARIANT=native -DPANDOEDITOR_BUILD_APP=ON -DBUILD_TESTING=ON -DPANDOEDITOR_ENABLE_PYTHON_ORACLES=ON
cmake --build build-native/p4/qt-python-oracles --target m974_boundary_probe
ctest --test-dir build-native/p4/qt-python-oracles -R 'm974_(regression_gate_tests|boundary_delivery_tests)'
```

GitHub Actions의 `workflow_dispatch` 수동 실행 UI는 해당 workflow가 저장소의 기본 브랜치에 등록되어 있어야 노출될 수 있다. 현재 `work/objects`에만 반영된 P4 상태에서는 **자동 경량 GIS Python source 검사만 검증**된 상태이며, `contracts`/`historical` 수동 실행 버튼이 GitHub UI에 제공된다고 보장하지 않는다. 사용자 승인 없는 `main` 병합은 진행하지 않는다. 연구 작업은 위 Python launcher로 명시적으로 실행할 수 있다.

## 기존 전용 GIS/조사 워크플로 구분

`world-dataset-stage3-gate.yml`의 JS·지도 번들 데이터 계약은 Python 인터프리터가 필요 없어 `setup-python` 단계를 제거했다. 과거 `pando-pretransfer-cleanup-gate.yml`의 고정 파일 수 감사를 일반 `work/gis` 변경과 분리해 수동 실행으로 유지한다.

`p4-immutable-mesh-assets.yml`, `build-hydro-packfile.yml` 및 일부 북슐레스비히·자헨 연구 워크플로는 독립된 데이터 생성·역사 연구 소스에 연결된 **전문 GIS 생성 작업**이므로 지우지 않았다. 특히 `p4-immutable-mesh-assets.yml`은 GPU 메쉬 알고리즘 자체가 바뀔 때만 Shapely를 설치하여 메시 생성물을 갱신한다. 이는 일반 UI 변경·웹 배포 경로의 Python 의존성이 아니라 **생성기 소스 자체가 바뀌는 작업**이다. 모든 GIS 생성기를 단일 체계로 통합하는 작업은 P7이다.

## 남겨둔 테스트와 안전 규칙

- `package.json`의 과거 `test:python`/새 `test:gis-python`은 **수동 실행 전용**. 기본 `pnpm test`에서 삭제했다. `check:versioning`의 프로젝트 스키마 점검은 동일 역할의 Node 단위검사 `tests/unit/versioning-source-schema.test.mjs`로 옮겼다.
- 전용 GIS workflow는 앱·웹 Pages 배포에 종속되지 않는다. GIS/legacy Python 전수검사는 별도 manual scope에서 수행한다. 과거 연구 워크플로·증거는 이동·삭제하지 않는다.
- 외부 원본 GIS 생성물의 해시/출처, 지도 로딩 시점 및 시각적 표시는 이번 P4에서 변경하지 않는다. P5/P6의 C++ 이전을 기다리지 않고 Python 의존성만 분리한다.
- **검증 한계:** CI의 `setup-python` 제거와 CMake 옵션 검사만으로 Qt 동적 GUI/Windows 포괄 검증을 증명하지 못한다. 실제 CTest·브라우저·GIS syntax 실행 결과를 보고 성공 범위를 별도 구분한다.
