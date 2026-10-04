# DEM 지형 자료

WebGL1·2의 기본 지형은 공개된 ETOPO DEM `0.13.3`의 색채 표현이다. DEM manifest, tint 또는 데이터셋을 사용할 수 없으면 Natural Earth raster `0.12.6`으로 전환한다. Canvas는 raster `0.12.6`을 계속 사용한다. 기존 프로젝트는 처음 불러올 때 색채 표현으로 한 번 전환되며, 그 뒤 사용자가 선택한 없음·흑백·색채 설정을 저장한다. 색채 표현은 평면의 기준 밝기를 유지하도록 DEM 음영을 정규화해 지형의 명암이 흐려지지 않게 합성한다.

지형 해상도는 렌더러가 실제로 표시하는 지도 품질에 연결한다. 지도 미리보기에서는 2700×1350의 LOD 1만 요청·표시한다. 최저 단계보다 픽셀 수가 4배이며, 상세 편집 지형과 구분한다. canonical 지도에서는 현재 카메라와 기기 픽셀 비율에 필요한 LOD와 같은 단계의 인접 타일을 직접 요청한다. 중간 LOD를 순차적으로 받거나 저장된 저해상도 타일을 확대해 대체 표시하지 않는다. 상세 타일이 준비되지 않은 부분에는 기본 지도 바탕이 보인다. 축소로 지도 품질이 다시 미리보기로 전환되면 지형도 LOD 1로 돌아간다. WebGL과 Canvas Worker에 같은 규칙을 적용한다.

