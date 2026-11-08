# P4 — 원본 GIS 도구를 앱·웹 개발에서 격리

> **2026-11-03 현행 상태:** 프로젝트에서 추적하는 `.py`·`.pyw`·`.pyi`·`.ipynb`와 프로젝트 소유 Python 실행 경로는 0개다. 원본 GIS 처리는 Node.js/C++를 사용한다. `.github/workflows/gis-source-p4.yml`은 Python 재도입 방지와 소스 검사를 담당하고, 수동 `historical` 범위에서 C++ 역사 형상을 검증한다. 아래 2026-10-25 기록의 Python 호출·설치·보존 설명은 과거 진행 상황으로서 현행 실행 지침이 아니다.

최초 P4 설계 기준: `work/objects` (2026-10-14). 역사 국경, 지역별 연구 지도, 좌표계, 지형 DEM, 수계·호수, 지명 후보 가공은 **선택적 오프라인 연구 작업**이다. 일반 웹 개발·검증, Pages 배포, C++ core/WASM, WebView 앱의 기본 `BUILD_TESTING=ON`에는 Python이 필요하지 않다.

## 원본·제품 경계

- **일반 제품 경로:** `pnpm test`, `pnpm check:architecture`, `pnpm check:versioning`, `cmake --preset pando-core`, `ctest --preset pando-core`. GIS **생성물 읽기**는 가능하지만 원본을 새로 변환하지 않는다. 앱은 동일한 웹 산출물을 사용한다.
- **GIS Node/C++ 경로:** `.github/workflows/gis-source-p4.yml`은 `main` 및 기존 작업 브랜치의 관련 소스 변경에서 Python 파일·실행 경로 재도입, GIS Node CLI 및 격리 계약을 검사한다. `workflow_dispatch`의 `historical` 또는 `all`은 기존 C++/GEOS/PROJ 역사 형상 검사를 명시적으로 실행하며 Python 패키지를 설치하지 않는다.
- **역사 경계 C++ 교차검증:** 별도 GIS 워크플로의 `historical` 수동 실행으로 기존 conda-forge GEOS/PROJ 버전과 C++ recipe / 브라우저 JSON 증거 계약을 검사한다. 일반 Application Architecture 검사에서는 이 heavy job을 실행하지 않는다.
- **실제 데이터 가공:** CI 기본 경로에서는 **절대로** 실행하지 않는다. 대용량 ETOPO, HydroRIVERS, 역사 지도·GeoTIFF 원본은 외부 저장소 또는 별도 사용자가 제공한 파일로 유지하고, 개별 검증 후 정본 반영은 P7 승인 범위에서 한다. 선택적 실행은 아래와 같다.

## 명시적 GIS 작업 실행

GIS 생성기는 Node.js 24와 소스가 일치하는 C++ 실행 파일을 사용한다. 대상 작업에 따라 GDAL·GEOS·PROJ 같은 네이티브 라이브러리와 검증된 외부 원본이 필요할 수 있으나, 프로젝트 도구 실행을 위해 `numpy`, `rasterio`, `Shapely` 등의 Python 패키지를 설치하지 않는다.

```bash
# 대상 작업과 전달 인수만 표시. 아무 것도 생성하거나 다운로드하지 않음.
node scripts/gis/run-source.mjs --task terrain-dem -- \
  --etopo /external/ETOPO_2022.tif --tint-zip /external/HYP_HR.zip \
  --glaciated-areas /external/ice.geojson \
  --countries assets/data/countries-ne-5.1.1.geojson --output /external/dem-output

# 필요한 원본과 의존성을 별도로 준비한 뒤 사용자가 명시적으로 실행.
node scripts/gis/run-source.mjs --task terrain-dem --execute -- \
  --etopo /external/ETOPO_2022.tif --tint-zip /external/HYP_HR.zip \
  --glaciated-areas /external/ice.geojson \
  --countries assets/data/countries-ne-5.1.1.geojson --output /external/dem-output

# 수계 생성 작업의 실행 계획만 출력(실제 생성 안 함)
node scripts/gis/run-source.mjs --task hydro-tiles
```

