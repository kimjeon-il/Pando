# AtlasWright v0.18.1

국가와 국경을 만드는 세계지도 편집기입니다. Natural Earth 5.1.1의 1:10m 국가 데이터와 지형 음영, HydroRIVERS 강·Natural Earth 호수를 사용하며, 빌드 과정 없이 정적 서버나 GitHub Pages에서 실행됩니다.

## 로컬 실행

이 프로젝트는 Worker와 외부 데이터 파일을 사용하므로 `index.html`을 직접 더블클릭하지 마세요.

```powershell
python -m http.server 8080
```

브라우저에서 `http://localhost:8080/`을 엽니다.

## GitHub Pages

1. 이 폴더의 내용을 GitHub 저장소에 올립니다.
2. 저장소의 **Settings → Pages**에서 배포할 브랜치와 루트 폴더를 선택합니다.
3. 생성된 Pages 주소로 접속합니다.

모든 경로는 저장소 하위 URL에서도 동작하도록 상대경로로 구성되어 있습니다. `.nojekyll`도 포함되어 있습니다.

## 반응형 작업공간

작업공간은 화면 너비에 따라 세 단계로 전환됩니다. `1200px` 이상에서는 좌우 패널이 고정되고, `800~1199px`에서는 왼쪽 패널과 지도는 유지한 채 편집 패널이 서랍으로 열립니다. `799px` 이하에서는 지도가 전체 너비를 사용하며 지도·레이어와 편집 패널은 하단 시트로 표시됩니다.

화면 크기나 방향이 바뀌어도 선택 객체, 입력 중인 편집선과 지도 카메라는 유지됩니다. 패널의 열림 상태는 임시 UI 상태이며 자동저장이나 GeoPackage에는 기록되지 않습니다.

v0.15.0에서는 공식 Pretendard v1.3.9 Variable 글꼴을 내장하고, 지도 라벨부터 모달 제목까지 글자 크기·굵기·행간을 역할별 체계로 통일했습니다. 작업 안내·알림·오류 문구는 간결한 존댓말과 일관된 영토 편집 용어를 사용합니다.

v0.16.0에서는 지도 크기와 패널 전환을 분리한 지도 우선 반응형 작업 공간을 도입했습니다. 1360px 이상에서는 레이어 패널과 모델리스 편집 서랍, 800~1359px에서는 세로 탐색 레일과 양쪽 서랍, 799px 이하에서는 하단 탐색과 모달 시트를 사용합니다. 지도 카메라와 편집 상태는 레이아웃 전환 중에도 유지됩니다.

v0.16.1에서는 모바일 시트의 텍스트 닫기 버튼을 공통 아이콘 버튼으로 교체하고, 지도 투영 세그먼트의 외곽 높이를 다른 지도 도구와 동일한 42px로 맞췄습니다.

v0.16.2에서는 `현재 작업` 배지의 두 텍스트를 같은 크기로 정렬하고, 모바일 확대 도크를 다른 플로팅 도구와 같은 여백으로 통일했습니다. 중복 배율 표시는 제거하고 하단 상태줄에서만 제공합니다.

v0.16.3에서는 기본 작업 상태를 하단 상태줄로 옮기고 실제 편집 안내만 지도 상단 중앙에 표시합니다. 편집 서랍은 상태줄 위에서 끝나도록 높이와 내부 카드 밀도를 조정해 상태줄이 화면 끝까지 이어집니다.

v0.18.1에서는 편집 대상 유형 배지를 일관되게 표시하고, 패널 닫기 버튼의 여백과 수계 정보 카드의 중첩 테두리를 정리했습니다. v0.18.0에서 통합한 공용 UI 규격은 그대로 유지합니다.

v0.14.4에서는 `전체 지도 맞춤`과 `지구본 투영`에 서로 다른 아이콘을 사용하고, 투영법과 영토 선택 방식의 세그먼트를 선택 항목 전체가 강조되는 형태로 통일했습니다.

v0.14.3에서는 영토 선택 방식을 `경계 그리기 / 영토 선택`으로 간소화하고, 영토 편입과 국가 합병에서 여러 대상국을 한 번에 선택할 수 있습니다. 각 작업은 한 번의 실행취소로 복원됩니다.

