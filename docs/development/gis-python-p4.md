# P4 — 원본 GIS Python 가공을 앱·웹 개발에서 격리

기준 브랜치: `work/objects` (2026-10-14). 역사 국경, 지역별 연구 지도, 좌표계, 지형 DEM, 수계·호수, 지명 후보 가공은 **선택적 오프라인 연구 작업**이다. 일반 웹 개발·검증, Pages 배포, C++ core/WASM, WebView 앱의 기본 `BUILD_TESTING=ON`에는 Python이 필요하지 않다.

## 원본·제품 경계

- **일반 제품 경로:** `pnpm test`, `pnpm check:architecture`, `pnpm check:versioning`, `cmake --preset pando-core`, `ctest --preset pando-core`. GIS **생성물 읽기**는 가능하지만 원본을 새로 변환하지 않는다. 앱은 동일한 웹 산출물을 사용한다.
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

호출 가능한 작업: `historical-border`, `historical-coast`, `terrain-dem`, `terrain-preview`, `hydro-tiles`, `hydro-packfile`, `hydro-connectivity`, `physical-data`, `place-candidates`. 지정된 원본 파이프라인은 인수·해시·원본 추적 정책을 기존 도구에서 처리하므로 래퍼가 파일 내용을 임의 변경하지 않는다. `--execute` 없이는 호출 계획만 표시한다. 이들 중 간척·해안선 가공은 **역사 타임라인 자동 조사에서 제외**된 별개 연구 작업이다.

## 기존 전용 GIS/조사 워크플로 구분

`world-dataset-stage3-gate.yml`의 JS·지도 번들 데이터 계약은 Python 인터프리터가 필요 없어 `setup-python` 단계를 제거했다. 과거 `pando-pretransfer-cleanup-gate.yml`의 고정 파일 수 감사를 일반 `work/gis` 변경과 분리해 수동 실행으로 유지한다.

`p4-immutable-mesh-assets.yml`, `build-hydro-packfile.yml` 및 일부 북슐레스비히 연구 워크플로는 독립된 데이터 생성·역사 연구 소스에 연결된 **전문 GIS 생성 작업**이므로 지우지 않았다. 특히 `p4-immutable-mesh-assets.yml`은 GPU 메쉬 알고리즘 자체가 바뀔 때만 Shapely를 설치하여 메시 생성물을 갱신한다. 이는 일반 UI 변경·웹 배포 경로의 Python 의존성이 아니라 **생성기 소스 자체가 바뀌는 작업**이다. 모든 GIS 생성기를 단일 체계로 통합하는 작업은 P7이다.

## 2026-10-25 시아첸 일회성 조사 코드 정리

시아첸 연구용 Python 스크립트 8개와 전용 GitHub Actions 8개는 `work/gis`에서 정리했다. 공통 GIS 수동 실행기에서 폐기된 `historical-topography-probe` 작업도 제거했다. 지도 PNG 22개, GeoJSON 11개, Markdown 보고서 13개, JSON 분석 자료 8개는 [외부 라이브러리의 시아첸 보고서 폴더](https://github.com/kimjeon-il/PandoLab-library-data/tree/main/reports/borders/reconstruction/siachen)에 그대로 보관한다. 기존 조사 코드는 Git 이력에서 복구할 수 있다. 앱·웹 런타임과 공통 GIS 생성기는 변경하지 않았다.

## 2026-10-25 2차 GIS/Python 정리

- 과거 v0.12.6~v0.30.8 UI·런타임 소스 문자열 검사 중 Node/C++ 회귀 검사와 겹치는 Python 검사를 정리했다. 현재의 Node 단위·브라우저·공통 Core 검사는 그대로 유지한다.
- 원본이 Git 이력에 고정된 구형 Hydro v0.12.3~v0.12.5 복원·재패킹·보고 도구와 전용 Actions 검사는 종료했다. 기존 아카이브 데이터 및 보고서는 삭제하지 않았다.
- 호출처가 없는 일회성 수계 wrapper, 인도네시아 섬 감사, preview topology 진단, DEM peak-memory 측정, LSIB 보고서 생성기를 제거했다. 현재 Hydro/DEM/국경 생성기와 독립 형상 검증은 유지한다.
- 독일제국·북슐레스비히 원본 수집 및 WMS 오버레이 연구 도구는 역사 지도 이미지의 영구 보존·최종 반영 여부가 확정되지 않아 유지한다. OSM 수계 독립 출처 대체 도구도 진행 중인 작업에 필요하므로 유지한다.
- 기존 실행기가 사용하는 소스 추출 헬퍼와 독립적인 동독·보르네오·LSIB·수계 Python 검사는 보존했다.

## 남겨둔 테스트와 안전 규칙

- `package.json`의 과거 `test:python`/새 `test:gis-python`은 **수동 실행 전용**. 기본 `pnpm test`에서 삭제했다. `check:versioning`의 프로젝트 스키마 점검은 동일 역할의 Node 단위검사 `tests/unit/versioning-source-schema.test.mjs`로 옮겼다.
- 전용 GIS workflow는 앱·웹 Pages 배포에 종속되지 않는다. GIS/legacy Python 전수검사는 별도 manual scope에서 수행한다. 완료된 일회성 연구 스크립트·전용 워크플로는 산출물 보존을 확인한 뒤 정리한다.
- 외부 원본 GIS 생성물의 해시/출처, 지도 로딩 시점 및 시각적 표시는 이번 P4에서 변경하지 않는다. P5/P6의 C++ 이전을 기다리지 않고 Python 의존성만 분리한다.
- **검증 한계:** CI의 `setup-python` 제거와 CMake 옵션 검사만으로 앱 동적 화면/Windows 포괄 검증을 증명하지 못한다. 실제 CTest·브라우저·GIS syntax 실행 결과를 보고 성공 범위를 별도 구분한다.