DEM 데이터는 앱 저장소가 아닌 [별도 공개 저장소](https://github.com/kimjeon-il/world-map-terrain-v0.13.0)의 GitHub Pages에서 제공한다. 앱은 `https://kimjeon-il.github.io/world-map-terrain-v0.13.0/terrain/v0.13.3/manifest.json`을 읽는다. 데이터 자산은 해당 버전에서 수정하지 않고, 변경이 필요하면 새 버전 경로를 만든다. 배포 순서는 데이터 업로드와 HTTP 검증, `?demTerrain=preview` 검수, 앱의 기본값 전환이다.

원본은 [NOAA ETOPO 2022 30 arc-second Ice Surface GeoTIFF](https://www.ncei.noaa.gov/products/etopo-global-relief-model)와 음영을 포함하지 않은 [Natural Earth Cross-blended Hypso HYP_HR](https://www.naturalearthdata.com/downloads/10m-raster-data/10m-cross-blend-hypso/)다. ETOPO의 좌표계는 WGS84 경위도와 EGM2008 높이의 결합 좌표계 EPSG:9518이다. 타일의 위치는 EPSG:4326 경위도로 표현하고 높이값은 EGM2008 m를 보존한다.

필요한 Python 패키지는 `numpy`, `Pillow`, `rasterio`이며 최근접 색 채우기는 GDAL 3.9 이상을 요구한다. 저장소 밖의 넉넉한 디스크에 원본을 둔 뒤 다음 명령을 실행한다.

서비스 기본 자료와 현재 생성기 산출 버전은 모두 `0.13.3`다. 육지 색상 tint는 원본에서 4096×2048로 생성해 이전 2048×1024보다 픽셀 수를 4배 늘린다. `0.13.1`은 순백색만 제외했기 때문에 흰 배경이 약간 착색된 해안 주변 픽셀을 유효 색상으로 받아들였다. 이 색을 보간한 일부 작은 섬은 여전히 지나치게 옅게 보였다. `0.13.2`부터 앱의 canonical 국가 형상을 색상 원본의 육지 마스크로 사용해 바다 픽셀을 제외한다. 축소는 육지 안의 유효 색상만 평균하고, 누락된 칸은 가장 가까운 유효 tint 색으로 채운다. 날짜변경선은 연결해서 처리한다. 이 색은 원본에서 확인된 섬 색상이 아닌 표시용 보완색이다. 바다색은 별도 셰이더가 결정하므로 tint의 바다 배경은 표시되지 않는다. 고도·음영 타일과 국가 형상은 바꾸지 않는다.

순백색 빙하를 보호하는 Natural Earth glaciated areas 입력은 [고정 소스](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/693f11422f4e08d2da4566b854dda53eb7c39fb3/geojson/ne_10m_glaciated_areas.geojson)에서 받는다. SHA-256은 `04fd2303d5f0ece2cf482af19d06731d745db9690501d7b0a2a4b7fe23a7726f`다. 이 마스크는 계절별 적설 자료가 아니다. 육지 마스크 입력은 `assets/data/countries-ne-5.1.1.geojson`이며 manifest와 생성 보고에 그 체크섬을 기록한다. 마스크는 원본 픽셀 중심을 판정한다. RGB 세 채널이 모두 230 이상인 해안 픽셀은 작은 섬에 섞인 흰 배경일 수 있어 색상 공급자에서 제외한다. 원본의 3×3 이웃이 모두 육지인 내부의 밝은 적설색과 빙하 마스크 안의 흰색은 보존한다. 날짜변경선의 이웃을 연결하고 블록 경계의 실제 이웃 행을 읽어 처리한다.

기존 검증된 DEM 타일을 그대로 복사하고 tint만 재생성하려면 아래 첫 명령 대신 `python tools/build-terrain-dem.py --reuse-dem '<검증된 0.13.2 폴더>' --tint-zip '<HYP_HR.zip>' --glaciated-areas '<빙하 GeoJSON>' --countries 'assets/data/countries-ne-5.1.1.geojson' --output '<새 0.13.3 폴더>'`를 사용한다. 생성기는 기존 출력 폴더 덮어쓰기를 거부한다. 새 자료의 로컬 검수는 앱 시작 전 `window.PANDOLAB_DEV_DEM_MANIFEST_URL = 'http://127.0.0.1:4174/terrain/v0.13.3/manifest.json'`을 지정한다. 서비스 기본 URL은 새 manifest와 tint 게시 완료 후에 전환한다. 게시 시에는 기존 불변 `0.13.0` 고도 타일 URL을 재사용하고 새 tint와 manifest만 업로드한다.

```powershell
python tools/build-terrain-dem.py --etopo 'F:\map-editor-dem-0.13.0\source\ETOPO_2022_v1_30s_N90W180_surface.tif' --tint-zip 'F:\map-editor-dem-0.13.0\source\HYP_HR.zip' --glaciated-areas 'F:\map-editor-dem-0.13.0\source\ne_10m_glaciated_areas.geojson' --countries 'assets/data/countries-ne-5.1.1.geojson' --output 'F:\map-editor-dem-0.13.0\terrain\v0.13.3'
python tools/verify-terrain-dem.py --etopo 'F:\map-editor-dem-0.13.0\source\ETOPO_2022_v1_30s_N90W180_surface.tif' --output 'F:\map-editor-dem-0.13.0\terrain\v0.13.3' --reference-output 'F:\map-editor-dem-0.13.0\terrain\v0.13.1'
```

생성기는 원본 체크섬·좌표계·격자 크기·NoData를 확인한다. 고도를 먼저 각 LOD에서 면적 평균으로 구한 후, 315°/45° 광원으로 사전 음영을 계산한다. 타일은 1px 실제 이웃 gutter가 있는 lossless WebP RGBA다. `R×256+G−12000`이 고도 m, B가 사전 음영, A는 255다. 저장 공간을 줄이기 위해 B만 4단계 간격으로 양자화한다. 극점 바깥의 1px gutter는 낮은 LOD에서 가장 가까운 실제 행의 음영을 쓰고, 높은 LOD에서는 원래 음영을 유지한다. 기존 음영과의 오차는 최대 2/255이고 고도 RG는 완전히 동일하다. 1m는 **저장 간격**이며 원본 고도의 측량 정확도가 아니다. 검증기는 모든 타일의 크기·채널·인접 gutter·날짜변경선·체크섬을 검사한다. 기존 산출물과 비교할 때는 `--reference-output`을 지정해 고도 채널의 바이트 일치와 음영 오차를 검사한다. 산출 용량·생성 시간·작업 메모리는 Git 밖 `build-report.json`에 기록한다. 초기 전체 생성에서 메모리 계측에 실패했으므로 `peakWorkingSetBytes`가 `null`일 수 있다. `representativePeakWorkingSetBytes`는 각 LOD의 전체 크기 타일 하나씩 재측정한 값이며 전체 생성의 최대 메모리로 해석하면 안 된다.

로컬 자료를 보려면 다른 터미널에서 `node tools/serve-terrain-dem.mjs --root 'F:\map-editor-dem-0.13.0'`을 실행하고 앱 URL에 `?demTerrain=local`을 붙인다. `?demTerrain=preview`는 공개 DEM 주소를 사용한다. 앱 시작 전 `window.PANDOLAB_DEV_DEM_MANIFEST_URL`에 절대 manifest URL을 지정하면 두 선택보다 우선한다. 타일 URL 템플릿에는 데이터 루트 기준 상대 URL 또는 절대 URL을 사용할 수 있다.

`window.__PANDOLAB_GPU_METRICS__`에서 실제 표현 형식, 버전, 출처, fallback 이유, 목표·실제 LOD를 확인할 수 있다. 데이터 서버를 변경할 때는 CORS와 WebP MIME을 확인한다.

공개 `0.13.0`의 LOD 0~5 타일 1,280개와 tint·manifest는 853,254,949바이트(약 813.7MiB)다. 이전 생성본의 1,027,468,206바이트보다 약 17% 작다. 최대 타일은 1,580,966바이트다. 이 수치는 실제 생성 파일 기준이며 다운로드 압축이나 브라우저 캐시 효과를 포함하지 않는다.

로컬 `0.13.1`의 tint는 1,439,194바이트이며 DEM 타일과 tint 합계는 853,966,858바이트다(작은 JSON 파일 제외). 타일 1,280개는 공개 `0.13.0` 생성본과 SHA-256이 전부 같았다. tint 재생성과 복사에 288초, 최대 작업 메모리 약 354MiB를 사용했다. 람페두사·리노사의 기존 tint 주변 네 texel은 모두 순백색이었고 새 tint에서는 지역 보완색으로 채워졌다. 몰타·판텔레리아와 비교한 그린란드·남극 지점의 색은 그대로였다. 전체 고도 재생성·타일 디코딩 검사를 반복하지 않고 동일 파일 해시로 고도·음영·gutter 보존을 확인했다.

로컬 `0.13.2`는 `F:\map-editor-dem-0.13.0\terrain\v0.13.2`에 생성했다. tint 734,150바이트, DEM 타일과 tint 합계 853,261,814바이트이며 tint SHA-256은 `425e2c8f255017ce1d94d976f008b0c107c3fb4ee7370e021788c913136399ab`다. 재생성과 복사에 160초, 최대 작업 메모리 약 449MiB를 사용했다. 기존 타일 1,280개의 파일 해시가 모두 같고, 한반도 본토·그린란드·남극의 비교 지점 색도 같았다. 258개 국가의 4,274개 조각 대표점을 조사했고, 원본이 흰 배경인 비빙하 소형 조각 137개 중 위도 ±60° 안에서 RGB 세 채널이 모두 230 이상으로 남는 사례는 없었다. 이는 대표점 검사이며 모든 육지 픽셀의 색 품질을 보장하는 검사는 아니다. 가거도의 tint 보간색은 기존 `[200.8,218.2,213.6]`에서 `[118,162,149]`로 바뀌었고 Chromium WebGL2 화면에서 육지색으로 표시됨을 확인했다. 관련 Python 검사 14개가 통과했다. 공개 `0.13.2`는 기존 `0.13.0` 고도 타일을 재사용하고 새 manifest·tint·생성 보고·대표점 감사만 게시한다. 앱의 기본 자료도 `0.13.2`로 전환한다. 기본 국가 회색 채우기와 전체 색채 대비는 이번 변경 범위에 포함하지 않는다.

`0.13.3`는 고도·음영 타일을 재생성하지 않고 원본 HYP_HR에서 tint를 4096×2048로 다시 샘플링했다. tint는 2,433,794바이트이며 SHA-256은 `1ae4c70e05494917c11d3c6b32869db61bf4f9e7e4b0239f9b4bd2b9bec582f3`다. 기존 1,280개 타일의 해시는 그대로다. 작은 섬의 흰 배경 제외와 빙하 보호 규칙도 유지한다. 미리보기 지형은 WebGL·Canvas 모두 LOD 1로 높였으며, 미리보기에서 받은 타일은 상세 편집의 더 높은 LOD 대체 표시에 사용하지 않는다.
