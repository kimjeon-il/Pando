# AtlasWright v0.10.3

국가와 국경을 만드는 세계지도 편집기입니다. Natural Earth 5.1.1의 1:10m 국가 데이터를 사용하며, 빌드 과정 없이 정적 서버나 GitHub Pages에서 실행됩니다.

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

## 레이어 폴더

`국가`, `보조 데이터`, `도시·지명`, `국가명 라벨` 폴더를 펼쳐 개별 항목을 표시하거나 숨길 수 있습니다. 항목명을 누르면 해당 객체를 선택하고 지도 화면을 그 위치로 이동합니다. 개별 표시 상태와 폴더 열림 상태는 자동저장 및 GeoPackage의 `aw_project_settings`에 보존됩니다.

국가명은 해외 영토를 포함한 전체 중심점 대신 가장 큰 연결 영토 내부의 최적 지점에 자동 배치됩니다.

## 시스템 테마

AtlasWright는 운영체제·브라우저의 `prefers-color-scheme` 설정을 따라 밝은 테마와 어두운 테마를 자동 전환합니다. 실행 중 시스템 설정이 바뀌어도 현재 카메라, 선택 객체와 편집 중인 선은 유지되며 테마는 프로젝트나 GeoPackage에 저장되지 않습니다.

밝은 지도의 바다 `#FFFFFF`, 기본 육지 `#CCCCCC`, 국경 `#FFFFFF`, 지구본 외곽선 `#000000`, 격자 `#AAAAAA` 배색은 Milenioscuro의 Wikimedia Commons 파일 [Russian Empire (orthographic projection).svg](https://commons.wikimedia.org/wiki/File:Russian_Empire_(orthographic_projection).svg)를 참조했습니다. 해당 SVG는 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)으로 제공됩니다. AtlasWright는 색상 토큰만 참조했으며 사용자 지정 및 GIS에서 가져온 국가 색상은 두 테마에서 그대로 유지됩니다.

## GPU 메시

국가 면은 원본 국경을 제거하거나 단순화하지 않고 WebGL2·WebGL1에서 렌더링합니다. 일반 영토는 날짜변경선을 해제한 경위도 평면, 극지 영토는 극 중심 방위평면에서 삼각분할과 세분화를 함께 수행해 렌더링 삼각형이 바다로 이탈하지 않게 합니다. 모든 렌더링 변의 구면 각거리는 `0.499°` 이하입니다.

내장 메시를 다시 생성하려면 저장소 루트에서 `node tools/build-world-mesh.mjs`를 실행합니다. 이 과정은 배포 시 필요하지 않으며 정적 사이트는 생성된 메시를 바로 읽습니다.

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
- `drawings_point`, `drawings_line`, `drawings_polygon`: 사용자 도형
- `aw_country_assets`: 국기 이미지 BLOB
- `aw_project_settings`: 투영법, 카메라와 레이어 상태
- `aw_source_info`: 원본 파일·드라이버·CRS·필드 매핑·SHA-256

QGIS에서는 일반 벡터 레이어를 열어 편집할 수 있고, AtlasWright로 다시 열면 추가 테이블의 국기·메모·화면 상태도 복원됩니다. 자동저장은 별도의 AtlasWright 전용 IndexedDB에만 저장되며 공개 프로젝트 파일로 노출되지 않습니다.

## 지도 데이터와 라이선스

- Natural Earth 5.1.1 Admin 0 Countries, 1:10m (퍼블릭 도메인)
- 258개 국가·속령·분쟁 단위, 원본 좌표 548,471개
- gdal3.js 2.8.1 / GDAL 3.8.4 (LGPL-2.1-or-later)
- sql.js 1.14.2 (MIT)
- fflate 0.8.3 (MIT)

각 라이선스 원문은 `assets/js/vendor`의 해당 폴더에 포함되어 있습니다. GIS 런타임은 파일을 열거나 저장할 때만 지연 로딩됩니다.
