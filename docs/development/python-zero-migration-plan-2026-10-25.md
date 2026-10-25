# Python 완전 제거 로드맵 — 판도연구소

> **기준:** 2026-10-25, `work/gis` 커밋 `61aa02a9fd098237f7ced6601db76ab4f94eeb65`  
> **상태:** 구현 전 계획. 이 문서 작성은 코드·자료·CI 변경을 뜻하지 않음.  
> **대상:** 저장소에 추적된 Python `.py` **101개 전수**. 5개 전환 묶음에 누락·중복 없이 분류함.  
> **결론:** 남겨두기라는 최종 상태는 없음. *기능을 다른 언어로 이식*하거나 *일회성 작업은 결과의 영구 보존·검증 후 원본 스크립트와 Actions를 종료*함.

## 실행 현황 — A0~A2 (2026-10-25)

- **A0:** `work/gis`에 `gis-node-migration.yml`을 추가하고 기존 Node 생성기 3종 회귀 테스트 실행 통과 ([Actions 40170378584](https://github.com/kimjeon-il/Pando/actions/runs/40170378584)).
- **A1:** `build-place-candidates.py`를 Node 정책·ZIP streaming/CRC·review/감사 모듈로 이전하고 Python 테스트를 Node 24개 테스트로 대체. `fetch/build/review` 명령, dry-run와 source checksum, ID별 evidence, 현대 데이터의 역사적 도시 승인 금지를 검증 ([Actions 40171323978](https://github.com/kimjeon-il/Pando/actions/runs/40171323978)).
- **A2 1차:** Node GIS launcher, reportArgument, 브라우저 캡처 trace 분석, 폰트·함수 소스 단위 테스트로 Python CLI/테스트 6개 교체. [Actions 40171812270](https://github.com/kimjeon-il/Pando/actions/runs/40171812270) 통과.
- **A2 잔여 정리 2차:** `tests/test_v0306_layer_lock_sync.py`의 잠금 검색 동기화 검사를 `tests/unit/layer-lock-sync.test.mjs`로 이관하고 Python 원본을 삭제. `tests/test_hydro_tiles.py`는 JS 환경값 파일을 직접 읽도록 바꿔 `tests.application_source`에 의존하지 않음. 반복된 Node 워크플로 경로 항목도 정리. 현재 `tests/application_source.py`의 직접 호출자는 `tests/test_v0280_historical_library.py`이며 해당 역사 데이터 검사는 후속 C 단계에서 Node로 이전 후 제거한다.
- **현재:** 처음 101개 중 9개 삭제, **92개 Python** 잔존. 지도·AI·국경 생성기, 외부 원본·런타임은 미변경. 테스트 합격은 고정 synthetic fixture에 대한 것이며 전 세계 GeoNames 원본 바이트 전수 비교를 대신하지 않는다.
- **A2 의존성 차단 (삭제 선택지 없음):** `tools/library_data.py`(C/B Python 원본 생성기의 Node lease 호출), `tools/report_paths.py`(C/E Python의 보고서 경로), `tests/application_source.py`(B/C Python 테스트) 3개는 소비자가 아직 Python이다. *다음 B/C/E 변환 단위마다* 해당 사용처를 C++/Node로 옮기고, 마지막 사용처가 사라지는 커밋에서 래퍼/헬퍼를 삭제한다. 단순 파일 삭제로 CI나 데이터 출처를 깨지 않는다.
- **후속 단계:** B=Hydro·DEM 28개, C=역사국경 38개, D=QGIS·래스터 5개, E=AI 19개. A2의 세 파일은 이 그룹 안의 호출자 정리로 함께 제거되며 최종 검사 `git ls-files '*.py' '*.pyi' '*.ipynb'`는 0이어야 한다.

## 0. 범위와 불변 조건

1. **최종 완료:** 현재 저장소 `git ls-files '*.py' '*.pyi' '*.ipynb'` 0개. 저장소 소유의 Python CLI·테스트·Actions 인라인 Python·문서의 실행 명령을 모두 Node.js/네이티브 C++/CTest로 교체. `package.json`의 `test:python`·`test:gis-python`, `.python-version`, Python 전용 `requirements*.txt`·`setup-python` 같은 프로젝트 전용 자산을 사용처 없는 순서에 맞춰 정리.
2. **외부 도구 예외를 완료로 오인하지 않음:** QGIS, Emscripten, 빌드 도구가 내부적으로 Python을 탑재할 수 있지만 이것은 프로젝트에서 Python 스크립트를 실행하거나 배포하는 것과 구분해 기록. 프로젝트가 관리하는 QGIS Python 플러그인·AI Python 실행 경로는 네이티브 코드로 대체.
3. **사용자 산출물 무변경:** 역사 지도·GeoJSON·원본 압축 자료·출처·라이선스·단축 보고서·기존 도심 표기·런타임 바이너리를 계획 단계에서 수정하지 않음. 기존 증거는 외부 `PandoLab-library-data`와 아카이브에 보존. 임시 Actions 아티팩트만 남은 지도는 영구 보존 가능 여부와 재배포권을 확인한 뒤 코드 종료.
4. **기존 설계 유지:** 앱/웹 동일 `shared/core` 계산 정본, `tools/cpp` 네이티브 GIS 생성기, 자료 처리·보고서·CLI는 Node. GDAL·GEOS·PROJ·LibTorch·QGIS SDK 같은 무거운 종속성은 기본 WASM/앱 빌드에 링크하지 않고 독립 네이티브 빌드로 분리.
5. **작업 단위:** 전환 대상별로 기존 Python에서 입력·출력·오류·해시 oracle을 먼저 고정 → Node/C++ 구현 → 동등성 검사 → 호출처·테스트·문서·Actions를 같은 커밋에서 전환 → Python 삭제. 각 작업 범위 이외의 리팩터링 금지.
6. **검증 현실화:** 직전 Node 전환 커밋 `61aa02a`의 수계 패키지 Range 전용 CI는 성공했지만 다른 광역 CI에는 실패/취소가 있음. 선행 회귀와 작업 유발 오류를 구분한 기준표를 만들고, 신규 도구의 실제 Node 테스트 3개를 먼저 실행한 뒤 다음 전환에 진입. 단순 구문 검사만으로 통과 선언 금지.

## 1. 단기 작업: Node 기반 파이프라인·래퍼 (A: 11개)

### A0. 선행 회귀 고정

- 직전 전환의 `pnpm test:gis-node` 또는 `node --test` 3개(다운로드, Hydro packfile, 도시 배치)를 **실행하여** 테스트 로그와 실패원인 확정. 같은 입력에서 실제 반환·예외·SHA·파일 쓰기 안전성 검사. `World Dataset Stage 3 Gate`의 기저 실패도 별도 기록.
- Node 24·pnpm 락파일 고정. Python 데이터 oracle은 기존 커밋의 **임시 작업 디렉터리**에서만 실행하고 앱 데이터나 승인 조사결과는 건드리지 않음.

### A1. GeoNames 후보 생성기: `tools/build-place-candidates.py` → `tools/build-place-candidates.mjs`

- 원본 경계: `cities500.zip` 우선, `allCountries.zip` 대체/커버리지 감사; `fetch → build → review` 명령, 명시적 공식 출처·라이선스·ETag/Last-Modified·다운로드 ZIP SHA·ZIP 내부 파일 CRC 보존.
- 구현: Node 24 스트리밍 ZIP reader(직접 pin된 안전한 ZIP 라이브러리와 CRC 검증), `readline` 기반 NDJSON 스트리밍, 정수/유니코드·현대 feature-code/poplulation 선별, 안전한 원본 캐시·임시 파일 승격. 기존 `download-terrain-source.mjs`를 재사용하고 대용량 ZIP 전체 메모리 로딩 금지.
- **테스트 23개 계약 전환:** 인구 0, 행정 코드, 비채택 코드, 별칭·이름 중복 및 동명이촌, invalid coordinates, 현대 국가코드, SHA 불일치, 원본 변경·ZIP CRC 불일치, fallback, 검토 원장 ID 단위 retain/hold/exclude와 출처 일치, 생성물 불변성. `tests/test_place_candidates.py`를 `tests/unit/place-candidates.test.mjs` 및 고정 ZIP fixture로 이관.
- 완료: 같은 고정 ZIP·정책표에서 후보 **ID 집합/순서, 포함·제외 결정, 통계, 리뷰 요약, NDJSON 의미·가능한 바이트 결과** 동등성 확인. 현대 인구·국가코드로 역사적 신분·위계 추론 금지. 실제 공식 자료가 없는 CI에서는 fixture 검사만 통과로 기록하고 전 세계 실데이터 동등성을 통과로 간주하지 않음.

### A2. 파이프라인·도구 소유권 단일화

- `tools/library_data.py`는 기존 `tools/library-data.mjs`의 `withLibraryOutputs` 등으로 호출처를 **먼저** 전환하고 삭제. `tools/report_paths.py`는 `tools/report-paths.mjs`에 `reportArgument`/형제 파일 경로 처리까지 포팅하고 호출처 전환 후 삭제. 외부 라이브러리 권한 lease, hydration, 쓰기/원본 보존, 브랜치별 경로를 동일 계약으로 검사.
- `scripts/gis/run-source.py` → `scripts/gis/run-source.mjs`: Node/native 허용목록, `--execute` 명시 동의 및 기본 dry-run, 저장소 경계/인수 이스케이프, 작업 원본 경로 검증. Python 생성기 대상은 대체 실행 파일이 준비되는 즉시 목록 교체하고 **마지막 Python 대상 교체 후** `.py` 실행기 삭제.
- `scripts/summarize-boundary-capture-evidence.py` → Node 파일 요약기: ZIP·trace 크기 상한, 해시/컨텍스트 추출, 원본 불변성과 기존 캡처 비교 테스트 유지.
- `tests/application_source.py`, `tests/test_application_source.py`, `tests/test_font_assets.py`, `tests/test_p4_gis_runner.py`, `tests/test_report_paths.py`: 현재 Node `scripts/lib/application-source.mjs`, 보고서·폰트·CLI 검사에 통합. `tests/application_source.py`는 역사/수계 Python 테스트가 마지막으로 교체될 때 삭제. `package.json`·관련 Actions·문서 참조를 동시 수정.
- 완료: Node 외부 라이브러리 write lease·보고서 경로·dry-run 계약이 통과하고 이 묶음의 Python이 0개.

## 2. C++ GIS + Node 분석: 수계·지형 (B: 28개)

### B1. Hydro 검증·명칭 데이터 파이프라인

- `tools/inventory-hydro-names.py`, `tools/inventory-osm-hydronyms.py`, `tools/gis/hydro_independent_name_policy.py`, `tools/gis/prepare_hydro_name_replacement_bundle.py`: Node로 옮겨 기존 `decode-hydro-connectivity.mjs`, 명칭 검토/승격 스크립트와 하나의 소유자로 정리.
- `tools/gis/check_official_usgs_hydro_gauges.py`, `compare_osm_hydro_natural_earth.py`, `verify_independent_river_point_anchors.py`, `verify_osm_hydro_batch01/02/03_points.py`, `verify_victorian_yarra_source.py`: HTTP·출처·보고서 처리 Node + 선형·점간 거리/교차·좌표 변환 C++ GIS utility. 출처 식별은 근접한 점만으로 강 전체의 동일성을 확정하지 않는 기존 정책 유지. OSM 출처 교체가 끝난 일회성 배치는 **최종 조사결과 보존 후 제거**하고 Node/C++ 공통 검사만 유지.
- 해당 Python 수계 검증 테스트는 Node/CTest로 포팅하고, ODbL/출처 기록 및 독립 자료 해시/명칭 변경 범위가 어긋나면 배포 차단.

### B2. Hydro 지오메트리 계산

- `tools/build-hydro-tiles.py`, `tools/calibrate-hydro.py`, `tools/hydro_connectivity.py`, `tools/repair-hydro-connectivity.py`, `tools/verify-hydro-connectivity.py` → `tools/cpp/hydro/*`의 GDAL/GEOS 네이티브 코드 + Node 드라이버. 최종 하천 연결·해안 접속·유역 중요도·단계/표시 기준·논리 수계 ID·자원 순서·좌표 1e-6° 양자화/varint 포맷을 그대로 유지.
- 후보→본류·지류 경로, 하구/내륙 종점, border-aligned 구간 및 연결 실패 항목에 대해 샘플 + 고정 원본 전수 재생성 테스트. 시스템 ID, 객체 수, 좌표·위상, 바이트/manifest 해시(해당 산출물이 완전 결정적인 경우), 허용된 형식 버전의 명시적 이관을 검사.
- 기존 수계 JS 런타임·WASM은 바꾸지 않으며 GIS용 GDAL/GEOS를 WASM에 유입시키지 않는다.

### B3. DEM·물리 지형 생성

- `tools/build-physical-data.py`, `tools/build-terrain-dem.py`, `tools/build-terrain-preview.py`, `tools/verify-terrain-dem.py` → GDAL C++ Warp/Window, native PNG/WebP encoder(버전 pin), Node 산출물 관리/검증.
- 고정 ETOPO/색상 tint, mask·NoData, 극지 gutter, LOD 0–5, PNG/WebP RGBA와 투명도, 해시/manifest, 저장소 외부 대용량 파일을 검증. 픽셀 의미 동등성과 바이너리 byte 동등성은 분리해 기록. 인코더 차이가 있으면 검토된 별도 재생성 커밋에서만 manifest 갱신.
- `tests/python/test_build_terrain_*.py`, 수계 Python 테스트를 각각 Node 고정 입력·CTest C++ 연산 검사로 옮긴 후 삭제.

## 3. 역사 GIS·국경 생성/일회성 조사 마감 (C: 38개)

### C1. 계속 사용할 영토 재구성 엔진

- 독일 1914 기본·현대 해안 후보, 북슐레스비히 후보, Cecilienkoog 및 소련/카스피해·LSIB 생성/보정 함수 → 기존 `tools/cpp/build-territorial-recipe.cpp` 중심의 GEOS/PROJ C++ 기능으로 합치고 Node가 조사 출처·원본 해시·레시피·보고서를 관리.
- 구체적으로 `build_german_empire_1914_base.py`, `build_german_empire_1914_modern_coast.py`, `build_north_schleswig_1914_001_026.py`, `build_german_cecilienkoog_1905_provisional.py`, `tools/gis/apply_ussr_1922_caspian.py`, `supplement-lsib-boundaries.py`를 대체하는 네이티브 명령·레시피를 작성. 유지할 다른 형태의 도구가 없더라도 Python 파일은 0으로 만듦.
- 기존 source ZIP·라이선스·시점(1801년 이후)·확정/잠정 표시·도법/축척(Natural Earth 1:10M)·위상·경계 미확정 지점과 증거를 보존. 미세한 좌표 보정을 자동 승인하지 않음.

### C2. 원본 수집/일회성 이미지 조사 정리

- `fetch-east-germany-sources.py`, `fetch_german_empire_1914_source.py`, `fetch_north_schleswig_1864_west_sources.py`, `collect_north_schleswig_1914_001_026.py`, `discover_north_schleswig_1914_map_services.py` → Node 안전 수집·출처 메타데이터·해시/캐시 도구로 통합.
- `audit_north_schleswig_*`, `check_north_schleswig_1914_slub_wms.py`, `probe_*`, `render_*`, `review_*`, `verify_north_schleswig_*`는 각 도엽·국경 구간에 대해 **영구 보존된 지도/GeoJSON + 요약 보고서 + 출처/해시 + 미확정 여부** 확인 후 전용 스크립트와 대응 Actions를 제거한다. 재사용되는 WMS·좌표/화면 오차 검사 코드는 Node+네이티브 공통 모듈로 흡수한다. 임시 Actions 이미지의 소멸을 보고서 보존으로 오인하지 않는다.
- `tools/gis/baikonur_official_reference.py`, `tools/gis/report_ussr_1922_caspian.py`는 Node 근거·리포트 도구로 이전하고, `verify-lsib-country-sources.py`, `verify-lsib-screen-delta.py`는 네이티브 지오메트리 검사로 이전.
- 역사/영토 Python 검사 8개는 Node/CTest에 동등성 계약을 옮긴 뒤 제거. 사용하지 않는 별도 조사 스크립트도 **그대로 남겨두지 않고** 증거 보존 절차를 밟아 종료한다.

## 4. 외부 어댑터도 Python 없이 교체 (D: 5개)

- `tools/qgis/bootstrap.py`, `tools/qgis/bridge.py`: 현 QGIS Python 플러그인 부트스트랩·QGIS MCP 클라이언트 의존을 제거. Qt/QGIS 네이티브 C++ 엔드포인트에서 `start/status/open/export/normalize`, EPSG:4326, GeoJSON, QVariantMap 필드·ID·CRS·기존 파일 덮어쓰기 금지와 인증 루프백을 구현하고 Node MCP/CLI 어댑터로 연결. 현 문서가 제공하는 QGIS MCP 27개 동작의 실제 사용처를 선별하여 대체 명령 매핑·회귀 기준을 수립한다. 모든 사용 기능을 이식하기 전 구형 플러그인 의존을 끊지 않는다.
- `plugins/pando-map-tools/lib/raster.py`: PNG/JPEG/EXIF·crop/resize/alpha는 Node 고정 버전 이미지 처리, PDF 페이지·MuPDF 관련 기능은 네이티브 MuPDF C/C++ helper로 대체. 기존 stdin JSON 헤더 + newline + RGBA/PNG 바이너리 stdout, 16MP 입력 제한과 실패 처리를 보존.
- `tests/python/test_qgis_bridge.py`, `tests/test_map_plugin_raster.py`는 Node/CTest+실제 QGIS 설치 환경 smoke(별도 실행)에 교체하고 삭제.
- **중요:** 시스템에 설치된 QGIS 내부 언어·외부 공급자 파일까지 제거한다는 뜻은 아니다. 판도연구소의 QGIS 접속 구현과 실행 경로가 Python을 호출하지 않아야 완료다.

## 5. 지도 이미지 AI 학습 전면 전환 (E: 19개)

- `acquire-sources.py`, `corpus.py`, `macro.py`, `publisher.py`, `semap.py`, `prepare-analysis-images.py`는 Node 기반 출처/ZIP 스트리밍·라이선스/검토 코퍼스 계약 + 네이티브 MuPDF/이미지 처리로 전환. 원본 PDF·이미지와 검수 라벨을 바꾸지 않는다.
- `evaluation.py`는 픽셀 마스크 F1/IoU·원본 해상도 단위 평가를 Node TypedArray 또는 C++로 이식. 기존 테스트 fixture와 채널별 수치·검증 분리(훈련/검증/평가 세트)를 유지.
- `model.py`, `train.py`, `inspect-checkpoint.py`, `verify-model.py` → 별도 `tools/cpp/reference-analysis` 네이티브 LibTorch C++17 학습/검증 실행기. MobileNetV3-Large 기반 encoder·경계 loss, AdamW, CUDA/CPU, deterministic seed, 모델 상태/optimizer 체크포인트, 평가 인덱스를 고정. 공식 LibTorch C++ 프런트엔드의 `torch::nn`/`torch::optim`/`torch::data` 이용.
- **ONNX 내보내기 필수 설계 게이트:** Python의 `torch.onnx.export`를 계속 호출하는 방식은 최종안에서 금지. C++/Node ONNX 그래프·initializer 직렬화 경로를 구축하고 기존 `tools/reference-analysis/verify-trained-onnx.mjs` 및 실제 브라우저 ONNX Runtime Web에서 입력·출력 이름, shape, 유한값, 채널·float32 수치 및 허용 오차를 확인한다. ONNX Runtime C++ Training도 Python 생성 아티팩트를 요구할 수 있어 'Python 없음' 목표를 자동 해결한다고 간주하지 않음.
- 초기 승인/학습 산출물이 없는 경우는 검증된 실제 지도 코퍼스와 독립 라벨을 우선 확보하고 학습·평가 결과로 성공을 판단. 허위 학습 checkpoint 생성 금지. 기존 PyTorch `.pt` 가중치의 일회성 이전은 이행 중 별도 임시 환경에서 수행할 수 있으나 최종 앱·CI·저장소 실행기는 Python 의존 0.
- 관련 Python 테스트 8개를 Node/CTest에 모두 이관. C++ 네이티브 학습/ONNX 변환에 대한 실제 모델 회귀 검사 없이는 Python 삭제만으로 성공 표시 금지.

## 6. 최종 정리와 수용 기준

- **모든 101개에 명확한 종료 조치:** 첨부 목록 A~E 중 어느 `.py`도 `유지`로 완료 처리하지 않음. 이식은 새 코드 + 테스트 + 호출처 전환 + 옛 파일 삭제를 한 변경으로 묶으며, 종료 대상은 지도/보고서/원본 파일 영구 보존 증거가 있은 뒤 삭제.
- **호출 그래프:** `.github/workflows/**`, `.github/actions/**`, `scripts/**`, `package.json`, `AGENTS.md`, 문서와 플러그인 skill에 남은 프로젝트 소유 Python 코드·`python - <<'PY'`·`python -m`·`.py` 참조를 검색하고 유효한 Node/CTest 명령으로 고침. 오래된 문서 속 역사 기록만 보존 가치에 따라 설명으로 남기되 실행 명령은 사용 중인 명령으로 교체.
- **재현성:** 소스/결과물 해시와 라이선스, 수정 금지 원본, 지도 레이어의 ID·좌표·위상·표시 결과, 허용되는 레시피/버전 변경을 동등성 검사로 통제.
- **최종 게이트:** `git ls-files '*.py' '*.pyi' '*.ipynb'` = 0, 판도 소유 Python 스크립트/CI/문서 실행 호출 = 0, 전환된 Node·CTest 및 핵심 브라우저 smoke, Windows/Linux GIS 네이티브·QGIS, 학습/ONNX WASM 검사 통과. 잔여 외부 SDK Python은 별도 명시하고 '전체 OS Python 0'으로 홍보하지 않음.
- **스테이징:** `work/gis`에서 작은 기능별 커밋으로 진행하며 다른 작업 브랜치는 자동 변경하지 않음. 매 커밋 대상별 입력 fixture·예상/실제 차이·검증 범위를 남기고 마지막에만 통합 검사를 수행한다.

## 부록. 전수 분류 매니페스트

다음 목록은 커밋 `61aa02a9fd09`의 **Python 101개 전체**를 직접 열거한다. 누락·중복 0개로 대조하였다.

### A. Node 파이프라인·도구 — 11개

- `scripts/gis/run-source.py`
- `scripts/summarize-boundary-capture-evidence.py`
- `tests/application_source.py`
- `tests/test_application_source.py`
- `tests/test_font_assets.py`
- `tests/test_p4_gis_runner.py`
- `tests/test_place_candidates.py`
- `tests/test_report_paths.py`
- `tools/build-place-candidates.py`
- `tools/library_data.py`
- `tools/report_paths.py`

### B. Hydro·DEM — 28개

- `tests/python/test_build_terrain_dem.py`
- `tests/python/test_build_terrain_preview.py`
- `tests/test_hydro_calibration.py`
- `tests/test_hydro_connectivity.py`
- `tests/test_hydro_independent_names.py`
- `tests/test_hydro_name_inventory.py`
- `tests/test_hydro_tiles.py`
- `tests/test_hydronym_spacing.py`
- `tools/build-hydro-tiles.py`
- `tools/build-physical-data.py`
- `tools/build-terrain-dem.py`
- `tools/build-terrain-preview.py`
- `tools/calibrate-hydro.py`
- `tools/gis/check_official_usgs_hydro_gauges.py`
- `tools/gis/compare_osm_hydro_natural_earth.py`
- `tools/gis/hydro_independent_name_policy.py`
- `tools/gis/prepare_hydro_name_replacement_bundle.py`
- `tools/gis/verify_independent_river_point_anchors.py`
- `tools/gis/verify_osm_hydro_batch01_anchors.py`
- `tools/gis/verify_osm_hydro_batch02_points.py`
- `tools/gis/verify_osm_hydro_batch03_points.py`
- `tools/gis/verify_victorian_yarra_source.py`
- `tools/hydro_connectivity.py`
- `tools/inventory-hydro-names.py`
- `tools/inventory-osm-hydronyms.py`
- `tools/repair-hydro-connectivity.py`
- `tools/verify-hydro-connectivity.py`
- `tools/verify-terrain-dem.py`

### C. 역사 국경·일회성 GIS — 38개

- `tests/test_baikonur_official_reference.py`
- `tests/test_german_empire_1914_base.py`
- `tests/test_lsib_boundary_supplement.py`
- `tests/test_ussr_1922_caspian.py`
- `tests/test_v0280_historical_library.py`
- `tests/test_v0300_east_germany_library.py`
- `tests/test_v0301_borneo_geometry.py`
- `tests/test_v0306_layer_lock_sync.py`
- `tools/audit_north_schleswig_1914_001_026.py`
- `tools/audit_north_schleswig_1914_001_026_sheets.py`
- `tools/audit_north_schleswig_1914_stone26_split.py`
- `tools/build_german_cecilienkoog_1905_provisional.py`
- `tools/build_german_empire_1914_base.py`
- `tools/build_german_empire_1914_modern_coast.py`
- `tools/build_north_schleswig_1914_001_026.py`
- `tools/check_north_schleswig_1914_slub_wms.py`
- `tools/collect_north_schleswig_1914_001_026.py`
- `tools/discover_north_schleswig_1914_map_services.py`
- `tools/fetch-east-germany-sources.py`
- `tools/fetch_german_empire_1914_source.py`
- `tools/fetch_north_schleswig_1864_west_sources.py`
- `tools/gis/apply_ussr_1922_caspian.py`
- `tools/gis/baikonur_official_reference.py`
- `tools/gis/report_ussr_1922_caspian.py`
- `tools/probe_german_empire_1914_coast_period_rasters.py`
- `tools/probe_german_empire_coast_microtiles.py`
- `tools/probe_north_schleswig_1914_prussian_wms.py`
- `tools/render_german_cecilienkoog_1905_qa.py`
- `tools/render_north_schleswig_1914_slub_overlays.py`
- `tools/review_north_schleswig_1914_hugum_hotspots.py`
- `tools/supplement-lsib-boundaries.py`
- `tools/verify-lsib-country-sources.py`
- `tools/verify-lsib-screen-delta.py`
- `tools/verify_north_schleswig_1914_0619_hugum.py`
- `tools/verify_north_schleswig_1914_0717_coast.py`
- `tools/verify_north_schleswig_1914_0718_east.py`
- `tools/verify_north_schleswig_1914_0718_west.py`
- `tools/verify_north_schleswig_1914_0719_spandet.py`

### D. QGIS·래스터 어댑터 — 5개

- `plugins/pando-map-tools/lib/raster.py`
- `tests/python/test_qgis_bridge.py`
- `tests/test_map_plugin_raster.py`
- `tools/qgis/bootstrap.py`
- `tools/qgis/bridge.py`

### E. AI 분석·학습 — 19개

- `tests/python/test_reference_analysis_conditions.py`
- `tests/python/test_reference_analysis_corpus.py`
- `tests/python/test_reference_analysis_evaluation.py`
- `tests/python/test_reference_analysis_macro.py`
- `tests/python/test_reference_analysis_publisher.py`
- `tests/python/test_reference_analysis_semap.py`
- `tests/python/test_reference_analysis_sources.py`
- `tests/reference-analysis/test_model.py`
- `tools/reference-analysis/acquire-sources.py`
- `tools/reference-analysis/corpus.py`
- `tools/reference-analysis/evaluation.py`
- `tools/reference-analysis/inspect-checkpoint.py`
- `tools/reference-analysis/macro.py`
- `tools/reference-analysis/model.py`
- `tools/reference-analysis/prepare-analysis-images.py`
- `tools/reference-analysis/publisher.py`
- `tools/reference-analysis/semap.py`
- `tools/reference-analysis/train.py`
- `tools/reference-analysis/verify-model.py`

