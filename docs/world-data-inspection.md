# 세계지도 데이터 부분 조회 도구

`tools/inspect-world-data.mjs`는 GIS 자료 조사·검증을 위해 필요한 국가와 지도 구간만 추출하는 **읽기 전용** CLI다. 세계 통합 `current-world.geojson`과 렌더링 전용 PCG/메시는 열지 않는다.

- 국가·역사적 국가: `assets/data/territorial-entities/generated/v2/index.json`으로 식별한 **해당 국가 압축 청크만** 해제하고 SHA-256을 검사한다.
- 국가 선택 없이 영역만 지정하는 경우: `current-world` 스냅샷에 속한 국가의 색인을 BBOX로 사전 필터링한다. 이것이 임의 시점의 역사적 세계지도라는 뜻은 아니다.
- 강·호수: `assets/data/hydro/rivers_base.geojson` 또는 `lakes_base.geojson`을 요청할 때만 읽어 영역별 결과를 반환한다. 이 원본 수계 파일 자체를 지역별로 스트리밍하는 구현은 아니므로 전 지구 수계 조회는 피한다.
- 원본 파일은 수정하지 않으며, 새로운 파일은 `--out`으로 지정한 곳에만 생성한다. `assets/data` 아래 출력은 금지한다.

## 실행 예시

저장소 루트에서 Node.js로 실행한다. 별도 패키지 설치는 불필요하다.

```sh
# 데이터 조회 대상 검색 (압축 청크를 해제하지 않음)
node tools/inspect-world-data.mjs --mode list --bbox 3,50,9,55

# 네덜란드 원본 형상 통계 (좌표 수, 폴리곤 수 등)
node tools/inspect-world-data.mjs --country NLD --mode summary

# 독일 북해 연안의 국경/해안선 후보만 추출
node tools/inspect-world-data.mjs --country DEU --bbox 6,53,9,55 --mode boundary --out /tmp/germany-north-sea.geojson

# 네덜란드 원본 육지 다각형, 분리된 구성요소만 추출
node tools/inspect-world-data.mjs --country NLD --bbox 3,50,8,54 --mode polygon --out /tmp/netherlands.geojson

# 강 / 호수의 지정 지역 조사
node tools/inspect-world-data.mjs --bbox 4,50,8,54 --mode rivers --out /tmp/river.geojson
node tools/inspect-world-data.mjs --bbox 4,50,8,54 --mode lakes --out /tmp/lakes.geojson

# 역사 국가의 정확한 entity ID를 이미 아는 경우
node tools/inspect-world-data.mjs --country state:north-schleswig --date 1900-01-01 --mode summary

# 출력당 최대 크기 제한 (초과 시 *.part-0001.geojson 등으로 자동 분할)
node tools/inspect-world-data.mjs --country DEU --mode boundary --out /tmp/deu.geojson --max-bytes 1000000
```

`--country`는 ISO3 코드(`NLD`, `DEU`), 정확한 엔티티 ID(`state:DEU`) 또는 중복 없는 계보 ID를 받는다. `germany`처럼 하나의 계보에 여러 엔티티가 들어 있으면 정확한 ID를 요구한다. `--bbox`는 EPSG:4326 경도·위도 순서 `서쪽,남쪽,동쪽,북쪽`이며 날짜변경선을 넘을 경우 두 번 나누어 조회한다.

## 출력 해석과 안전성

- `summary`: 압축 크기, 형상 버전, 기록된 출처, 좌표·폴리곤·링 개수와 경계 범위를 JSON으로 반환한다.
- `polygon`·`lakes`: BBOX와 *외접사각형이 겹치는* 원본 Polygon 구성요소를 **그대로** 반환한다. 정확한 폴리곤 교집합이나 폴리곤 절단 결과가 아니므로 좌표가 요청 BBOX 밖으로 나갈 수 있다. 이 방식은 원본 해안선 좌표와 내부 구멍을 보존한다.
- `boundary`·`rivers`: BBOX 내부 선분만 `LineString`으로 반환한다. 잘린 부분의 **인공 교점**은 개별 피처의 `syntheticClipStart`, `syntheticClipEnd`로 표시한다. BBOX 가장자리를 따라 가짜 폐합선을 생성하지 않는다. 날짜변경선을 가로지르는 180도 초과 점프는 지역 조회에서 오탐 방지를 위해 제외한다.
- `boundary`에는 **육상 국경과 해안선이 모두** 들어 있다. 해안선 여부를 결정하려면 이웃 국가의 다각형이나 별도 지리 데이터와 교차 검증해야 한다.
- 과거 날짜 선택은 등록된 `geometryVersions` 안에서만 수행된다. 'current' 데이터만 있는 국가의 현재 지형을 임의의 역사적 시점으로 위장하지 않는다. 과거 국경·간척을 복원하는 기능은 아니다.
- 기본적으로 한 번에 12개 엔티티와 출력 파일 1MB를 허용한다. 범위가 넓으면 구간을 좁히거나 `--max-entities`, `--max-bytes`를 명시적으로 변경한다. 분할 결과는 `*.part-NNNN.geojson`으로 저장하며 기존 출력물은 `--force` 없이는 덮어쓰지 않는다.

## 검증

```sh
node --test tests/unit/world-data-inspection.test.mjs
```

테스트에서는 국가 색인 기반 선택, 원본 좌표 보존, BBOX 경계 교점 표시, 수계 추출, 자동 분할, 파일 해시, 기존 출력 보호, 역사적 시점의 오용 방지 등을 검사한다.