v0.13.2에서는 `보기`에 투영법과 지도 엔진만 남기고 `지형 음영`을 독립된 최상위 레이어 폴더로 분리했습니다. 폴더에서 `국가색 + 음영` 또는 `지형색 강조`를 선택하며, 음영 강도는 `국가색 + 음영` 모드에서만 표시됩니다. 내장 강과 호수는 수동 색상 설정 없이 현재 표시 중인 바다 계열을 자동으로 따릅니다.

v0.13.1에서는 지형지물 하위 레이어를 `강`, `호수`, `사용자 지형지물`과 객체 수만 표시하도록 간소화해 좁은 패널에서도 레이어명을 읽기 쉽게 만들었습니다. Hydro·Natural Earth 출처와 수계 준비 상태, 재시도 안내는 기존 상단 알림과 레이어 선택 안내에서 계속 제공합니다.

v0.13.0에서는 UI 본문을 14px, 보조 문구를 최소 12px로 통일하고 국가·지명 라벨도 확대했습니다. 선택 국가는 기존 2px 외곽선과 함께 테마 강조색의 옅은 반투명 면으로 표시됩니다. 영토 편입을 시작하거나 영토를 가져올 국가를 선택해도 현재 지구본 회전·중심·확대율을 바꾸지 않습니다.

국가 선택은 지도의 기본 동작입니다. 새 국가·지명·강·호수는 지도 위 `추가` 메뉴에서 만들며, 활성 편집의 완료·선택 방식 전환·취소는 지도 하단 작업 바에만 표시됩니다. 진행·성공·오류 알림은 상단 중앙 한곳에서 안내합니다.

## 레이어 폴더

`국가`, `지형 음영`, `지형지물`, `도시·지명`, `국가명 라벨` 폴더를 펼쳐 개별 항목을 표시하거나 숨길 수 있습니다. `지형지물`에는 Hydro 강, Natural Earth 호수와 사용자가 만든 지형지물이 표시됩니다. 내장 수계는 잠겨 있으며 선택 후 `편집용 복사 만들기`를 사용하면 원본을 숨기고 같은 형상의 편집 객체를 만들 수 있습니다. 개별 표시 상태와 폴더 열림 상태는 자동저장 및 GeoPackage의 `aw_project_settings`에 보존됩니다.

국가명은 해외 영토를 포함한 전체 중심점 대신 가장 큰 연결 영토 내부의 최적 지점에 자동 배치됩니다.

## 글꼴

