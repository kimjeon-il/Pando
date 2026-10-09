# 현재 웹 수계 무명 인벤토리 (2026-10-08 UTC)

## 확정 요약

대상은 `https://kimjeon-il.github.io/Pando/`의 실제 내려받은 **hydro v0.13.1**이다. 웹 `main` 조사 기준은 `fd6744f5e72a0c1a107452dbde6d416ab57237db`. 배포 build-meta와 hydro manifest가 이 SHA의 파일과 byte-for-byte 일치한다. dataRevision은 `data-3665a413a39994ae112a4eac75d78341`, buildId는 `0.36.0-build-f5040d34a1f5`. 배포 자체의 Git commit SHA는 공개 build-meta에 없으므로 main SHA와 동일한 배포 commit이라고 단정하지 않는다. 표시 관련 worker/property 코드 3개도 배포와 main이 일치한다.

- 강: **MAIN_RIV 기준 논리 묶음 3,818개**, geometry feature **15,193개**.
  - 의미 있는 대표명 **363개**. 모두 한국어 표기가 들어 있다.
  - 대표명 미해결 **3,455개**: `미명명 수계 <ID>` **3,444개** + `river-<숫자>` **11개**.
  - 이 중 **3,450개**는 배포된 name/mainstemNameKo/aliases/tributaryNames에 의미 있는 이름이 없다.
  - **5개**는 대표명이 placeholder지만 관련명/지류명은 있다. 본류명 검증 전 자동 승격 금지.
- 호수: 논리 객체/geometry feature **1,355개**. 한국어 명칭 **745개**, `lake-<숫자>` placeholder **610개**. 후자 610개의 원천 name_ko/name_en/name_original은 모두 공란.
- 따라서 이번 배포에는 **의미 있는 외국어명이 존재하지만 한국어명만 빠진 별도 대표명 그룹은 0개**다. 빈값과 숫자 placeholder를 구별하지 않으면 호수 610개와 강 11개를 명명된 것으로 오집계한다.
- 전체 논리 객체 5,173, geometry feature 16,548. 독립된 자연 하천 개수라고 해석하면 안 된다.

`inventory.json.gz` / `inventory.csv.gz`: 전수 목록. `priority-candidates.json`: 강의 표시 본류 길이순 30개 + 호수 표시 면적순 30개. `summary.json`: 수치·기준·입력 SHA-256. 압축하지 않은 목록은 스크립트 재실행으로 생성된다.

## ID와 원천 구조

- HydroRIVERS 1.0: sourceId는 HYRIV_ID **reach ID들의 쉼표 구분 목록**. systemId는 MAIN_RIV로 묶은 논리 집합이다. `river_system_key()`는 chain에서 가장 흔한 MAIN_RIV를 선택하고, `river_systems()`는 동일 키의 본류·지류를 같은 집합으로 묶는다. `awId=hydro-system:<systemId>`.
- MAIN_RIV는 연결 수계의 최하류 reach 기준이므로 한 집합이 여러 독립 고유명 하천을 포함할 수 있다. `role=mainstem`은 builder가 종점 ID, upstream area/flow 등으로 고른 chain의 표시 역할이다. 자연명칭 동일성을 보증하지 않는다.
- `fid`는 geometry fragment, `logicalFid`는 현재 빌드의 논리 객체 번호. 후속 데이터 개편 시 영구 ID로 fid/logicalFid만 사용하지 않는다. awId/systemId와 원천 hash, source IDs를 함께 확인해야 한다.
- Natural Earth 5.0.0 lakes: source_id 기반 일대일 조인. 1,355개 정본 행과 현재 메타데이터가 대응한다. geometry/이름/위키데이터 ID는 정본에서 읽었다. Natural Earth river 참고자료는 최종 Hydro geometry와 다른 집합이며 개수를 합산하지 않는다.
- core metadata에는 이름/bbox/FID/역할, lazy detail에는 sourceId/source/aliases/tributaryNames/osmRelationIds. v0.13.1은 v0.13.0의 index/detail/geometry 3 shards를 참조한다. manifest 상대 URL을 따라가야 한다.
- 508,255 source reach 매핑을 보고서마다 복제하지 않는다. 각 행의 geometry_fids + `source_ids_locator`, 정렬한 unique source ID 목록의 SHA-256, 원본 detail 파일 SHA-256을 보존한다. 원천 gzip을 검증 후 FID로 읽으면 정확히 복구된다. lakes의 source_id는 목록에도 직접 저장했다.

## 표시 문제와 실제 누락 구분