호출 가능한 작업: `historical-border`, `historical-coast`, `terrain-dem`, `terrain-preview`, `hydro-tiles`, `hydro-packfile`, `hydro-connectivity`, `physical-data`, `place-candidates`. 지정된 원본 파이프라인은 인수·해시·원본 추적 정책을 기존 도구에서 처리하므로 래퍼가 파일 내용을 임의 변경하지 않는다. `--execute` 없이는 호출 계획만 표시한다. 이들 중 간척·해안선 가공은 **역사 타임라인 자동 조사에서 제외**된 별개 연구 작업이다.

## 기존 전용 GIS/조사 워크플로 구분

`world-dataset-stage3-gate.yml`의 JS·지도 번들 데이터 계약은 Python 인터프리터가 필요 없어 `setup-python` 단계를 제거했다. 과거 `pando-pretransfer-cleanup-gate.yml`의 고정 파일 수 감사를 일반 `work/gis` 변경과 분리해 수동 실행으로 유지한다.

`p4-immutable-mesh-assets.yml`, `build-hydro-packfile.yml` 및 북슐레스비히 연구 워크플로는 선택적 GIS 데이터 생성·검증 작업으로 구분된다. 현행 실행 코드는 Node.js/C++ 기반이며 해당 워크플로에서 Shapely 등 Python 설치를 전제로 하지 않는다. 전체 원본 재생성 및 실자료 동등성 검증은 별도 작업이다.

## 2026-10-25 시아첸 일회성 조사 코드 정리

> **이하 이행 당시 기록:** `현재`, `남은 Python`, `test:gis-python` 같은 표현은 2026-10-25 전후의 당시 상태를 가리킨다. 2026-11-03 현행 실행 안내는 위 절을 따른다.

