# OSM 출처 의존성 제거 진행 현황 — 2026-11-03

> 상태: **GIS 연구·검수 브랜치에서만 진행**. 운영 `main` 병합, 데이터 pin 갱신, Pages 배포, 메인화면 OSM 표기 제거 **미실시**.
>
> 목표: OSM에서 직접 추출한 형상·명칭·관계 정보의 대체를 실제 데이터 바이트와 출처 검증으로 입증한다. 독립 출처의 공개성·재사용 조건·시기별 정합성 검증 없이 단순 출처 문자열만 바꾸지 않는다.

## 기준선과 두 개의 검증된 하천 대체

- 앱 저장소: `kimjeon-il/Pando` / `work/gis`.
- 현행 런타임 data pin: `kimjeon-il/PandoLab-library-data@5eb7be55208efaafe39bd5a65ec2f111d70b9053`.
- 현행 HydroRIVERS v0.13.2 원본 패키지 SHA-256: `f0832dd2024cbfad8b1662410a4f189fa95bcecb56c3e3f1ad69d36af4a0c36f`. OSM 명칭·관계 연결 수계 31개, 기존 독립 출처 검증 42개.
- 후보 `v0.13.3`에는 **새롭게 2개** 수계의 OSM 이름/관계 메타데이터를 독립 자료로 치환했다. **29개 OSM 연결 수계 잔존**. 기초 42개 독립 명칭 증빙은 보존.
  1. `20773860`: `수에즈운하강` → `수에즈운하`. Natural Earth 수에즈운하 선형의 주 본류 표본 69/81(0.852), 이집트 수에즈운하청 공식 영문 명칭.
  2. `40423228`: `남한강` 유지. Natural Earth `Namhan` 표본 65/81(0.802), `Han` 표본 30/81(0.370). 국토지리정보원의 2025년 국가지도집은 남한강·북한강을 합류 전 지리적 구간으로 구분한다. **'남한강'을 별개 국가하천의 법적 명칭이라고 주장하지 않음.**
- 결과: `tools/gis/hydro-followup-independent-name-replacements.json`, `tools/gis/osm-independent-river-source-inventory.json`, `tools/gis/stage-hydro-independent-followup.mjs`.
- 실제 원본 패키지에서 후보 패키지 생성·메타데이터 전수 비교·인덱스와 원래 강/호수 선형 샤드 SHA 동일성 검증 CI 성공: https://github.com/kimjeon-il/Pando/actions/runs/41532959943 .
- **주의:** `29`는 **후보**의 OSM 연결 건수이며 **운영 배포본은 여전히 `31`개**이다. 후보는 Actions artifact이며 런타임 pin이 가리키는 경로로 옮기지 않았다.

## 바이코누르 — OSM 파생 강변 형상 대체

- 조약 기준점 31개, 직선 구간 29개, 별도 강변 미복원 구간 **17→18**, **31→1**은 `tools/gis/baikonur-official-reference.mjs`에 고정. 2019년 카자흐스탄 비행장/도시 임대 예외 구역 4개는 `tools/gis/baikonur-2019-exclusions.mjs`에 조사/검수용 형상으로 생성.
- 카자흐스탄 정부 `КПСиСУ` ArcGIS 지도의 대상 두 구간 범위에서 **하천 선분 각각 1건 'Сырдарья'**, 수역 폴리곤 각각 3건/4건을 실제 조회했다. https://github.com/kimjeon-il/Pando/actions/runs/41532007572 .
- 해당 ArcGIS FeatureServer에는 `Copyright Text: КПСиСУ` 표기가 있으며 지도 인터넷 공개만으로 독립 재배포 라이선스가 확정되지 않는다. **공식 선형의 좌표는 복사·재배포하지 않음.** 해당 자료는 두 강변 존재·명칭·위치의 검수에 사용한다.
- USGS Landsat Collection 2 Level-2 영상은 미국 정부 자료로 **public domain**이고 USGS는 출처 인용을 요청한다. 
  - Earth Search STAC: 두 구간 80장씩 발견했지만 모두 `s3://` 형태여서 일반 HTTPS 임의 다운로드로 처리하지 않았음: https://github.com/kimjeon-il/Pando/actions/runs/41533645455 .
  - Microsoft Planetary Computer STAC: 두 구간 각각 80장 검색, 구름량 20% 이하이며 공개 HTTPS 후보 56장씩, 임시 서명 후 HEAD 접근 검증 성공. 익명 SAS 토큰은 저장하거나 로그에 출력하지 않음: https://github.com/kimjeon-il/Pando/actions/runs/41534025908 .