1. `app-property-selection.js:hydroEditorName`은 `미명명 수계 <ID>`를 `이름 없는 강`으로 표시한다. 숫자 lake-N/river-N은 현재 이 정규식에 포함되지 않아 문자열 자체가 이름처럼 통과한다. 실제 데이터 결손을 가리는 패턴이다.
2. worker는 core의 name을 그대로 name/name_ko로 넘긴다. **name_ko라는 필드명만으로 한국어 또는 검증명임을 판단하면 안 된다.** lazy detail 로드 여부와 관계없이 대표명은 core에 있다.
3. property panel은 대표 name/mainstem_name_ko를 쓰며 aliases/tributaryNames를 대표명으로 자동 선택하지 않는다. 관련명 5개는 표시 승격 누락 후보이면서 오명명 위험 후보다. 지류명일 수 있으므로 버그 확정이나 자동 전파를 하지 않는다.
4. 표시 stage에 따라 geometry가 나타난다. 대표명 미해결 강 묶음 최소 stage 분포는 0:110, 1:272, 2:413, 3:2660. 호수는 0:298, 2:312. 무명이라고 전부 작은 객체는 아니다.
5. 이번 검사는 정적 데이터+표시 코드 분석이며 화면의 zoom/가시성/충돌까지 브라우저 재현한 것은 아니다. 의미 있는 대표명이 있는데 실제 UI에 안 보이는 건수는 **미측정**. 이름이 있어도 지도 라벨이 항상 나타난다는 뜻은 아니다.

관련명 검수 5개: 10899527(음밤), 41386179(사이공), 41386700(밤꼬떠이), 50420287(플라이), 80044492(매켄지·리아드·피스·핀레이 등). 마지막 사례처럼 집합에 다수 고유명이 있는 경우 특히 수계명 일괄 전파를 피한다.

## manifest 통계 차이의 재현 가능한 원인

manifest는 named 377/unnamed 3441이지만 실제 미명명 placeholder는 3444다. `tools/promote-hydro-names.mjs`는 v0.13.0 통계에 **override 총수 26을 신규명명처럼 가감**한다. 실제 신규 placeholder→명칭 전환은 23개이고 다음 3개는 이미 이름이 있던 수정이다.

- 20282220: 오데르강 → 엘베강
- 20282318: 오데르강 → 오데르강
- 20323928: 렉강 → 라인강

v0.13.0의 미명명 3467 - 실제 신규 23 = 3444. manifest는 3467 - 26 = 3441. 또한 river-N 11개를 명명으로 세는 별도 문제까지 있어 의미 있는 대표명은 374가 아니라 363이다. 제품 파일이나 통계는 이번 조사에서 수정하지 않았다.

## 우선 조사 방향

- 먼저 related-name 5개를 MAIN_RIV/본류 geometry/OSM relation membership으로 확인. alias를 복사만 하지 않는다.
- 강은 `rendered_mainstem_length_km`와 낮은 stage를 우선하되 길이가 큰 수계는 본류와 지류를 나눈다. network length는 집합의 모든 표시 지류까지 합한 값이다.
- 호수는 `rendered_area_km2` 내림차순. source_id와 원본 polygon, wikidata_id를 먼저 확인하고 국가별 공식 수역 명칭 대조로 진행한다.
- 주변 좌표·bbox·중심점은 후보 검색용이고 동일객체 증거가 아니다. 이름 없는 객체에 최근접 지명을 자동 부여하지 않는다.
- 길이/면적은 현재 표시 geometry의 구면 근사값이다. 국경 정렬/해안 연결 등이 적용된 표시 형상으로 계산했으며 공식 수문학 길이·면적이 아니다.

## 재현

Python 표준 라이브러리와 Node만 사용. 원본 HydroRIVERS 전세계 Shapefile 다운로드는 필요 없다. 입력 다운로드는 총 약 31MB(geometry 약 9.5MB 포함), 개별 shard 4MiB 이하이며 manifest SHA-256/크기를 검사한다.

1. 작업 폴더 밖 입력 디렉터리에 배포 build-meta.js를 `deployed-build-meta.js`, `hydro/v0.13.1/manifest.json`을 `deployed-manifest.json`으로 저장한다. 기준 SHA의 manifest는 `git show fd6744f5e72a0c1a107452dbde6d416ab57237db:assets/data/hydro/v0.13.1/manifest.json`으로 `main-manifest.json`에 저장한다.
2. manifest 상대 URL대로 v0.13.1/metadata-core.json.gz, v0.13.0/metadata-detail.json.gz, v0.13.0/index.bin.gz, v0.13.0/shards/s0.bin~s2.bin을 내려받아 버전 디렉터리를 유지한다. core/detail 파일은 입력 디렉터리 바로 아래에도 같은 이름으로 둔다. v0.13.1/manifest.json에도 배포 manifest를 둔다.
3. hydro/lakes_base.geojson, hydro/rivers_base.geojson을 입력 디렉터리에 저장한다. summary의 SHA-256과 manifest의 source hash를 확인한다. 나중에 배포가 바뀌면 URL의 최신 자료를 이번 조사자료로 혼용하지 않는다.
4. `node tools/decode-hydro-connectivity.mjs INPUT/v0.13.1 INPUT/decoded.json`
5. `python tools/inventory-hydro-names.py --input INPUT --output reports/hydro-names/current-web-2026-10-08 --baseline-sha fd6744f5e72a0c1a107452dbde6d416ab57237db`
6. `python -m unittest discover -s tests -p test_hydro_name_inventory.py`

검증: production decoder로 16,548 features / 902 packs / 3 shards를 읽고 중복/누락·hash·크기 검증. metadata core/detail/정본 조인 및 logicalFid consistency 검증. placeholder/구면길이/면적 unit test 2개 통과. 전체 제품 CI·빌드·포터블 패키지는 실행/생성하지 않았다. 제품 명칭·좌표·데이터 수정, main 병합, 배포 없음.