시아첸 연구용 Python 스크립트 8개와 전용 GitHub Actions 8개, 공통 GIS 수동 실행기의 `historical-topography-probe` 작업은 종료했다. 당시 보관한 상세 연구자료도 2026-10-28의 1:10M 범위 정리에서 폐기했다. 현재는 [핵심 조사 기록과 Natural Earth 1:10M 분쟁지역 참조](https://github.com/kimjeon-il/PandoLab-library-data/tree/main/reports/borders/reconstruction/siachen)만 유지한다. 과거 Git 이력, 앱·웹 런타임과 공통 GIS 생성기는 유지한다.

## 2026-10-25 2차 GIS/Python 정리

- 과거 v0.12.6~v0.30.8 UI·런타임 소스 문자열 검사 중 Node/C++ 회귀 검사와 겹치는 Python 검사를 정리했다. 현재의 Node 단위·브라우저·공통 Core 검사는 그대로 유지한다.
- 원본이 Git 이력에 고정된 구형 Hydro v0.12.3~v0.12.5 복원·재패킹·보고 도구와 전용 Actions 검사는 종료했다. 기존 아카이브 데이터 및 보고서는 삭제하지 않았다.
- 호출처가 없는 일회성 수계 wrapper, 인도네시아 섬 감사, preview topology 진단, DEM peak-memory 측정, LSIB 보고서 생성기를 제거했다. 현재 Hydro/DEM/국경 생성기와 독립 형상 검증은 유지한다.
- 독일제국·북슐레스비히 원본 수집 및 WMS 오버레이 연구 도구는 역사 지도 이미지의 영구 보존·최종 반영 여부가 확정되지 않아 유지한다. OSM 수계 독립 출처 대체 도구도 진행 중인 작업에 필요하므로 유지한다.
- 기존 실행기가 사용하는 소스 추출 헬퍼와 독립적인 동독·보르네오·LSIB·수계 Python 검사는 보존했다.

## 2026-10-25 Node.js 오프라인 도구 이전 1단계

- `tools/download-terrain-source.py`를 `tools/gis/download-terrain-source.mjs`로 교체했다. HTTP 206·Content-Range·원본 변경 검사를 유지하며 실패 시 기존 부분 다운로드 파일을 보존한다.
- `tools/build-hydro-packfile.py`를 `tools/build/build-hydro-packfile.mjs`로 교체했다. 원본 압축 조각의 해시·길이·offset 동등성을 검증한다. 과거 데이터 재생성 Actions는 변경된 현재 수계 명칭을 덮어쓰지 않고 임시 공간에 재현한다.
- `tools/place-batch-pipeline.py`의 audit/plan/finalize를 `tools/gis/place-batch-pipeline.mjs`로 전환했다. 출처 해시, 조사 여부, 중복 ID, 날짜·명칭, 신규 파일 생성 제한을 Node 회귀 검사로 유지한다.
- 기존 Python 전용 테스트 `tests/python/test_library_writers.py`, `tests/test_place_batch_pipeline.py`는 Node 테스트로 대체했다. `library_data.py`와 `report_paths.py`는 다른 Python 생성기와의 호환을 위해 유지한다.
- 대규모 GeoNames 후보 도구는 `build-place-candidates.mjs`의 ZIP CRC/streaming·원본 해시·후보 포함 정책·ID별 review 테스트로 대체한다. 기존 Python 검사의 계약은 Node 테스트로 이관했으며 실데이터 재생성은 별도 원본 필요. 남은 GIS/DEM/AI 학습 코드도 이번 Node 전환에서 제외한다.

## A0~A2 Node 실행 정리 (2026-10-25)

`scripts/gis/run-source.mjs`가 기존 GIS 실행기의 default dry-run 및 명시적 `--execute`를 소유한다. Node로 이식된 명령(`hydro-packfile`, `place-candidates`)은 Node 프로세스로 실행하고, 아직 미이식 GIS 원본은 독립 Python CLI를 호출한다. `scripts/summarize-boundary-capture-evidence.mjs`가 기존 trace·diagnostics 계약을 Node에서 수행한다. `report-paths.mjs`에는 Python의 `report_argument` 동작과 같은 `reportArgument`가 추가되었다.

A2에서 Python 실행기와 중복 Python 테스트 6개를 제거했다. 후속 정리에서 잠금 동기화 Python 회귀 검사를 Node로 이전해 추가 1개를 삭제하고, 수계 Python 테스트의 `tests.application_source` 의존성을 직접 파일 읽기로 제거했다. 다만 `library_data.py`, `report_paths.py`, `tests/application_source.py`는 나머지 GIS·AI 생성기/검사의 호출자가 제거되지 않았으므로 후속 B/C/E 전환 시 해당 호출처와 동시에 정리한다. 영구적으로 남기는 항목은 아니다.

## 2026-11-03 현재 권장 검사

```bash
git ls-files '*.py' '*.pyw' '*.pyi' '*.ipynb'
node --test tests/unit/python-bridge-retirement.test.mjs tests/unit/gis-source-isolation.test.mjs
pnpm test:gis-node
```

위 검사는 정적 코드·실행 계약을 확인한다. 공식 HydroRIVERS/ETOPO 전체 원본 재현, 외부 SDK 설치 상태, 실제 GPU·Windows 기기 성능까지 증명하지는 않는다.

## 남겨둔 테스트와 안전 규칙

- `package.json`의 과거 `test:python`/새 `test:gis-python`은 **수동 실행 전용**. 기본 `pnpm test`에서 삭제했다. `check:versioning`의 프로젝트 스키마 점검은 동일 역할의 Node 단위검사 `tests/unit/versioning-source-schema.test.mjs`로 옮겼다.
- 전용 GIS workflow는 앱·웹 Pages 배포에 종속되지 않는다. GIS/legacy Python 전수검사는 별도 manual scope에서 수행한다. 완료된 일회성 연구 스크립트·전용 워크플로는 산출물 보존을 확인한 뒤 정리한다.
- 외부 원본 GIS 생성물의 해시/출처, 지도 로딩 시점 및 시각적 표시는 이번 P4에서 변경하지 않는다. P5/P6의 C++ 이전을 기다리지 않고 Python 의존성만 분리한다.
- **검증 한계:** CI의 `setup-python` 제거와 CMake 옵션 검사만으로 앱 동적 화면/Windows 포괄 검증을 증명하지 못한다. 실제 CTest·브라우저·GIS syntax 실행 결과를 보고 성공 범위를 별도 구분한다.