- 장면 존재 및 파일 접근만 검증했다. **영상의 실제 픽셀 판독, NDWI/수역 추출, 이중 계절·Cloud QA, 흐름 방향에 따른 우안 선택, 조약 원좌표계·2019년 제외구역 보정, 국가·임대구역 공유경계 위상 검증은 미완료**. 위성 촬영 당시의 물가와 1994년 법적 경계가 항상 동일하다고 가정하지 않는다.
- 따라서 해당 후보는 아직 법적 측량 형상이 아니며 임의 좌표 연결로 두 강변을 만들지 않는다.

## 기타 OSM 원본 및 출처 표기

- `tools/gis/build-german-1914-base.mjs`의 헬골란트·뒤네섬 1914년 **연구용 임시 현대 해안선** 제작 경로에는 `helgoland-osm-preserved.geojson`, `dune-osm-way-273992076.geojson` 입력 참조가 존재한다. 본 CI 작업에서 **그 경로의 실제 운영 배포 여부와 입력 형상의 독립 교체는 검증하지 않았다.** 운영 출처 감사 완료 전 이를 무조건 폐기·OSM 무관으로 판정하지 않는다.
- `shared/frontend/ui/fragments/map-attribution.html`의 OSM 표기는 **유지**. `tools/gis/audit-osm-credit-removal.mjs`는 운영 OSM 잔존과 바이코누르 독립 형상 증명 부재 시 표기 제거 허용을 거부한다.
- Natural Earth 자료의 공개 영역(public domain) 여부와 별개로 정부 포털 자료는 개별 이용허락을 확인한다. 독립 출처가 '웹에서 검색된다'는 사실만으로 파생 형상의 라이선스가 해결되지는 않는다.

## 잔여 작업 체크

1. **하천 29개:** `osm-independent-river-source-inventory.json`의 시스템별 81개 표본, 명칭·지류 경쟁 후보, 독립 기관 문서 등을 기준으로 실제 본류 식별 후 메타데이터 리팩. '라비강' 표기 수계가 인더스강 계통, '빠삭강' 표기 수계가 욤강·짜오프라야강 계통인 사례는 **기존 이름을 그대로 정당화하지 말고 정정 검토**.
2. **바이코누르:** Landsat 영상 밴드의 일시 접근과 실제 물가 추출을 연결하고, 정부 지도를 외부 검증 자료로 대조하며 원좌표계·조약 연대에 대한 독립 확인. 충족 시 **기하형상 실제 교체**.
3. **범위 검증:** 전체 현재 런타임에 OSM 파생 지명·국경·해안선/타일 자료가 없는지 유형별 검사. 연구 원본의 보존·폐기와 공개 지도 출처 제거는 별개.
4. **최종 교체:** 원본·변경본 SHA 검증, 지도 기능 회귀, data repository에 후보 등록, 앱 `work/gis` 연동 검사. `main` 병합/실제 배포 및 배너 제거는 운영 검증과 별도 지시 범위에서 시행.

## 원자료·법률 출처

- 카자흐스탄 1994 임대협정: https://old.adilet.zan.kz/rus/docs/U950002195_
- 카자흐스탄 2019 협정 개정: https://adilet.zan.kz/rus/docs/Z1900000282
- 카자흐스탄 정부 지도 서비스(참고 전용): https://gis.kgp.kz/arcgis/rest/services/KPSSU/Base_map_/FeatureServer
- USGS 영상 공개 영역 정책: https://www.usgs.gov/faqs/are-landsat-data-cloud-still-considered-be-within-public-domain
- Microsoft Planetary Computer 익명 토큰 정책: https://planetarycomputer.microsoft.com/docs/concepts/sas/
- 수에즈운하청: https://www.suezcanal.gov.eg/English/About/SuezCanal/Pages/AboutSuezCanal.aspx
- 2025 대한민국 국가지도집: https://nationalatlas.ngii.go.kr/pages/page_4065.php
- Natural Earth 하천 공공영역 자료: https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/


---

## 2026-11-03 전체 하천 소거 후보 (앞의 29개 잔존 중간 기록을 대체)

**최종 단계: Hydro v0.13.4 전수 일괄 후보 생성 성공. 해당 후보의 OSM 수계 연결 = 0개. 운영 배포 아님.**