인터페이스와 지도 라벨은 [Pretendard v1.3.9](https://github.com/orioncactus/pretendard/releases/tag/v1.3.9)의 `PretendardVariable.woff2`를 저장소에 포함해 사용합니다. 글꼴은 SIL Open Font License 1.1로 배포되며 라이선스 전문은 `assets/fonts/pretendard-v1.3.9/LICENSE.txt`에 있습니다. 포함된 WOFF2의 SHA-256은 `9599F12FD42FC0BCE1CD50B47A0C022E108D7AA64DD0D1BB0ED44F3282D900B4`입니다.

## 시스템 테마

AtlasWright는 운영체제·브라우저의 `prefers-color-scheme` 설정을 따라 밝은 테마와 어두운 테마를 자동 전환합니다. 실행 중 시스템 설정이 바뀌어도 현재 카메라, 선택 객체와 편집 중인 선은 유지되며 테마는 프로젝트나 GeoPackage에 저장되지 않습니다.

밝은 지도의 바다 `#FFFFFF`, 기본 육지 `#CCCCCC`, 국경 `#FFFFFF`, 지구본 외곽선 `#000000`, 격자 `#AAAAAA` 배색은 Milenioscuro의 Wikimedia Commons 파일 [Russian Empire (orthographic projection).svg](https://commons.wikimedia.org/wiki/File:Russian_Empire_(orthographic_projection).svg)를 참조했습니다. 해당 SVG는 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)으로 제공됩니다. AtlasWright는 색상 토큰만 참조했으며 사용자 지정 및 GIS에서 가져온 국가 색상은 두 테마에서 그대로 유지됩니다.

## GPU 메시

국가 면은 원본 국경을 제거하거나 단순화하지 않고 WebGL2·WebGL1에서 렌더링합니다. 일반 영토는 날짜변경선을 해제한 경위도 평면, 극지 영토는 극 중심 방위평면에서 삼각분할과 세분화를 함께 수행해 렌더링 삼각형이 바다로 이탈하지 않게 합니다. 모든 렌더링 변의 구면 각거리는 `0.499°` 이하입니다.

내장 메시를 다시 생성하려면 저장소 루트에서 `node tools/build-world-mesh.mjs`를 실행합니다. 이 과정은 배포 시 필요하지 않으며 정적 사이트는 생성된 메시를 바로 읽습니다.

## 지형 음영과 수계

보기 패널에서 `국가색 + 음영`과 `지형색 강조`를 전환하고 음영 강도를 조절할 수 있습니다. 지형은 Natural Earth raster 3.2.0의 `GRAY_HR_SR_OB`, 무수계 `HYP_HR_SR`, 해저 지형용 `HYP_HR_SR_OB_DR` 21,600×10,800 원본을 결합한 무손실 WebP 타일 피라미드입니다. RGB에는 강·호수가 중복되지 않는 육지 지형색과 해저 수심을, 알파 채널에는 중립 음영을 넣습니다. 초기 국가지도 로딩을 막지 않으며 현재 화면에 필요한 단계의 타일만 불러옵니다.

강은 HydroRIVERS 1.0을 사용합니다. `ORD_STRA + 4×log10(DIS_AV_CMS) - 0.5×log10(UPLAND_SKM)` 중요도 기준으로 선별하고, 최종 유역면적 2,500㎢ 이상인 유역은 대표 본류를 발원부부터 하구·내륙 종점까지 보존합니다. 추가 본류는 최고 세부 단계부터만 표시합니다. 같은 `MAIN_RIV`에 속한 본류와 표시 지류는 하나의 논리적 수계로 묶여 선택·숨김·편집용 복사가 함께 적용되며, 지류별 명칭과 역할은 상세 메타데이터에 보존됩니다. 강 너비는 유량과 하천 차수로 계산하고 하류가 상류보다 가늘어지지 않게 보정합니다. 선택된 Hydro 원본 꼭짓점은 단순화하지 않고 1e-6° 정밀도로 저장합니다.

한국어 수계명은 검수 교정표, OpenStreetMap `name:ko`, Natural Earth 이름 순으로 적용합니다. `강·천·호·호수` 접미사는 고유명과 붙여 쓰며 `다뉴브강`은 `도나우강`으로 교정합니다. 검증된 이름이 없는 지류에는 이름을 임의 생성하지 않고 대표 수계에 포함하며, 수계 전체에 이름이 없을 때만 안정적인 ID가 붙은 `미명명 수계`로 표시합니다. OpenStreetMap 관계 자료는 빌드 시 명칭·관계 보강에만 사용하고 런타임 온라인 요청은 하지 않습니다. OSM 파생 정보는 [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)의 ODbL 조건을 따릅니다.

호수는 Natural Earth 5.0.0 1:10m 전 세계 기본 `Lakes + Reservoirs` 1,355개를 사용합니다. 유럽·북미·호주 지역 보충 자료와 HydroLAKES 형상은 렌더링하지 않아 전 세계 표시 밀도를 일정하게 유지합니다. 162,852개 원본 좌표는 단순화하지 않습니다.

내장 Natural Earth 국가 사이의 공유국경을 10km 이상 따라가는 강은 거리·표본 점유율·방향 조건을 모두 통과한 구간만 진입점·이탈점에서 분할해 정확한 공유국경 경로로 교체합니다. 한 Hydro reach의 일부만 국경 역할을 해도 해당 구간만 정렬하며, 단순 횡단이나 짧은 평행 구간은 제외합니다. 국가 폴리곤과 사용자 편집 국경은 변경하지 않습니다. 정렬 전 Hydro 좌표와 국가 쌍은 상세 메타데이터에 보존하고, 정렬 구간은 같은 논리 수계 ID를 유지한 채 국경 위에 다시 그립니다.

초기 실행에서는 100KiB 미만의 manifest와 압축 metadata를 Worker에서 읽고, 현재 화면과 확대 단계에 필요한 바이너리 타일만 복원합니다. 표시 pack에는 좌표만 들어 있으며 GeoJSON은 선택·편집용 복사 시에만 복원합니다. 인접 Range 요청은 합쳐 받고 GPU 업로드는 프레임별로 나눕니다. WebGL 캐시는 데스크톱 96MiB, 모바일 48MiB로 제한합니다. 자동 수계 라벨은 포함하지 않습니다.

v0.12.6에서는 국가 외곽선에서 극점·날짜변경선용 인공 폐합 구간을 제외하고, 국가 채움용 Polygon은 그대로 보존합니다. `국가색 + 음영`은 국가 면 스텐실로 육지만 음영 처리하며, `지형색 강조`는 강·호수가 없는 Natural Earth `HYP_HR_SR` 육지와 기존 해저 지형을 합성합니다. 강과 호수는 각각 흰색 또는 현재 테마의 바다색을 선택할 수 있습니다.

수계 metadata는 표시용 core와 상세 출처용 detail로 분리합니다. 긴 원본 reach 목록이 들은 detail은 수계를 선택하거나 `편집용 복사`를 실행할 때만 지연 로드하며, WebGL 메인 스레드에는 GeoJSON 대신 GPU `TypedArray`와 고정 크기 descriptor만 전달합니다. Canvas 대체 경로는 Hydro Worker와 Canvas Worker를 `MessageChannel`로 직접 연결해, 메인 스레드에는 좌표 대신 완성된 `ImageBitmap`과 선택 ID만 보냅니다.

지형 배포 자산을 다시 만들 때는 공식 ZIP을 작업용 폴더에 풀고 다음 명령을 실행합니다. `pyshp`와 Pillow가 필요하며 생성된 manifest에는 원본 파일 SHA-256과 변환 방식을 기록합니다.

```powershell
python tools/build-physical-data.py <Natural-Earth-원본-폴더> assets/data --countries assets/data/countries-ne-5.1.1.geojson
```

### Hydro 전 세계 보충 자료 캘리브레이션

`tools/calibrate-hydro.py`는 HydroRIVERS·HydroLAKES를 현재 Natural Earth 기본+지역 보충 수계와 비교하는 분석 전용 도구입니다. 유럽·북미·호주에 동일한 중요도 공식과 `min_zoom 6.0·6.7·7.0·7.5` 경계를 적용하고, 한반도는 별도 검증 범위로 사용합니다. Natural Earth 기본 수계 중복 제거, 단계별 길이·화면 점유율·호수 개수, 하천 체인 결합 시 좌표 보존과 예상 전 세계 용량을 함께 계산합니다.

```powershell
python -m pip install -r tools/requirements-hydro-calibration.txt
python tools/calibrate-hydro.py `
  --hydrorivers-root <HydroRIVERS-대륙별-폴더> `
  --hydrolakes <HydroLAKES_polys_v10.shp> `
  --natural-earth-root assets/data/hydro `
  --output reports/hydro-calibration
```

분석 출력은 안전상 `assets/data` 아래로 지정할 수 없습니다. 캘리브레이션 원본 결과는 [`reports/hydro-calibration`](reports/hydro-calibration/README.md)에 보존되어 있습니다.

실제 v0.13.0 수계 샤드는 다음 명령으로 다시 생성합니다. 아홉 개 HydroRIVERS 대륙 Shapefile, 저장소의 Natural Earth `lakes_base.geojson`, 검수 교정표와 빌드용 OSM waterway 관계 내보내기를 사용합니다. 생성기는 중형 본류를 하구까지 폐합하고, 수계 단위 논리 ID와 본류·지류 역할을 만든 뒤 내장 공유국경과 일치하는 세부 구간을 표시용 형상으로 정렬합니다. 결과에는 Natural Earth 호수, 단일 공간 인덱스와 4MiB 이하 정적 샤드가 포함됩니다. 표시 강의 종점은 바다·Natural Earth 호수·합류점·내륙 유역으로 분류하고, 같은 육지 안의 명확한 하구만 최대 25km 범위에서 연결합니다. Hydro 원본 연결망 자체가 해안에서 멀리 끊겨 안전하게 복구할 수 없는 경우에는 임의의 직선을 만들지 않고 해당 논리 수계 전체를 제외하며 manifest 통계에 남깁니다.

```powershell
python -m pip install -r tools/requirements-hydro-tiles.txt
python tools/build-hydro-tiles.py `
  --hydrorivers-root <HydroRIVERS-원본-폴더> `
  --natural-earth-root assets/data/hydro `
  --drainage-free-raster <HYP_HR_SR.tif> `
  --osm-waterways assets/data/hydro/osm-waterway-ko-v0.13.0.json `
  --hydronym-overrides assets/data/hydro/hydronym-ko-overrides.json `
  --output assets/data/hydro/v0.13.0
```

앱은 현재 화면의 샤드 범위를 먼저 불러온 뒤 지도 조작이 2초 동안 없을 때 전 세계 압축 샤드를 Cache Storage에 저장합니다. 지도 조작이나 전경 요청이 시작되면 다운로드를 일시 중지합니다. 압축 원본만 영구 저장하며 해제 형상과 GPU 버퍼는 데스크톱 96MiB, 모바일 48MiB LRU 범위를 유지합니다.

## QGIS 벡터 파일

`GIS 파일 열기`에서 다음 형식을 가져올 수 있습니다.

- GeoPackage (`.gpkg`)
- QGIS 프로젝트 (`.qgz`, `.qgs`)와 함께 선택한 참조 벡터 파일
- Shapefile 구성 파일 (`.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`) 및 `.shz`, `.zip`
- GeoJSON, KML/KMZ, GML/XML, FlatGeobuf

가져오기 마법사에서 Polygon/MultiPolygon 국가 레이어, ID·국명·색상 필드, CRS와 열기 방식을 지정합니다. CRS가 없는 자료는 EPSG 코드를 입력해야 합니다. 같은 ID의 여러 행은 하나의 MultiPolygon 국가로 묶을 수 있습니다.

QGS/QGZ는 데이터 자체를 항상 포함하지 않으므로, 프로젝트가 참조하는 GPKG나 Shapefile 구성 파일도 함께 선택해야 합니다. PostGIS 같은 데이터베이스, WMS/WFS, 원격 URL, 래스터, 인쇄 레이아웃, 플러그인과 매크로는 지원하거나 실행하지 않습니다.

## 저장

`GeoPackage 저장`은 원본 입력 파일을 수정하지 않고 `AtlasWright-프로젝트.gpkg`를 새로 만듭니다.

- `countries`: EPSG:4326 MultiPolygon 국가와 원본 속성
- `places`: 사용자 지명 Point
- `drawings_point`, `drawings_line`, `drawings_polygon`: 지형지물과 기존 사용자 도형
- `aw_country_assets`: 국기 이미지 BLOB
- `aw_project_settings`: 투영법, 카메라, 레이어 상태와 내장 수계 데이터 버전
- `aw_source_info`: 원본 파일·드라이버·CRS·필드 매핑·SHA-256

내장 전 세계 수계는 파일 용량이 중복되지 않도록 GeoPackage에 넣지 않습니다. 사용자가 만든 강·호수와 `편집용 복사`로 만든 객체만 `drawings_line`·`drawings_polygon`에 저장됩니다. QGIS에서는 이 사용자 벡터를 일반 레이어로 열어 편집할 수 있고, AtlasWright로 다시 열면 국기·메모·화면 상태와 내장 수계 버전도 복원됩니다. 자동저장은 별도의 AtlasWright 전용 IndexedDB에만 저장되며 공개 프로젝트 파일로 노출되지 않습니다.

## 지도 데이터와 라이선스

- Natural Earth 5.1.1 Admin 0 Countries, 1:10m (퍼블릭 도메인)
- [Natural Earth 5.0.0 Rivers + Lake Centerlines / Lakes + Reservoirs, 1:10m](https://www.naturalearthdata.com/downloads/10m-physical-vectors/) (퍼블릭 도메인)
- [HydroRIVERS 1.0](https://www.hydrosheds.org/products/hydrorivers) (HydroSHEDS 라이선스 및 인용 조건 적용)
- [Natural Earth raster 3.2.0 Gray Earth / Cross-blended Hypsometric Tints, 21,600×10,800](https://www.naturalearthdata.com/downloads/10m-raster-data/) (퍼블릭 도메인)
- 258개 국가·속령·분쟁 단위, 원본 좌표 548,471개
- gdal3.js 2.8.1 / GDAL 3.8.4 (LGPL-2.1-or-later)
- sql.js 1.14.2 (MIT)
- fflate 0.8.3 (MIT)

Natural Earth 자료는 [이용 조건](https://www.naturalearthdata.com/about/terms-of-use/)에 따라 퍼블릭 도메인으로 제공됩니다.

각 라이선스 원문은 `assets/js/vendor`의 해당 폴더에 포함되어 있습니다. GIS 런타임은 파일을 열거나 저장할 때만 지연 로딩됩니다.
