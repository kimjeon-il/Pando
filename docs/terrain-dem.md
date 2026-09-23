# 선택형 DEM 지형 자료 (0.13.0)

기본 지형은 배포 경로가 정해질 때까지 기존 Natural Earth `0.12.6` 래스터다. DEM은 로컬 개발 옵션에서만 켠다. 프로젝트 형상·설정·저장 구조와는 별개인 표시 자료다.

원본은 [NOAA ETOPO 2022 30 arc-second Ice Surface GeoTIFF](https://www.ncei.noaa.gov/products/etopo-global-relief-model)와 음영을 포함하지 않은 [Natural Earth Cross-blended Hypso HYP_HR](https://www.naturalearthdata.com/downloads/10m-raster-data/10m-cross-blend-hypso/)다. ETOPO의 좌표계는 WGS84 경위도와 EGM2008 높이의 결합 좌표계 EPSG:9518이다. 타일의 위치는 EPSG:4326 경위도로 표현하고 높이값은 EGM2008 m를 보존한다.

필요한 Python 패키지는 `numpy`, `Pillow`, `rasterio`다. 저장소 밖의 넉넉한 디스크에 원본을 둔 뒤 다음 명령을 실행한다.

```powershell
python tools/build-terrain-dem.py --etopo 'F:\map-editor-dem-0.13.0\source\ETOPO_2022_v1_30s_N90W180_surface.tif' --tint-zip 'F:\map-editor-dem-0.13.0\source\HYP_HR.zip' --output 'F:\map-editor-dem-0.13.0\terrain\v0.13.0'
python tools/verify-terrain-dem.py --etopo 'F:\map-editor-dem-0.13.0\source\ETOPO_2022_v1_30s_N90W180_surface.tif' --output 'F:\map-editor-dem-0.13.0\terrain\v0.13.0'
```

생성기는 원본 체크섬·좌표계·격자 크기·NoData를 확인한다. 고도를 먼저 각 LOD에서 면적 평균으로 구한 후, 315°/45° 광원으로 사전 음영을 계산한다. 타일은 1px 실제 이웃 gutter가 있는 lossless WebP RGBA다. `R×256+G−12000`이 고도 m, B가 사전 음영, A는 255다. 1m는 **저장 간격**이며 원본 고도의 측량 정확도가 아니다. 검증기는 완성된 모든 타일의 크기·채널·인접 gutter·날짜변경선·체크섬을 검사한다. 산출 용량·생성 시간·작업 메모리는 Git 밖 `build-report.json`에 기록한다. 초기 전체 생성에서 메모리 계측에 실패했으므로 현재 보고서의 `peakWorkingSetBytes`는 `null`이며, `representativePeakWorkingSetBytes`는 각 LOD의 전체 크기 타일 하나씩 재측정한 값이다. 전체 생성의 최대 메모리로 해석하면 안 된다.

로컬 앱에서 자료를 보려면 다른 터미널에서 `node tools/serve-terrain-dem.mjs --root 'F:\map-editor-dem-0.13.0'`을 실행하고 앱 URL에 `?demTerrain=local`을 붙인다. 개발 호스트·CDN이 정해지면 앱 시작 전 `window.PANDOLAB_DEV_DEM_MANIFEST_URL`을 절대 manifest URL로 지정할 수도 있다. 타일 URL 템플릿에는 데이터 루트 기준 상대 URL 또는 절대 CDN URL을 사용할 수 있다. Canvas는 이 옵션과 관계없이 기존 래스터를 사용한다.

DEM manifest·디코딩·셰이더·tint를 사용할 수 없으면 WebGL은 기존 래스터 전체로 돌아간다. 높은 DEM LOD 타일 하나가 실패한 경우에는 먼저 같은 DEM의 낮은 LOD를 쓴다. `0.13.0` 자산은 Git에 넣거나 배포하지 않는다.