검증된 링크: [31개 일괄 처리 및 실제 Viewer Worker 성공](https://github.com/kimjeon-il/Pando/actions/runs/41549869146).

- 기존 HydroRIVERS v0.13.2 자료 SHA-256: f0832dd2024cbfad8b1662410a4f189fa95bcecb56c3e3f1ad69d36af4a0c36f
- 신규 후보 v0.13.4 hydro.bin SHA-256: 82cd70c2c0434ecfbc6e8be53843527c2dc0318ecdf814731a8c7441295230e2
- 원래 OSM 관계 연결 수계 31개(af=2, eu=11, si=1, as=17)를 **31개 모두** 제거. OSM 관련 필드와 OSM 이름 소스 라벨, 수계 이름 보강용 별칭도 신규 후보에서는 제거한다.
- **독립 명칭 검토 21개** = 먼저 완료한 수에즈운하·남한강 2개 + 이번 정부·기관·학술 문헌/공개영역 Natural Earth 검사에 기초한 19개. 원래 42개 독립 검토 수계·기타 수계·호수 속성은 그대로 유지한다.
- **미명명 처리 10개** = 기존부터 미명명 2개(41386179, 41386700) + 독립 근거로 원래 이름을 승인하기 어려운 8개(10526283, 20628098, 20774342, 40188382, 41109275, 41171836, 41182380, 41390476). 이름이 법적으로 자유롭게 사용 가능한 일반 사실이라는 점과, 특정 Hydro 본류에 올바른 이름이라는 공간 증빙은 구분한다. 후자를 입증하지 못한 이름을 OSM에서 복사하는 대신 안정적 ‘미명명 수계 ID’를 표시한다.
- **오기 가능성이 높은 명칭 수정**: 41023100 라비강 → 인더스강(Natural Earth Indus 49/81, Ravi 7/81; 인도 정부는 인더스·라비를 구분), 41337891 빠삭강 → 욤강(Yom 56/81, Chao Phraya 28/81; 태국 관개청은 욤/빠삭 유역을 구분), 40415850 림진강/임진강 → 임진강, 41067217 브라마푸트라강/얄룽창포강 → 브라마푸트라강.
- **원본 위치·지도 시각 형상 불변**: 기존 압축 샤드 3개의 SHA-256이 그대로이고, 인덱스 SHA-256도 같다. 변경 대상은 검토된 31개 수계의 명칭·출처 메타데이터에 한정한다. 전체 16,548 피처 ID 순서와 비대상 core/detail 메타데이터, 인덱스, 강·호수 선형 바이트 일치 검사 통과.
- **실제 웹 Worker**: HTTP byte-range 방식으로 4회 부분 요청, HTTP 전체 응답 방식으로 1회 요청하는 검증 모두 성공. 위조한 후보 출처 검토 건수(29→28)는 Worker 초기화 단계에서 거부된다. 전체 16,548개 피처 복호화 후 OSM name/relation 정보가 남지 않음을 다시 확인했다.
- 결과 파일: tools/gis/hydro-bulk-independent-remaining29.json, tools/gis/stage-hydro-all-nonosm.mjs, .github/workflows/gis-hydro-all-nonosm-stage.yml. **GitHub Actions에 gis-hydro-v0.13.4-all31-nonosm-CANDIDATE 비배포 데이터 ZIP 저장**. 아카이브는 30일 보관이므로 영구 보존으로 간주하면 안 된다.
- 원본 지역 분류 정정: 수에즈운하의 HydroRIVERS 원자료 소속은 eu이다. 이전 임시 v0.13.3 조사에서 기록한 af는 오기이며 신규 전량 검증은 원본의 af=2/eu=11/si=1/as=17 집계를 강제한다.

### 운영에 반영되지 않은 사유

현재 공개 웹의 main 및 config/library-data.json는 여전히 원본 Hydro v0.13.2 데이터를 선택한다. 이번 작업은 work/gis의 코드·검증 경계·실제 후보 데이터까지 준비한 것이며, 임의로 data repository의 운영 커밋·웹 Pages 또는 메인 출처 표기를 바꾸지 않았다. 배포본에 새로운 v0.13.4 데이터 자산을 영구 저장하고 모든 하드코딩된 0.13.2 참조를 새 데이터 pin과 함께 전환한 뒤 UI/Worker/Pages를 검증하는 **별도 통합 단계**가 남아 있다.

바이코누르 임대구역 강변과 독일 헬골란트 연구용 OSM 참조는 하천 명칭 패키지 교체 대상에 포함하지 않았고, 해당 OSM 자료가 남아 있으므로 **메인 지도 © OpenStreetMap 출처 표기는 그대로 유지**한다. 독립 공식 형상이 확인되기 전에는 ODbL 표기를 제거하지 않는다.
