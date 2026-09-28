# DEM 지형 자료 (0.13.0)

WebGL1·2의 기본 지형은 공개된 ETOPO DEM `0.13.0`이다. DEM manifest, tint 또는 데이터셋을 사용할 수 없으면 Natural Earth raster `0.12.6`으로 전환한다. 개별 고해상도 타일만 실패하면 먼저 같은 DEM의 낮은 LOD를 사용한다. Canvas는 raster `0.12.6`을 계속 사용한다. UI의 없음·흑백·색채 선택과 프로젝트 저장 형식은 그대로다.

DEM 데이터는 앱 저장소가 아닌 [별도 공개 저장소](https://github.com/kimjeon-il/world-map-terrain-v0.13.0)의 GitHub Pages에서 제공한다. 앱은 `https://kimjeon-il.github.io/world-map-terrain-v0.13.0/terrain/v0.13.0/manifest.json`을 읽는다. 데이터 자산은 해당 버전에서 수정하지 않고, 변경이 필요하면 새 버전 경로를 만든다. 배포 순서는 데이터 업로드와 HTTP 검증, `?demTerrain=preview` 검수, 앱의 기본값 전환이다.

원본은 [NOAA ETOPO 2022 30 arc-second Ice Surface GeoTIFF](https://www.ncei.noaa.gov/products/etopo-global-relief-model)와 음영을 포함하지 않은 [Natural Earth Cross-blended Hypso HYP_HR](https://www.naturalearthdata.com/downloads/10m-raster-data/10m-cross-blend-hypso/)다. ETOPO의 좌표계는 WGS84 경위도와 EGM2008 높이의 결합 좌표계 EPSG:9518이다. 타일의 위치는 EPSG:4326 경위도로 표현하고 높이값은 EGM2008 m를 보존한다.

필요한 Python 패키지는 `numpy`, `Pillow`, `rasterio`다. 저장소 밖의 넉넉한 디스크에 원본을 둔 뒤 다음 명령을 실행한다.

```powershell
python tools/build-terrain-dem.py --etopo 'F:\map-editor-dem-0.13.0\source\ETOPO_2022_v1_30s_N90W180_surface.tif' --tint-zip 'F:\map-editor-dem-0.13.0\source\HYP_HR.zip' --output 'F:\map-editor-dem-0.13.0\terrain\v0.13.0-optimized'
python tools/verify-terrain-dem.py --etopo 'F:\map-editor-dem-0.13.0\source\ETOPO_2022_v1_30s_N90W180_surface.tif' --output 'F:\map-editor-dem-0.13.0\terrain\v0.13.0-optimized' --reference-output 'F:\map-editor-dem-0.13.0\terrain\v0.13.0'
```

생성기는 원본 체크섬·좌표계·격자 크기·NoData를 확인한다. 고도를 먼저 각 LOD에서 면적 평균으로 구한 후, 315°/45° 광원으로 사전 음영을 계산한다. 타일은 1px 실제 이웃 gutter가 있는 lossless WebP RGBA다. `R×256+G−12000`이 고도 m, B가 사전 음영, A는 255다. 저장 공간을 줄이기 위해 B만 4단계 간격으로 양자화한다. 극점 바깥의 1px gutter는 낮은 LOD에서 가장 가까운 실제 행의 음영을 쓰고, 높은 LOD에서는 원래 음영을 유지한다. 기존 음영과의 오차는 최대 2/255이고 고도 RG는 완전히 동일하다. 1m는 **저장 간격**이며 원본 고도의 측량 정확도가 아니다. 검증기는 모든 타일의 크기·채널·인접 gutter·날짜변경선·체크섬을 검사한다. 기존 산출물과 비교할 때는 `--reference-output`을 지정해 고도 채널의 바이트 일치와 음영 오차를 검사한다. 산출 용량·생성 시간·작업 메모리는 Git 밖 `build-report.json`에 기록한다. 초기 전체 생성에서 메모리 계측에 실패했으므로 `peakWorkingSetBytes`가 `null`일 수 있다. `representativePeakWorkingSetBytes`는 각 LOD의 전체 크기 타일 하나씩 재측정한 값이며 전체 생성의 최대 메모리로 해석하면 안 된다.

로컬 자료를 보려면 다른 터미널에서 `node tools/serve-terrain-dem.mjs --root 'F:\map-editor-dem-0.13.0'`을 실행하고 앱 URL에 `?demTerrain=local`을 붙인다. `?demTerrain=preview`는 공개 DEM 주소를 사용한다. 앱 시작 전 `window.PANDOLAB_DEV_DEM_MANIFEST_URL`에 절대 manifest URL을 지정하면 두 선택보다 우선한다. 타일 URL 템플릿에는 데이터 루트 기준 상대 URL 또는 절대 URL을 사용할 수 있다.

`window.__PANDOLAB_GPU_METRICS__`에서 실제 표현 형식, 버전, 출처, fallback 이유, 목표·실제 LOD를 확인할 수 있다. 데이터 서버를 변경할 때는 CORS와 WebP MIME을 확인한다.

검증된 LOD 0~5 타일 1,280개와 tint·manifest는 853,254,949바이트(약 813.7MiB)다. 이전 생성본의 1,027,468,206바이트보다 약 17% 작다. 최대 타일은 1,580,966바이트다. 이 수치는 실제 생성 파일 기준이며 다운로드 압축이나 브라우저 캐시 효과를 포함하지 않는다.
