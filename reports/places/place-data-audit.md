# 현대 정착지 후보 데이터: GeoNames 1차 필터 감사

기준 코드: `01e80f04e48a825bf91775097585bf1d9723f2b6` (2026-10-02).
이번 산출물은 후보 추출·품질 감사이며, 배포 지명 데이터나 최종 자동표시 순위가 아니다.
기존 `assets/data/places/manifest.json`, Worker, 지도 렌더링, UI는 변경하지 않는다.

## 출처와 정책

[공식 GeoNames dump](https://download.geonames.org/export/dump/)의 `cities500.zip`을 우선한다.
`allCountries.zip`은 공식 fallback 및 원천 누락 대조용이며, 원본 ZIP과 NDJSON 후보는
`reports/places/.cache/`에만 둔다. 둘 다 공식에서 수집되며 미러는 사용하지 않았다.
[공식 README](https://download.geonames.org/export/dump/readme.txt)는 UTF-8 탭 구분 19개 필드,
WGS84 좌표, CC BY 4.0을 명시한다. 데이터 정확성·완전성은 보장하지 않는다.
`cities500` 자체가 이미 인구 500 초과 또는 PPLA4까지 행정중심을 추린 원본이므로
아래 '원본 전체'는 GeoNames 전체 DB 행 수와 같지 않다. 전체 DB 대조 수치는 별도로 표기한다.

canonical 포함 정의는 `tools/build-place-candidates.py`의 `candidate()` 하나다.

```text
featureClass == P AND (
  featureCode in {PPLC, PPLG, PPLA, PPLA2}
  OR (featureCode == PPL AND population >= 50,000)
)
```

코드의 의미는 [공식 feature code 표](https://www.geonames.org/export/codes.html)에 따른다.
PPLC·PPLG의 inclusionReason은 `capital`이며 PPLG가 반드시 법적 수도라는 뜻은 아니다.
PPLA·PPLA2는 인구가 0이어도 유지한다. PPLA3 이상이나 다른 P 코드는 인구가 커도 포함하지 않는다.
일반 PPL은 5만 미만을 제외한다. 이름, 국가, 인접성은 포함 조건이 아니다.
누락 인구는 0으로 정규화하되 원본의 빈 인구 필드 건수를 별도로 센다.

100만 이상 / 10만–999,999 / 5만–99,999 / 저인구 행정중심으로 나눈다.
10만 이상은 `auto-review`(자동표시 심사 대상), 나머지는 `search-only`이다.
최종 rank/minZoom/중심성은 계산하지 않았다. ID가 다른 동명·동좌표 레코드도 합치지 않는다.

## 재현과 결과 파일

Python 3.11+ 표준 라이브러리만 사용한다. 저장소 루트에서:

```sh
python -X utf8 tools/build-place-candidates.py fetch
python -X utf8 tools/build-place-candidates.py build
python -X utf8 -m unittest discover -s tests -p test_place_candidates.py -v
```

`fetch`는 공식 원본을 시도하며 검증된 로컬 스냅샷이 있으면 재사용한다. 다른 날짜의 최신 원본을
받을 때는 `--cache <새 로컬 캐시 폴더>`를 사용해 기존 스냅샷을 보존한다.
`build`는 네트워크를 사용하지 않으며 ZIP SHA-256을 먼저 확인한다. JSON 통계와 아래 표시된
통계 영역만 재생성한다. 사람이 쓴 분석 영역은 보존한다. 같은 캐시 입력으로 build를 반복하면
결과가 같다. 새 스냅샷을 받으면 사람이 쓴 분석의 날짜·수치·사례도 반드시 다시 검토해야 한다.

- `reports/places/geonames-statistics.json`: 출처·해시, 전 국가 통계, 6개국 상위 30개·저인구 표본, 자동 감사 신호.
- `reports/places/.cache/candidates.ndjson`: 재생성 가능한 전체 후보. 필수 원본 필드와 3개 파생 필드 포함.
- `.cache/*.source.json`: 다운로드 시각·HTTP 수정 시각·ZIP 내부 시각과 SHA-256.
- `.cache/fetch-attempts.json`: 단계·URL·시도·실패 이유. 부분 다운로드는 정식 원본으로 채택하지 않는다.

## 사람이 검토한 결과와 다음 단계

### 기술적 판정

**재현 가능한 1차 후보 풀로는 사용할 수 있다. 현대 정착지 최종 DB나 자동표시 목록으로
그대로 사용할 수는 없다.** 두 공식 원본에 같은 정책을 적용했을 때 후보 ID·내용은 모두
일치했으므로 `cities500`의 사전 추출 때문에 이번 채택 코드가 추가로 누락된 것은 아니다.
원하는 도시가 빠지는 원인은 주로 **행정 단계 코드의 의미 차이와 낮거나 미상의 인구**다.
반대로 내부 구역이 남는 원인은 PPLA2가 어떤 국가에서는 borough/구/읍의 중심에도 사용되고,
PPL도 모든 나라에서 독립 도시만 뜻하지 않기 때문이다.

이번 필터는 요청대로 유지했다. 검토 결과를 이유로 PPLA3를 포함시키거나 국가별 분기,
이름 기반 제외, 동명 ID 병합, 최종 순위·지역 중심성 계산을 추가하지 않았다.
기존 내장 지명 런타임의 비어 있는 배포 manifest도 그대로다.

### 한국: 전체 113개를 확인한 sanity check

113개 중 5만+ 96개, 10만+ 56개, 저인구 행정중심 17개다.
서울, 부산, 인천, 대구, 대전, 광주(1841811), 울산, 세종이 모두 포함된다.
저인구 영덕·연천·청양·화천·보성·하동 등은 지역 검색 후보를 확보하는 방향에 맞는다.
그러나 이 수치가 한국 시·군의 수나 완전한 목록을 뜻하지는 않는다.

과다 수록의 구체 사례:

| ID | 기록 | 포함 원인 | 검토 결과 |
| --- | --- | --- | --- |
| 1832034 | Yuseong | PPLA2, 인구 0 | [대전 유성구](https://www.yuseong.go.kr/)의 구급 중심, 원하는 시·군 범위와 다름 |
| 1834203 | Dongnae | PPLA2, 인구 0 | [부산 동래구](https://www.dongnae.go.kr/index.dongnae?menuCd=DOM_000000107003009000)의 구급 중심 |
| 1839110 | Beobwon | PPLA2, 인구 0 | [파주 법원읍 현황](https://dong.paju.go.kr/dong/dong_01/dong_01_02/dong_01_02_02.jsp)으로 읍급 확인; 코드가 시·군급을 보장하지 않음 |
| 1833332 | Tallang-dong | PPL, 54,954 | 이름과 원본 별칭의 동급 신호; 코드만으로 동을 제거할 수 없음 |
| 1897118 / 1912209 | Hwado / Wabu | PPL, 106,358 / 96,775 | 남양주 내부 읍급 의심; 서로 다른 ID를 남겨 후속 소속 검증 필요 |
| 1896953 / 1925936 / 1925943 | Pubal / Naesŏ / Hwawŏn | PPL, 63,026 / 80,987 / 64,718 | 인구 기준을 넘는 미세 정착지 의심; 이름을 근거로 자동 제외하지 않음 |
| 1841246 | Masan | PPL, 434,371 | **2026-10-03 정정:** 원본 좌표 35.12725, 126.83149와 admin1=18/admin2=24020은 광주 쪽이다. 창원 마산 통합 사례만으로 설명할 수 없으며 이름·위치·인구 불일치 검토까지 보류 |

과소 수록의 구체 사례:

| ID | 기록 | 코드 / 인구 | 제외 원인 |
| --- | --- | --- | --- |
| 1843137 | Gangneung | PPLA3 / 208,161 | [강릉시](https://www.gn.go.kr/)인데 채택 코드 밖. 이번 원본에 이를 대체하는 동명의 채택 PPL은 없음 |
| 1832501 | Yeonggwang | PPLA3 / 51,688 | 5만 이상이어도 PPLA3이므로 제외 |
| 1842966 | Gijang | PPLA3 / 176,388 | 행정중심 후보이지만 PPLA3이므로 제외; 군 단위 자체와 중심 정착지의 구분은 후속 검토 |
| 1845388 | Cheorwon | PPLA3 / 40,646 | 저인구 PPLA3 지역 중심 후보가 제외 |
| 1832909 | Yanggu | PPL / 24,027 | 군 중심 후보도 PPL이면 5만 미만 제외 |
| 1843542 | Inje | PPL / 0 | 군 중심 후보인데 원본 인구 0이므로 제외 |
| 1833763 | Ulchin | PPL / 0 | 울진 중심 후보의 인구 누락 가능성. 별도의 Uljin(11888734, 0)도 있지만 합치지 않음 |
| 1835515 / 1838069 | T’aebaek / Santyoku | PPL / 48,962 / 42,145 | 태백·삼척 검색 후보가 5만 기준 미달 |

인제·울진 등의 중요한 정착지 여부는 원본 위치와 원본 별칭을 대조한 **검토 후보**다.
같은 별칭을 가진 다른 마을도 존재하므로 모든 인구 0 기록을 복원하는 방식은 부적절하다.
원본 주 이름에는 `Eisen`, `Nangen`, `Kyosai`처럼 현대 한국어 검색명으로 바로 쓰기 어려운
표기도 남는다. 이번에는 이름을 변경하거나 한국어 라벨/별칭 검색을 구현하지 않았다.

### 나머지 5개 국가: 표본 해석

- **JP:** 저인구 PPLA2 312개는 작은 시정 중심 확보에 도움이 되지만 Ōta(8469289, 748,081)는
  [도쿄의 특별구](https://www.english.metro.tokyo.lg.jp/municipalities-within-tokyo)다.
  **2026-10-03 정정:** Kotō(11209896, 543,730)는 원본 좌표가 구마모토 쪽(32.77856, 130.74537)이고
  江東区/湖東 별칭이 혼재한다. 도쿄 특별구로 단정했던 설명은 철회하고 정체·인구 검토 대상으로 보류한다.
  Ōta(1853677, 224,358)는 같은 이름의 다른 ID이므로 구와 시를 이름으로 합치면 안 된다.
  Aihara(1865689, 725,493)는 Sagamihara(11611609, 720,780)와 함께 상위 표본에 나와
  대표 지명/인구 영역 불일치 의심으로 남긴다. 제외 PPLA3 표본의 Kamigyō-ku는 오히려 내부 구역이라
  모든 PPLA3의 복구가 해답은 아니다.
- **CN:** 후보 670개 중 저인구 행정중심은 10개뿐이다. Wenzhou(1791388, 2,650,000),
  Kunshan(1785623, 2,092,496) 등 큰 PPLA3가 빠진다.
  **2026-10-03 정정:** Puyang(1798425, 3,590,000)은 浙江/3307의 浦阳街道/浦江 별칭을 가진 기록이다.
  河南의 濮阳市(9181182)는 이미 PPLA2 후보에 있으므로 전자를 동일 대도시 누락 사례로 쓰지 않는다.
  같은 제외 목록에는 Bao'an·Songjiang·Yangpu 같은 내부 구역 의심 기록도 포함되어 있다.
  대도시 인구는 행정구역 전체와 시가지 인구가 섞였을 수 있으므로 순위에 바로 쓰지 않는다.
  Xihai Town(7,100), Gar(24,910) 같은 작은 행정중심은 남아 있어 해당 지역 검색에 유용하다.
- **IN:** 소규모 PPLA2 Peddapalli·Khambhāliya·Nārāyanpet 등은 지역 검색 후보에 적합한 방향이다.
  반면 이름이 `Defence Colony`인 PPLA2/인구 0 및 Rasapūdipalem·Najafgarh의 큰 인구는
  내부 구역/인구 영역 검토가 필요하다. Latur(1265014, 382,940), Deoghar(1273241, 203,123) 등은
  PPLA3라 빠진다. 사례마다 공식 행정 소속을 대조하기 전 자동 수정하지 않는다.
- **US:** 저인구 행정중심 2,721개는 county seat 검색 후보를 확보한다. 하지만 Brooklyn·Queens·
  Manhattan·The Bronx·Staten Island는 [뉴욕의 borough이자 county](https://portal.311.nyc.gov/article/?kanumber=KA-02877)이므로
  PPLA2가 도시 내부 구역 제거를 보장하지 않는다. Cranston(5221659, 81,073), Tigard(5756758, 51,253)는
  PPLA3라 제외된다. 인구 0인 Appling·Currituck 등도 행정중심이므로 유지하되 0을 실제 무인 정착지로 해석하지 않는다.
- **BR:** Pilão Arcado·Ilhabela·Socorro·Diamantina 등의 작은 PPLA2 중심이 남는다. 일부 PPLA2는
  인구 0이며, 최종 이름·좌표·시가지 인구를 확인해야 한다. 이번 6개국 5만+ PPLA3 감사 표본에는
  BR 사례가 없지만 이는 브라질의 모든 지역 중심이 완전하다는 증명이 아니다.

### 세계 과다 수록과 중복 의심

이름 키워드 신호는 5개지만 이를 실제 오류 건수라고 보고하지 않는다.
`College Station`, `Oliveira do Hospital`처럼 정상 정착지 이름도 걸린다.
비-P 시설/자연/수계 코드는 모두 제외됐고, 수록 후보 중 **확정된 시설 POI 사례는 발견하지 못했다**.
잘못 P 계열로 분류된 POI가 전혀 없다는 보장은 할 수 없다.

정확히 같은 좌표의 후보 그룹은 7개(14개 레코드, 최대 그룹 2개)다.
태국의 Siao/Benchalak, Samran/Sam Chai 등과 인도의 Daman/Nani Daman이 해당한다.
국가·정규화 이름이 같고 1km 이내인 ID 쌍은 2개다.
이 숫자는 '확정 중복'이 아니라 사람 검토 신호이며 후보를 삭제하거나 합치지 않았다.
특히 별칭/하위 정착지/대표 행정 좌표 재사용을 지리적 근접만으로 구분할 수 없다.

### 세계 과소 수록과 낮은 인구

전체 원본 PPL 중 인구 0 기록이 4,304,628개 제외됐다. 대부분 작은 지명일 수 있지만
인구 0은 '실제 인구가 0'과 '자료 미입력'을 구분하지 못한다. 중요한 도시의 완전성 증명이 아니다.
별도 제시한 원본 첫 12개 표본은 대표 중심지를 확정하는 표본이 아니며 의도적으로 그대로 보고한다.

작은 중심지를 보호하는 효과도 확인했다: Nuuk(14,798, PPLC), Iqaluit(7,429, PPLA),
Longyearbyen(2,368, PPLC), Alice Springs(25,912, PPLA2), Mount Isa(18,317, PPLA2),
Hanga Roa(7,322, PPLA2)는 유지된다. 반면 아래의 소규모 지역·섬 중심 검토 후보는 제외된다.
아래 모두 원본의 위치·코드·인구를 직접 확인했으며, 유일한 중심지 여부나 서비스권역은 계산하지 않았다.

| ID | 국가 | 기록 | 코드 / 인구 | 감사 이유 |
| --- | --- | --- | --- | --- |
| 5983607 | CA | Inuvik | PPL / 3,243 | 북부 지역 중심 검토 후보; 인구 기준 미달 |
| 6089245 | CA | Norman Wells | PPL / 1,027 | 북부 저밀도 지역 검색 누락 의심 |
| 5979345 | CA | Igloolik | PPLL / 2,049 | 북극 지역 정착지이지만 미채택 코드 |
| 3831208 | GL | Qaanaaq | PPL / 646 | 고위도 작은 중심 검토 후보 |
| 3424607 | GL | Tasiilaq | PPL / 1,985 | 동부 그린란드 중심 검토 후보 |
| 3422891 | GL | Ittoqqortoormiit | PPL / 345 | cities500 밖인 정착지도 전체 dump에서 확인, 정책상 제외는 동일 |
| 4030556 | PF | Rikitea | PPL / 1,103 | 섬의 작은 중심 검토 후보 |
| 2144209 | AU | Weipa | PPL / 2,830 | 저밀도 지역 중심 검토 후보 |
| 2060436 | AU | Tennant Creek | PPL / 3,080 | 저밀도 지역 중심 검토 후보 |

고위도 감사는 위도·코드·인구만으로 실행한다. 결과 상위 표본에 Åsane·Kópavogur 등 대도시 주변
정착지도 있으므로 **고위도 = 오지 = 유일한 중심지**라고 판정하지 않는다. 열대 섬의 모든 중심지나
세계 각 지역의 완전성을 이 자동 신호만으로 검사했다고 주장하지 않는다.

### 다음 단계에서 필요한 판단

2026-10-03의 ID별 확인 제외·보류·예외 검토와 별도 정제본은 [후속 후보 검토](place-candidate-review.md)에 기록한다.
아래 원래 통계와 `candidate()`의 1차 정책은 그대로 유지한다.

1. KR 강릉·지역 군 중심, CN 큰 PPLA3, IN Latur/Deoghar, US Cranston/Tigard 등의
   **소수 중요 누락 ID**부터 공식 행정 소속·정착지 좌표를 확인한다.
2. KR 구/읍/동, US borough, JP 특별구는 검색/표시 DB에 남길 범위를 먼저 결정하고
   확인된 ID에만 이유·출처를 가진 제외 또는 유형 보정을 설계한다. 이번에는 override를 구현하지 않는다.
3. CA/GL/PF/AU 등 작은 지역·섬 중심에는 검토된 inclusion 예외가 필요할 수 있다.
   이를 모든 저인구 PPL 복구나 국가별 대량 PPLA3 대응으로 대체하지 않는다.
4. 인구 출처·시점·시가지/행정구역 범위와 현대 대표 이름을 확인한 뒤 ranking 단계로 진행한다.
   서로 다른 ID를 이름/거리만으로 병합하지 않는다.

### 검증·실패·보존 범위

원본·후보 좌표/인구 및 후보 ID 유일성, 비-P·미채택 코드·저인구 PPL 제외는 실제 빌드에서
검증한다. 저인구 수도 유지, 경계 인구값, 의미 있는 빈 국가 경고, 동명 ID 보존, hash 오류,
오프라인 재생성, 공식 fallback을 작은 fixture로 검사한다.
집중 단위검사 14개와 변경 Python 문법 검사 통과. 실제 후보 NDJSON 및 통계 JSON을 동일 원본으로
재생성해 SHA-256이 동일함을 확인했다. 후보는 32,277개이며 countryCode 없음 경고는 0개다.

공식 서버의 순차 전체 ZIP 전송이 약 100MB까지 매우 느려 해당 전송만 중단했다.
같은 공식 URL에 대해 저장소의 기존 `download-terrain-source.py`로 HTTP 206/Content-Range를 검증하는
병렬 Range 전송을 사용했고 다운로드 전후 ETag/수정 시각 일치, ZIP CRC와 SHA-256을 확인했다.
HTTP 오류나 미러 사용은 없었고 정확도 저하는 없다. 중단된 부분 파일은 ignored cache에만 남는다.

세계 모든 정착지의 의미를 공식 행정 자료로 전수 확정한 것은 아니다. 감사 신호와 확인된 대표 사례를
분리해서 기록했다. 최종 ranking·중심성·번역·Worker/shard·렌더링/UI 연결, 전체 테스트·브라우저 회귀,
push·배포는 이번 범위에서 의도적으로 실행하지 않는다. 이전 미커밋 UI worktree는 건드리지 않았다.

<!-- geonames-statistics:start -->

## 재생성 가능한 실측 통계

### 원본과 무결성

- [cities500](https://download.geonames.org/export/dump/cities500.zip): 다운로드 `2026-10-01T16:00:08.628878+00:00`; 서버 수정 `Thu, 01 Oct 2026 02:08:51 GMT`; ZIP 내부 시각 `2026-10-01T04:01:28` (시간대 미표기); 13,862,948 bytes.
  SHA-256 `4ba815404241c08ca40a5dcdcfe35dee4ae51bb848bfff2c01d8ad35507ae232`. GeoNames 원본, CC BY 4.0.
- [allCountries](https://download.geonames.org/export/dump/allCountries.zip): 다운로드 `2026-10-01T16:15:06.202944+00:00`; 서버 수정 `Thu, 01 Oct 2026 02:08:51 GMT`; ZIP 내부 시각 `2026-10-01T04:01:26` (시간대 미표기); 422,003,018 bytes.
  SHA-256 `feb2ac2a61e9a242e76df4dccfea8708bbe5665d523a9b372ddc946372b4e892`. GeoNames 원본, CC BY 4.0.

주 원본: `cities500`. alternateNames는 후보 파일에서 생략했다.

| 지표 | 건수 |
| --- | --- |
| 원본 전체 | 235902 |
| featureClass P | 235902 |
| 최종 후보 | 32277 |
| 인구 ≥1M | 529 |
| 인구 ≥100k (1M 포함) | 5346 |
| 인구 50k–99,999 | 4888 |
| 저인구 행정중심 | 22043 |

### 최종 feature code / 인구 구간 / 모드

| featureCode | 최종 건수 |
| --- | --- |
| PPL | 5188 |
| PPLA | 3464 |
| PPLA2 | 23375 |
| PPLC | 241 |
| PPLG | 9 |

| populationBucket | 건수 |
| --- | --- |
| 100k-999k | 4817 |
| 1m-plus | 529 |
| 50k-99k | 4888 |
| under-50k-admin | 22043 |

| preliminaryDisplayMode | 건수 |
| --- | --- |
| auto-review | 5346 |
| search-only | 26931 |

### 제외한 P 코드 (주 원본)

| code | 건수 |
| --- | --- |
| PPL | 134327 |
| PPLA3 | 30530 |
| PPLA4 | 27355 |
| PPLA5 | 30 |
| PPLCH | 1 |
| PPLF | 47 |
| PPLH | 27 |
| PPLL | 600 |
| PPLQ | 41 |
| PPLR | 4 |
| PPLS | 45 |
| PPLW | 9 |
| PPLX | 10561 |
| STLMT | 48 |

### 모든 원본 국가 코드별 후보 수

국가 코드와 종속 영토 코드를 그대로 사용한다. 후보가 0인 코드도 대조 원본에 있으면 표시한다.

| countryCode | 최종 후보 |
| --- | --- |
|  | 0 |
| AD | 7 |
| AE | 20 |
| AF | 287 |
| AG | 7 |
| AI | 14 |
| AL | 35 |
| AM | 52 |
| AN | 0 |
| AO | 274 |
| AQ | 0 |
| AR | 513 |
| AS | 4 |
| AT | 30 |
| AU | 59 |
| AW | 1 |
| AX | 16 |
| AZ | 75 |
| BA | 65 |
| BB | 10 |
| BD | 83 |
| BE | 27 |
| BF | 46 |
| BG | 100 |
| BH | 7 |
| BI | 20 |
| BJ | 23 |
| BL | 1 |
| BM | 1 |
| BN | 4 |
| BO | 23 |
| BQ | 3 |
| BR | 1123 |
| BS | 21 |
| BT | 21 |
| BV | 0 |
| BW | 16 |
| BY | 117 |
| BZ | 6 |
| CA | 112 |
| CC | 1 |
| CD | 81 |
| CF | 21 |
| CG | 15 |
| CH | 106 |
| CI | 38 |
| CK | 1 |
| CL | 73 |
| CM | 34 |
| CN | 670 |
| CO | 1052 |
| CR | 15 |
| CS | 0 |
| CU | 137 |
| CV | 21 |
| CW | 1 |
| CX | 1 |
| CY | 12 |
| CZ | 23 |
| DE | 55 |
| DJ | 7 |
| DK | 101 |
| DM | 10 |
| DO | 40 |
| DZ | 111 |
| EC | 159 |
| EE | 74 |
| EG | 153 |
| EH | 3 |
| ER | 7 |
| ES | 87 |
| ET | 71 |
| FI | 20 |
| FJ | 8 |
| FK | 1 |
| FM | 51 |
| FO | 18 |
| FR | 149 |
| GA | 12 |
| GB | 298 |
| GD | 7 |
| GE | 73 |
| GF | 2 |
| GG | 10 |
| GH | 57 |
| GI | 1 |
| GL | 5 |
| GM | 8 |
| GN | 40 |
| GP | 2 |
| GQ | 8 |
| GR | 54 |
| GS | 1 |
| GT | 320 |
| GU | 19 |
| GW | 12 |
| GY | 10 |
| HK | 34 |
| HM | 0 |
| HN | 31 |
| HR | 578 |
| HT | 22 |
| HU | 156 |
| ID | 554 |
| IE | 30 |
| IL | 36 |
| IM | 21 |
| IN | 1167 |
| IO | 0 |
| IQ | 118 |
| IR | 455 |
| IS | 9 |
| IT | 117 |
| JE | 2 |
| JM | 17 |
| JO | 53 |
| JP | 865 |
| KE | 81 |
| KG | 48 |
| KH | 130 |
| KI | 1 |
| KM | 3 |
| KN | 14 |
| KP | 52 |
| KR | 113 |
| KW | 9 |
| KY | 6 |
| KZ | 191 |
| LA | 48 |
| LB | 29 |
| LC | 10 |
| LI | 11 |
| LK | 29 |
| LR | 18 |
| LS | 11 |
| LT | 40 |
| LU | 12 |
| LV | 85 |
| LY | 35 |
| MA | 51 |
| MC | 1 |
| MD | 38 |
| ME | 25 |
| MF | 1 |
| MG | 39 |
| MH | 24 |
| MK | 75 |
| ML | 53 |
| MM | 78 |
| MN | 321 |
| MO | 4 |
| MP | 2 |
| MQ | 1 |
| MR | 19 |
| MS | 3 |
| MT | 63 |
| MU | 15 |
| MV | 20 |
| MW | 29 |
| MX | 1888 |
| MY | 147 |
| MZ | 27 |
| NA | 16 |
| NC | 7 |
| NE | 41 |
| NF | 1 |
| NG | 771 |
| NI | 153 |
| NL | 71 |
| NO | 382 |
| NP | 28 |
| NR | 7 |
| NU | 1 |
| NZ | 26 |
| OM | 20 |
| PA | 69 |
| PE | 49 |
| PF | 4 |
| PG | 26 |
| PH | 144 |
| PK | 259 |
| PL | 223 |
| PM | 2 |
| PN | 1 |
| PR | 78 |
| PS | 12 |
| PT | 258 |
| PW | 17 |
| PY | 37 |
| QA | 9 |
| RE | 6 |
| RO | 3029 |
| RS | 26 |
| RU | 1956 |
| RW | 11 |
| SA | 51 |
| SB | 9 |
| SC | 9 |
| SD | 38 |
| SE | 291 |
| SG | 19 |
| SH | 3 |
| SI | 212 |
| SJ | 2 |
| SK | 63 |
| SL | 7 |
| SM | 9 |
| SN | 28 |
| SO | 35 |
| SR | 10 |
| SS | 12 |
| ST | 5 |
| SV | 19 |
| SX | 1 |
| SY | 62 |
| SZ | 7 |
| TC | 1 |
| TD | 25 |
| TF | 1 |
| TG | 8 |
| TH | 945 |
| TJ | 60 |
| TK | 3 |
| TL | 12 |
| TM | 12 |
| TN | 56 |
| TO | 6 |
| TR | 942 |
| TT | 16 |
| TV | 6 |
| TW | 46 |
| TZ | 60 |
| UA | 252 |
| UG | 131 |
| UM | 0 |
| US | 3600 |
| UY | 20 |
| UZ | 149 |
| VA | 1 |
| VC | 6 |
| VE | 347 |
| VG | 1 |
| VI | 3 |
| VN | 665 |
| VU | 6 |
| WF | 3 |
| WS | 11 |
| XK | 37 |
| YE | 292 |
| YT | 17 |
| YU | 0 |
| ZA | 101 |
| ZM | 32 |
| ZW | 18 |

### 6개 국가 상세

| country | totalKept | 50k+ | 100k+ | under50kAdmin | PPLC | PPLG | PPLA | PPLA2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| KR | 113 | 96 | 56 | 17 | 1 | 0 | 16 | 32 |
| JP | 865 | 553 | 276 | 312 | 1 | 0 | 46 | 758 |
| CN | 670 | 660 | 440 | 10 | 1 | 0 | 30 | 253 |
| IN | 1167 | 1096 | 514 | 71 | 1 | 0 | 35 | 148 |
| US | 3600 | 879 | 327 | 2721 | 1 | 0 | 50 | 2988 |
| BR | 1123 | 677 | 345 | 446 | 1 | 0 | 26 | 528 |

#### KR: 인구 상위 30

| ID | 이름 | 코드 | 인구 | admin1 / admin2 |
| --- | --- | --- | --- | --- |
| 1835848 | Seoul | PPLC | 10349312 | 11 /  |
| 1838524 | Busan | PPLA | 3285147 | 10 /  |
| 1843564 | Incheon | PPLA | 3015482 | 12 /  |
| 1835329 | Daegu | PPLA | 2365523 | 15 /  |
| 1835235 | Daejeon | PPLA | 1441203 | 19 /  |
| 1841811 | Gwangju | PPLA | 1401235 | 18 /  |
| 1835553 | Suwon | PPLA | 1234582 | 13 / 31010 |
| 1833747 | Ulsan | PPLA | 1098421 | 21 /  |
| 1842485 | Goyang-si | PPLA2 | 1061752 | 13 / 31100 |
| 1846326 | Changwon | PPLA | 1025702 | 20 / 38110 |
| 1897000 | Seongnam-si | PPL | 914832 | 13 / 31020 |
| 1845604 | Cheongju-si | PPLA | 852147 | 05 / 33010 |
| 1838716 | Bucheon-si | PPL | 850731 | 13 / 31050 |
| 1845759 | Cheonan | PPL | 658831 | 17 / 34010 |
| 1843847 | Hwaseong-si | PPL | 640890 | 13 / 31240 |
| 1845457 | Jeonju | PPLA | 638421 | 03 / 35010 |
| 1846918 | Ansan-si | PPL | 623256 | 13 / 31090 |
| 1846898 | Anyang-si | PPL | 595644 | 13 / 31040 |
| 1842943 | Kimhae | PPL | 531966 | 20 / 38070 |
| 1839071 | Pohang | PPLA2 | 492041 | 14 / 37010 |
| 1846266 | Jeju City | PPLA | 488844 | 01 / 39010 |
| 1833788 | Uijeongbu-si | PPL | 479141 | 13 / 31030 |
| 1841246 | Masan | PPL | 434371 | 18 / 24020 |
| 1842225 | Gumi | PPLA2 | 404691 | 14 / 37050 |
| 11523293 | Sejong | PPLA | 394630 | 22 / 29010 |
| 1838343 | Pyeongtaek | PPL | 364694 | 13 / 31070 |
| 1832828 | Yangsan | PPLA2 | 358074 | 20 / 38100 |
| 1948005 | Gwangmyeong | PPL | 357545 | 13 / 31060 |
| 1833105 | Wŏnju | PPL | 332849 | 06 / 32020 |
| 1846052 | Chinju | PPL | 307242 | 20 / 38030 |

#### KR: 저인구 행정중심 표본

가장 작은 6개 + 5만에 가장 가까운 6개(중복 ID 제외). 전수 판정이 아닌 검토 표본이다.

| ID | 이름 | 코드 | 인구 |
| --- | --- | --- | --- |
| 1832034 | Yuseong | PPLA2 | 0 |
| 1832578 | Yeongdeok | PPLA2 | 0 |
| 1832699 | Yeoncheon | PPLA2 | 0 |
| 1834203 | Dongnae | PPLA2 | 0 |
| 1839110 | Beobwon | PPLA2 | 0 |
| 1845492 | Cheongyang | PPLA2 | 0 |
| 11674727 | Boseong | PPLA2 | 37164 |
| 11863735 | Hadong | PPLA2 | 40909 |
| 1846371 | Jangseong | PPLA2 | 42129 |
| 1840536 | Naju | PPLA2 | 42459 |
| 1832566 | Yeongdong | PPLA2 | 43680 |
| 1834946 | Damyang | PPLA2 | 44800 |

인구 1천 미만 행정중심 9개 (인구 0/미상 포함).

#### KR: 전체 후보 sanity check

| ID | 이름 | 코드 | 인구 |
| --- | --- | --- | --- |
| 1832034 | Yuseong | PPLA2 | 0 |
| 1832384 | Yeongju | PPL | 84625 |
| 1832566 | Yeongdong | PPLA2 | 43680 |
| 1832578 | Yeongdeok | PPLA2 | 0 |
| 1832617 | Eisen | PPL | 56006 |
| 1832699 | Yeoncheon | PPLA2 | 0 |
| 1832743 | Yeoju | PPL | 111897 |
| 1832798 | Yecheon | PPLA2 | 54873 |
| 1832828 | Yangsan | PPLA2 | 358074 |
| 1832830 | Yangp'yŏng | PPL | 83367 |
| 1832847 | Yangju | PPL | 179923 |
| 1833105 | Wŏnju | PPL | 332849 |
| 1833332 | Tallang-dong | PPL | 54954 |
| 1833466 | Wanju | PPL | 84009 |
| 1833747 | Ulsan | PPLA | 1098421 |
| 1833788 | Uijeongbu-si | PPL | 479141 |
| 1834203 | Dongnae | PPLA2 | 0 |
| 1834946 | Damyang | PPLA2 | 44800 |
| 1835235 | Daejeon | PPLA | 1441203 |
| 1835329 | Daegu | PPLA | 2365523 |
| 1835447 | Boryeong | PPLA2 | 94191 |
| 1835553 | Suwon | PPLA | 1234582 |
| 1835648 | Suncheon | PPLA2 | 276375 |
| 1835848 | Seoul | PPLC | 10349312 |
| 1835895 | Seosan | PPL | 74208 |
| 1836553 | Sokcho | PPLA2 | 81164 |
| 1837706 | Sangju | PPL | 101267 |
| 1838343 | Pyeongtaek | PPL | 364694 |
| 1838508 | Buyeo | PPLA2 | 59823 |
| 1838524 | Busan | PPLA | 3285147 |
| 1838716 | Bucheon-si | PPL | 850731 |
| 1839071 | Pohang | PPLA2 | 492041 |
| 1839110 | Beobwon | PPLA2 | 0 |
| 1839652 | Osan | PPL | 238788 |
| 1839726 | Asan | PPL | 97749 |
| 1839873 | Okcheon | PPL | 56634 |
| 1840179 | Kosong | PPL | 62446 |
| 1840379 | Nangen | PPL | 81257 |
| 1840536 | Naju | PPLA2 | 42459 |
| 1840886 | Mungyeong | PPL | 77304 |
| 1840982 | Muan | PPLA | 92009 |
| 1841066 | Mokpo | PPLA2 | 268402 |
| 1841149 | Miryang | PPL | 53103 |
| 1841246 | Masan | PPL | 434371 |
| 1841598 | Gyeongsan-si | PPLA2 | 266951 |
| 1841603 | Gyeongju | PPL | 245365 |
| 1841775 | Kwangyang | PPL | 89281 |
| 1841810 | Gwangju | PPL | 81780 |
| 1841811 | Gwangju | PPLA | 1401235 |
| 1841988 | Guri-si | PPL | 195236 |
| 1842025 | Gunsan | PPL | 264656 |
| 1842030 | Gunpo | PPL | 286485 |
| 1842225 | Gumi | PPLA2 | 404691 |
| 1842485 | Goyang-si | PPLA2 | 1061752 |
| 1842616 | Gongju | PPL | 72435 |
| 1842754 | Kyosai | PPL | 72124 |
| 1842859 | Koch'ang | PPL | 72996 |
| 1842936 | Gimpo-si | PPL | 203391 |
| 1842943 | Kimhae | PPL | 531966 |
| 1842944 | Gimcheon | PPL | 150000 |
| 1843082 | Gapyeong | PPL | 55415 |
| 1843491 | Iksan | PPL | 307000 |
| 1843564 | Incheon | PPLA | 3015482 |
| 1843702 | Icheon-si | PPL | 196230 |
| 1843841 | Hwasun | PPLA2 | 59914 |
| 1843847 | Hwaseong-si | PPL | 640890 |
| 1844045 | Hwacheon | PPLA2 | 22965 |
| 1844174 | Hongseong | PPLA | 89174 |
| 1844191 | Hongch’ŏn | PPL | 75251 |
| 1845020 | Tongyeong | PPL | 70641 |
| 1845033 | Chungju | PPL | 209483 |
| 1845136 | Chuncheon | PPLA | 284855 |
| 1845457 | Jeonju | PPLA | 638421 |
| 1845492 | Cheongyang | PPLA2 | 0 |
| 1845604 | Cheongju-si | PPLA | 852147 |
| 1845759 | Cheonan | PPL | 658831 |
| 1846052 | Chinju | PPL | 307242 |
| 1846095 | Chinch'ŏn | PPL | 60964 |
| 1846266 | Jeju City | PPLA | 488844 |
| 1846326 | Changwon | PPLA | 1025702 |
| 1846371 | Jangseong | PPLA2 | 42129 |
| 1846544 | Jangheung | PPLA2 | 34544 |
| 1846898 | Anyang-si | PPL | 595644 |
| 1846912 | Anseong | PPL | 69255 |
| 1846918 | Ansan-si | PPL | 623256 |
| 1846986 | Andong | PPLA | 153348 |
| 1882056 | Sinhyeon | PPL | 82560 |
| 1884138 | Yeosu | PPLA2 | 268823 |
| 1884178 | Gwangyang | PPLA2 | 154266 |
| 1892823 | Donghae City | PPL | 101128 |
| 1896953 | Pubal | PPL | 63026 |
| 1897000 | Seongnam-si | PPL | 914832 |
| 1897007 | Hanam | PPL | 254415 |
| 1897118 | Hwado | PPL | 106358 |
| 1897122 | Namyangju | PPL | 90798 |
| 1912205 | Ungsang | PPL | 83360 |
| 1912209 | Wabu | PPL | 96775 |
| 1925936 | Naesŏ | PPL | 80987 |
| 1925943 | Hwawŏn | PPL | 64718 |
| 1948005 | Gwangmyeong | PPL | 357545 |
| 6395804 | Sinan | PPL | 53150 |
| 6573901 | Uiwang | PPL | 63040 |
| 6621166 | Seogwipo | PPL | 178552 |
| 6903078 | Changnyeong | PPL | 74668 |
| 11101805 | Geoje | PPL | 232921 |
| 11523293 | Sejong | PPLA | 394630 |
| 11549691 | Bupyeong | PPLA2 | 0 |
| 11674727 | Boseong | PPLA2 | 37164 |
| 11695689 | Jeongeup | PPL | 139876 |
| 11725780 | Sinan | PPLA2 | 0 |
| 11762608 | Yeongam | PPLA2 | 51573 |
| 11863735 | Hadong | PPLA2 | 40909 |
| 13439582 | Yeosu | PPLA2 | 0 |

#### JP: 인구 상위 30

| ID | 이름 | 코드 | 인구 | admin1 / admin2 |
| --- | --- | --- | --- | --- |
| 1850147 | Tokyo | PPLC | 9733276 | 40 /  |
| 1848354 | Yokohama | PPLA | 3777491 | 19 / 1848350 |
| 1853909 | Osaka | PPLA | 2753862 | 32 / 1853897 |
| 1856057 | Nagoya | PPLA | 2332176 | 01 / 1856053 |
| 2128295 | Sapporo | PPLA | 1973832 | 12 / 2128291 |
| 1863967 | Fukuoka | PPLA | 1612392 | 07 / 1863955 |
| 1859642 | Kawasaki | PPLA2 | 1538262 | 19 / 1859635 |
| 1859171 | Kobe | PPLA | 1525152 | 13 / 1859161 |
| 1857910 | Kyoto | PPLA | 1463723 | 22 / 1857906 |
| 6940394 | Saitama | PPLA | 1324854 | 34 / 1849187 |
| 1862415 | Hiroshima | PPLA | 1200754 | 11 / 1862412 |
| 2111149 | Sendai | PPLA | 1096704 | 24 / 2111147 |
| 2113015 | Chiba | PPLA | 979768 | 04 / 2113012 |
| 1859307 | Kitakyushu | PPLA2 | 940978 | 07 / 1859306 |
| 1853195 | Sakai | PPLA2 | 826161 | 32 / 1853167 |
| 1855431 | Niigata | PPLA | 797591 | 29 / 1855427 |
| 1863289 | Hamamatsu | PPLA2 | 791707 | 37 / 1863288 |
| 8469289 | Ōta | PPLA2 | 748081 | 40 / 1853655 |
| 1858421 | Kumamoto | PPLA | 738907 | 21 / 1858418 |
| 1865689 | Aihara | PPL | 725493 | 19 / 1853293 |
| 1854383 | Okayama | PPLA | 724691 | 31 / 1854380 |
| 11611609 | Sagamihara | PPLA2 | 720780 | 19 / 1853293 |
| 1851717 | Shizuoka | PPLA | 693389 | 37 / 1851714 |
| 1859730 | Kawaguchi | PPLA2 | 607373 | 34 / 1859726 |
| 1860827 | Kagoshima | PPLA | 595049 | 18 / 1860823 |
| 1863440 | Hachiōji | PPLA2 | 579355 | 40 / 8304375 |
| 11209896 | Kotō | PPL | 543730 | 21 / 1858418 |
| 1862627 | Himeji | PPLA2 | 530495 | 13 / 1862625 |
| 1849053 | Utsunomiya | PPLA | 518757 | 38 / 1849052 |
| 1926099 | Matsuyama | PPLA | 511192 | 05 / 1857456 |

#### JP: 저인구 행정중심 표본

가장 작은 6개 + 5만에 가장 가까운 6개(중복 ID 제외). 전수 판정이 아닌 검토 표본이다.

| ID | 이름 | 코드 | 인구 |
| --- | --- | --- | --- |
| 1853545 | Ōuda | PPLA2 | 0 |
| 1857737 | Makinohara | PPLA2 | 0 |
| 1862569 | Hioki | PPLA2 | 0 |
| 2129052 | Mobetsu | PPLA2 | 0 |
| 6822183 | Tomisato | PPLA2 | 0 |
| 6825488 | Agano | PPLA2 | 0 |
| 6822101 | Omitama | PPLA2 | 48870 |
| 1851368 | Suwa | PPLA2 | 48972 |
| 1848705 | Yamaga | PPLA2 | 49082 |
| 1859492 | Kikuchi | PPLA2 | 49455 |
| 1860626 | Kameyama | PPLA2 | 49835 |
| 6822100 | Tsukubamirai | PPLA2 | 49872 |

인구 1천 미만 행정중심 57개 (인구 0/미상 포함).

#### CN: 인구 상위 30

| ID | 이름 | 코드 | 인구 | admin1 / admin2 |
| --- | --- | --- | --- | --- |
| 1796236 | Shanghai | PPLA | 24874500 | 23 / 12324204 |
| 1814906 | Chongqing | PPLA | 22000000 | 33 / 8739734 |
| 1815286 | Chengdu | PPLA | 20937757 | 32 / 5101 |
| 1816670 | Beijing | PPLC | 18960744 | 22 / 11876380 |
| 1809858 | Guangzhou | PPLA | 18676605 | 30 / 4401 |
| 1795565 | Shenzhen | PPLA2 | 17494398 | 30 / 4403 |
| 1792947 | Tianjin | PPLA | 13866009 | 28 / 12324202 |
| 1791247 | Wuhan | PPLA | 13739000 | 12 / 4201 |
| 1790630 | Xi’an | PPLA | 12952907 | 26 / 6101 |
| 1808926 | Hangzhou | PPLA | 11936010 | 02 / 3301 |
| 2037013 | Harbin | PPLA | 10009854 | 08 / 2301 |
| 1812545 | Dongguan | PPLA2 | 9644871 | 30 / 4419 |
| 1808722 | Hefei | PPLA | 9465881 | 01 / 3401 |
| 1791681 | Weifang | PPL | 9386705 | 25 / 3707 |
| 1799962 | Nanjing | PPLA | 9314685 | 04 / 3201 |
| 2034937 | Shenyang | PPLA | 9070093 | 19 / 2101 |
| 1811103 | Foshan | PPLA2 | 9042509 | 30 / 4406 |
| 1805753 | Jinan | PPLA | 8352574 | 25 / 3701 |
| 1814087 | Dalian | PPL | 7450785 | 19 / 2102 |
| 1790842 | Wuzhong | PPLA2 | 7202654 | 21 / 6403 |
| 1797929 | Qingdao | PPLA2 | 7172451 | 25 / 3702 |
| 1787093 | Yantai | PPL | 7102100 | 25 / 3706 |
| 1886760 | Suzhou | PPLA2 | 6715559 | 04 / 3205 |
| 1784658 | Zhengzhou | PPLA | 6650532 | 09 / 4101 |
| 1799869 | Nanning | PPLA | 5977185 | 16 / 4501 |
| 1804651 | Kunming | PPLA | 5950578 | 29 / 5301 |
| 1795270 | Shijiazhuang | PPLA | 5758403 | 10 / 1301 |
| 2038180 | Changchun | PPLA | 5691024 | 05 / 2201 |
| 1793511 | Taiyuan | PPLA | 5305061 | 24 / 1401 |
| 1785286 | Zibo | PPL | 4704138 | 25 / 3703 |

#### CN: 저인구 행정중심 표본

가장 작은 6개 + 5만에 가장 가까운 6개(중복 ID 제외). 전수 판정이 아닌 검토 표본이다.

| ID | 이름 | 코드 | 인구 |
| --- | --- | --- | --- |
| 8309983 | Fuzhou | PPLA2 | 0 |
| 12256566 | Yulin | PPLA2 | 0 |
| 13457912 | Yueyang | PPLA2 | 0 |
| 12382279 | Sansha | PPLA2 | 1443 |
| 13512504 | Xihai Town | PPLA2 | 7100 |
| 1280003 | Gar | PPLA2 | 24910 |
| 1280517 | Nagqu | PPLA2 | 30000 |
| 13527316 | São Lázaro | PPLA2 | 33100 |
| 1279681 | Quxu | PPLA2 | 41851 |
| 1798403 | Qabqa | PPLA2 | 46907 |

인구 1천 미만 행정중심 3개 (인구 0/미상 포함).

#### IN: 인구 상위 30

| ID | 이름 | 코드 | 인구 | admin1 / admin2 |
| --- | --- | --- | --- | --- |
| 1275339 | Mumbai | PPLA | 12691836 | 16 /  |
| 1273294 | Delhi | PPLA | 11034555 | 07 /  |
| 1277333 | Bengaluru | PPLA | 8495492 | 19 / 572 |
| 1269843 | Hyderabad | PPLA | 6993262 | 40 / 536 |
| 1279233 | Ahmedabad | PPL | 6357693 | 09 / 474 |
| 1264527 | Chennai | PPLA | 4681087 | 25 / 603 |
| 1275004 | Kolkata | PPLA | 4631392 | 28 / 342 |
| 1255364 | Surat | PPLA2 | 4591246 | 09 / 492 |
| 1259229 | Pune | PPL | 3124458 | 16 / 521 |
| 1269515 | Jaipur | PPLA | 3046163 | 24 / 110 |
| 1267995 | Kanpur | PPL | 2823249 | 36 / 164 |
| 1264733 | Lucknow | PPLA | 2472011 | 36 / 157 |
| 1262180 | Nagpur | PPLA2 | 2405665 | 16 / 505 |
| 1273865 | Coimbatore | PPL | 2136916 | 25 / 632 |
| 1269743 | Indore | PPL | 1994397 | 35 / 439 |
| 1254661 | Thāne | PPL | 1841488 | 16 / 517 |
| 1253573 | Vadodara | PPL | 1822221 | 09 / 486 |
| 1275841 | Bhopal | PPLA | 1798218 | 35 / 444 |
| 1258393 | Rasapūdipalem | PPL | 1728128 | 02 / 544 |
| 7626690 | Pimpri-Chinchwad | PPL | 1727692 | 16 / 521 |
| 1260086 | Patna | PPLA | 1684297 | 34 / 230 |
| 12165956 | Kallakurichi | PPLA2 | 1682687 | 25 / 729 |
| 1264728 | Ludhiana | PPL | 1618879 | 23 / 041 |
| 1261731 | Nashik | PPLA2 | 1486053 | 16 / 516 |
| 1264521 | Madurai | PPLA2 | 1465625 | 25 / 623 |
| 1254361 | Tirunelveli | PPLA2 | 1435844 | 25 / 628 |
| 1279259 | Agra | PPLA2 | 1430055 | 36 / 146 |
| 1271951 | Faridabad | PPLA2 | 1414050 | 10 / 088 |
| 1258847 | Rājkot | PPL | 1390640 | 09 / 476 |
| 1262111 | Najafgarh | PPL | 1365000 | 07 / 097 |

#### IN: 저인구 행정중심 표본

가장 작은 6개 + 5만에 가장 가까운 6개(중복 ID 제외). 전수 판정이 아닌 검토 표본이다.

| ID | 이름 | 코드 | 인구 |
| --- | --- | --- | --- |
| 1255531 | Sukma | PPLA2 | 0 |
| 1445978 | Shahmīrpet | PPLA2 | 0 |
| 8690167 | Kalimpong, Крукети | PPLA2 | 0 |
| 8993350 | Neemuch | PPLA2 | 0 |
| 9782274 | Mushalpur | PPLA2 | 0 |
| 10263259 | Defence Colony | PPLA2 | 0 |
| 1259961 | Peddapalli | PPLA2 | 41171 |
| 1267091 | Khambhāliya | PPLA2 | 41734 |
| 1261823 | Nārāyanpet | PPLA2 | 41752 |
| 1264409 | Mahbūbābād | PPLA2 | 42851 |
| 1273618 | Daman | PPLA | 44282 |
| 1267369 | Kawardha | PPLA2 | 46657 |

인구 1천 미만 행정중심 25개 (인구 0/미상 포함).

#### US: 인구 상위 30

| ID | 이름 | 코드 | 인구 | admin1 / admin2 |
| --- | --- | --- | --- | --- |
| 5128581 | New York City | PPL | 8804190 | NY /  |
| 5368361 | Los Angeles | PPLA2 | 3820914 | CA / 037 |
| 5110302 | Brooklyn | PPLA2 | 2736074 | NY / 047 |
| 4887398 | Chicago | PPLA2 | 2664452 | IL / 031 |
| 5133273 | Queens | PPLA2 | 2316841 | NY / 081 |
| 4699066 | Houston | PPLA2 | 2314157 | TX / 201 |
| 5308655 | Phoenix | PPLA | 1650070 | AZ / 013 |
| 4560349 | Philadelphia | PPLA2 | 1573916 | PA / 101 |
| 4726206 | San Antonio | PPLA2 | 1526656 | TX / 029 |
| 5125771 | Manhattan | PPLA2 | 1487536 | NY / 061 |
| 5391811 | San Diego | PPLA2 | 1404452 | CA / 073 |
| 5110266 | The Bronx | PPLA2 | 1385108 | NY / 005 |
| 4684888 | Dallas | PPLA2 | 1326087 | TX / 113 |
| 4160021 | Jacksonville | PPLA2 | 1009833 | FL / 031 |
| 4691930 | Fort Worth | PPLA2 | 1008106 | TX / 439 |
| 5392171 | San Jose | PPLA2 | 997368 | CA / 085 |
| 4671654 | Austin | PPLA | 974447 | TX / 453 |
| 4509177 | Columbus | PPLA | 913175 | OH / 049 |
| 4460243 | Charlotte | PPLA2 | 911311 | NC / 119 |
| 4259418 | Indianapolis | PPLA | 887642 | IN / 097 |
| 5391959 | San Francisco | PPLA2 | 827526 | CA / 075 |
| 5809844 | Seattle | PPLA2 | 780995 | WA / 033 |
| 5419384 | Denver | PPLA | 729019 | CO / 031 |
| 4140963 | Washington | PPLC | 689545 | DC / 001 |
| 4644585 | Nashville | PPLA | 689447 | TN / 037 |
| 4544349 | Oklahoma City | PPLA | 681054 | OK / 109 |
| 5520993 | El Paso | PPLA2 | 678815 | TX / 141 |
| 4930956 | Boston | PPLA | 653833 | MA / 025 |
| 5746545 | Portland | PPLA2 | 652503 | OR / 051 |
| 4990729 | Detroit | PPLA2 | 645705 | MI / 163 |

#### US: 저인구 행정중심 표본

가장 작은 6개 + 5만에 가장 가까운 6개(중복 ID 제외). 전수 판정이 아닌 검토 표본이다.

| ID | 이름 | 코드 | 인구 |
| --- | --- | --- | --- |
| 4180085 | Appling | PPLA2 | 0 |
| 4462759 | Currituck | PPLA2 | 0 |
| 4749652 | Buckingham | PPLA2 | 0 |
| 4752250 | Chesterfield | PPLA2 | 0 |
| 4755972 | Dinwiddie | PPLA2 | 0 |
| 4766204 | Isle of Wight | PPLA2 | 0 |
| 4552215 | Stillwater | PPLA2 | 48967 |
| 5007989 | Saginaw | PPLA2 | 49347 |
| 5690532 | Minot | PPLA2 | 49450 |
| 4333669 | Monroe | PPLA2 | 49598 |
| 4499389 | Wilson | PPLA2 | 49643 |
| 5141502 | Troy | PPLA2 | 49906 |

인구 1천 미만 행정중심 393개 (인구 0/미상 포함).

#### BR: 인구 상위 30

| ID | 이름 | 코드 | 인구 | admin1 / admin2 |
| --- | --- | --- | --- | --- |
| 3448439 | São Paulo | PPLA | 12400232 | 27 /  |
| 3451190 | Rio de Janeiro | PPLA | 6747815 | 21 / 3304557 |
| 3470127 | Belo Horizonte | PPLA | 2721564 | 15 / 3106200 |
| 3450554 | Salvador | PPLA | 2711840 | 05 / 2927408 |
| 3399415 | Fortaleza | PPLA | 2400000 | 06 / 2304400 |
| 3663517 | Manaus | PPLA | 2219580 | 04 / 1302603 |
| 3469058 | Brasília | PPLC | 2207718 | 07 / 5300108 |
| 3464975 | Curitiba | PPLA | 1948626 | 18 / 4106902 |
| 3390760 | Recife | PPLA | 1653461 | 30 / 2611606 |
| 3462377 | Goiânia | PPLA | 1536097 | 29 / 5208707 |
| 3405870 | Belém | PPLA | 1499641 | 16 / 1501402 |
| 3452925 | Porto Alegre | PPLA | 1488252 | 23 / 4314902 |
| 3461786 | Guarulhos | PPL | 1345364 | 27 / 3518800 |
| 3395981 | Maceió | PPLA | 1031597 | 02 / 2704302 |
| 3467865 | Campinas | PPL | 1031554 | 27 / 3509502 |
| 3388368 | São Luís | PPLA | 917237 | 13 / 2111300 |
| 3467747 | Campo Grande | PPLA | 906092 | 11 / 5002704 |
| 3394023 | Natal | PPLA | 896708 | 22 / 2408102 |
| 3386496 | Teresina | PPLA | 871126 | 20 / 2211001 |
| 3464374 | Duque de Caxias | PPL | 866347 | 21 / 3301702 |
| 3456160 | Nova Iguaçu | PPLA2 | 843046 | 21 / 3303500 |
| 3449344 | São Bernardo do Campo | PPL | 840499 | 27 / 3548708 |
| 3397277 | João Pessoa | PPLA | 817511 | 17 / 2507507 |
| 3447399 | Sorocaba | PPLA2 | 762172 | 27 / 3552205 |
| 3445831 | Uberlândia | PPL | 754954 | 15 / 3170206 |
| 3455775 | Osasco | PPL | 728615 | 27 / 3534401 |
| 3448636 | São José dos Campos | PPLA2 | 727078 | 27 / 3549904 |
| 3451328 | Ribeirão Preto | PPLA2 | 698642 | 27 / 3543402 |
| 3471872 | Aracaju | PPLA | 664908 | 28 / 2800308 |
| 3459712 | Joinville | PPL | 664500 | 26 / 4209102 |

#### BR: 저인구 행정중심 표본

가장 작은 6개 + 5만에 가장 가까운 6개(중복 ID 제외). 전수 판정이 아닌 검토 표본이다.

| ID | 이름 | 코드 | 인구 |
| --- | --- | --- | --- |
| 3388351 | São Luis do Piauí | PPLA2 | 0 |
| 3388542 | São José do Divino | PPLA2 | 0 |
| 3389186 | Santo Amaro do Maranhão | PPLA2 | 0 |
| 3389226 | Santa Terezinha do Tocantins | PPLA2 | 0 |
| 3390364 | Senador Rui Palmeira | PPLA2 | 0 |
| 3392369 | Penaforte | PPLA2 | 0 |
| 3461511 | Pilão Arcado | PPLA2 | 35357 |
| 3461425 | Ilhabela | PPLA2 | 35591 |
| 3387604 | Sirinhaém | PPLA2 | 40852 |
| 3447437 | Socorro | PPLA2 | 41352 |
| 3407378 | Aracati | PPLA2 | 44293 |
| 3464728 | Diamantina | PPLA2 | 47702 |

인구 1천 미만 행정중심 136개 (인구 0/미상 포함).

### 자동 과다수록 신호

| 신호 | 건수 |
| --- | --- |
| 이름에 구역/시설 키워드 | 5 |
| 한국 미세 지명 접미사 | 1 |
| 정확히 같은 좌표의 복수 후보 그룹 | 7 |
| 해당 그룹 내 후보 | 14 |
| 최대 그룹 크기 | 2 |
| 같은 국가·정규화 이름, 1km 내 ID 쌍 | 2 |
| countryCode 없음 | 0 |
| 유지한 인구 0 후보 | 4480 |

이름 신호는 오탐을 포함하며 POI/구역 확정 판정이 아니다. 모든 다른 ID는 그대로 남겼다.

| ID | 국가 | 이름 | 코드 | 인구 |
| --- | --- | --- | --- | --- |
| 4682464 | US | College Station | PPL | 107889 |
| 12326384 | DZ | District of Taher | PPLA2 | 60426 |
| 2737038 | PT | Oliveira do Hospital | PPLA2 | 4704 |
| 1283268 | NP | Kalikot District | PPLA2 | 0 |
| 3573375 | AI | The Quarter | PPLA | 0 |

#### 한국 미세 지명 이름 신호 전체

| ID | 이름 | 코드 | 인구 |
| --- | --- | --- | --- |
| 1833332 | Tallang-dong | PPL | 54954 |

#### 한국 alternateNames 미세 지명 접미사 신호

원본 별칭만 감사에 사용한다. 후보에는 alternateNames를 복제하지 않으며, 이 신호도 자동 제외에 사용하지 않는다.
대구·영동·구리·안동·하동처럼 정상 도시 이름의 끝 글자나 오래된 별칭도 걸리므로 미세 지명 확정 건수가 아니다.

| ID | 이름 | 코드 | 인구 | 별칭 신호 |
| --- | --- | --- | --- | --- |
| 1832566 | Yeongdong | PPLA2 | 43680 | Yong-dong, Yŏng-dong, 영동 |
| 1833332 | Tallang-dong | PPL | 54954 | Nohyeong-dong, Tallang-dong, Wollang-dong, Wŏllang-dong |
| 1835329 | Daegu | PPLA | 2365523 | 대구 |
| 1835447 | Boryeong | PPLA2 | 94191 | Hannae-ri, Taisen-ri |
| 1836553 | Sokcho | PPLA2 | 81164 | Sokch'o-ri, Sokch’o-ri |
| 1838343 | Pyeongtaek | PPL | 364694 | Heitaku-ri |
| 1839071 | Pohang | PPLA2 | 492041 | P'ohang-dong, P’ohang-dong |
| 1839110 | Beobwon | PPLA2 | 0 | Pobwon-dong, Pŏbwŏn-dong |
| 1839652 | Osan | PPL | 238788 | Usan-ri |
| 1839873 | Okcheon | PPL | 56634 | Kumgu-ri |
| 1841988 | Guri-si | PPL | 195236 | 구리 |
| 1846986 | Andong | PPLA | 153348 | 안동 |
| 6903078 | Changnyeong | PPL | 74668 | 창녕읍 |
| 11863735 | Hadong | PPLA2 | 40909 | 하동 |

#### 근접 동명 ID 쌍 (최대 30)

| 국가 | 이름 | IDs | 거리 m |
| --- | --- | --- | --- |
| PH | Bañga | [1727400, 1727401] | 254.3 |
| RU | Ozërsk | [1489837, 1538634] | 876.67 |

### allCountries 전체 원본 대조 (필터 변경 없음)

전체 13,472,217행, P 5,231,940행, 같은 정책의 유효 후보 32,277개.

cities500에 없는 유효 후보 0개; 대조 원본에 없는 주 후보 0개; 같은 ID의 내용 차이 0개.

| 제외 코드 | 전체 제외 | 그중 인구 0 |
| --- | --- | --- |
|  | 1 | 1 |
| PPL | 4710540 | 4304628 |
| PPLA3 | 30530 | 7382 |
| PPLA4 | 27355 | 18747 |
| PPLA5 | 40 | 10 |
| PPLCH | 261 | 260 |
| PPLF | 20505 | 20224 |
| PPLH | 1663 | 1626 |
| PPLL | 177498 | 170737 |
| PPLQ | 56636 | 56409 |
| PPLR | 163 | 97 |
| PPLS | 354 | 296 |
| PPLW | 3119 | 3089 |
| PPLX | 170773 | 157144 |
| STLMT | 225 | 175 |

빈 인구 필드(P): 0행. 인구 0 전체와 구분한다.

#### 전 국가별 제외 PPLA3 5만+ 감사 대상 수

| 국가 | 건수 |
| --- | --- |
| AO | 8 |
| AR | 1 |
| BA | 1 |
| BD | 1 |
| BE | 4 |
| BF | 1 |
| BJ | 1 |
| CA | 4 |
| CD | 1 |
| CI | 8 |
| CN | 444 |
| CO | 1 |
| CZ | 1 |
| DE | 102 |
| ES | 65 |
| ET | 2 |
| FI | 5 |
| FR | 22 |
| GB | 19 |
| GR | 23 |
| ID | 11 |
| IN | 13 |
| IQ | 2 |
| IR | 2 |
| IT | 46 |
| JO | 1 |
| JP | 1 |
| KP | 1 |
| KR | 3 |
| LK | 1 |
| MA | 30 |
| MM | 1 |
| NP | 1 |
| PA | 1 |
| PE | 17 |
| PH | 145 |
| PK | 2 |
| PL | 13 |
| RS | 3 |
| RU | 2 |
| SY | 2 |
| TR | 1 |
| TZ | 1 |
| UA | 8 |
| US | 2 |
| VE | 2 |
| VN | 1 |
| ZA | 35 |

#### 제외된 PPLA3 중 5만+ 표본

**KR**

| ID | 이름 | 인구 |
| --- | --- | --- |
| 1843137 | Gangneung | 208161 |
| 1842966 | Gijang | 176388 |
| 1832501 | Yeonggwang | 51688 |

**JP**

| ID | 이름 | 인구 |
| --- | --- | --- |
| 8125829 | Kamigyō-ku | 83000 |

**CN**

| ID | 이름 | 인구 |
| --- | --- | --- |
| 13308620 | Bao'an | 4476554 |
| 1798425 | Puyang | 3590000 |
| 1791388 | Wenzhou | 2650000 |
| 1795855 | Shaoxing | 2300000 |
| 1816917 | Baoshan | 2265900 |
| 1785623 | Kunshan | 2092496 |
| 1794035 | Songjiang | 1973500 |
| 1815251 | Jiangyin | 1779515 |
| 7283386 | Changshu | 1677050 |
| 1793505 | Taizhou | 1607108 |
| 1800627 | Mianyang | 1550000 |
| 12358576 | Wanzhou | 1545900 |
| 1814870 | Yiwu | 1481384 |
| 1806602 | Cixi | 1457510 |
| 1791121 | Changde | 1457419 |
| 1787331 | Zhangjiagang | 1432044 |
| 1797658 | Jinjiang | 1416151 |
| 1802875 | Guankou | 1380000 |
| 1786760 | Yixing | 1285785 |
| 1797798 | Qingpu | 1271424 |
| 1799491 | Neijiang | 1251095 |
| 1792892 | Tianshui | 1212791 |
| 1787375 | Yangpu | 1210800 |
| 1787957 | Xuhui | 1109800 |
| 1785781 | Yulin | 1056743 |
| 1790353 | Xianyang | 1034081 |
| 7602670 | Zhu Cheng City | 1000000 |
| 1804591 | Laiwu | 989535 |
| 1796823 | Sanhe | 965075 |
| 1886762 | Zhoushan | 882932 |

**IN**

| ID | 이름 | 인구 |
| --- | --- | --- |
| 8440756 | Modīnagar | 475843 |
| 1265014 | Latur | 382940 |
| 1265767 | Kukatpally | 341709 |
| 1273241 | Deoghar | 203123 |
| 1254757 | Thenali | 164937 |
| 1275539 | Beed | 146709 |
| 1261012 | Dharashiv | 112085 |
| 1272513 | Deesa | 111160 |
| 1269374 | Jamālpur | 105434 |
| 1260390 | Paralakhemundi | 87152 |
| 1260792 | Palakollu | 81199 |
| 1258338 | Ratnagiri | 76229 |
| 8541672 | Kagaznāgār | 57583 |

**US**

| ID | 이름 | 인구 |
| --- | --- | --- |
| 5221659 | Cranston | 81073 |
| 5756758 | Tigard | 51253 |

**BR**

| ID | 이름 | 인구 |
| --- | --- | --- |

#### 인구 0으로 제외된 P 기록 표본 (6개 국가, 원본 ID 순 최대 12)

이 표본은 중요한 도시 확정 목록이 아니다. 특히 마을/리 레코드도 많아 인구 0만으로 전부 복원할 수 없다.

| 국가 | ID | 이름 | 코드 |
| --- | --- | --- | --- |
| KR | 1832007 | Yongi | PPL |
| KR | 1832008 | Tokusan-ri | PPL |
| KR | 1832010 | Songch’ŏl-li | PPL |
| KR | 1832011 | Sanwŏl-li | PPL |
| KR | 1832020 | Yuyu | PPL |
| KR | 1832025 | Yutujeong | PPL |
| KR | 1832026 | Yutangchon | PPL |
| KR | 1832028 | Yusuam | PPL |
| KR | 1832029 | Yusu | PPL |
| KR | 1832033 | Yusong-ni | PPL |
| KR | 1832035 | Yusindong | PPL |
| KR | 1832036 | Yusil | PPL |
| JP | 1847943 | Yotsuhama | PPL |
| JP | 1847951 | Mimitsu | PPL |
| JP | 1847954 | Katayamazu | PPL |
| JP | 1847957 | Gōnotao | PPL |
| JP | 1847970 | Zukeran | PPL |
| JP | 1847974 | Zōzo | PPL |
| JP | 1847977 | Zōshuku | PPL |
| JP | 1847979 | Awazuchō | PPL |
| JP | 1847981 | Zeze | PPL |
| JP | 1847985 | Ikawadanichō-zenkai | PPL |
| JP | 1847989 | Zengi | PPL |
| JP | 1847992 | Zenda | PPL |
| CN | 1279423 | Zongzhai | PPLA4 |
| CN | 1279424 | Zongza | PPL |
| CN | 1279425 | Sumchêng | PPL |
| CN | 1279426 | Zonglung | PPL |
| CN | 1279427 | Zongjiafangzi | PPL |
| CN | 1279428 | Zongjia | PPLA4 |
| CN | 1279429 | Zongga | PPLA3 |
| CN | 1279430 | Zhangdu | PPL |
| CN | 1279432 | Zhuqing | PPL |
| CN | 1279435 | Zito | PPLA3 |
| CN | 1279436 | Ziqudukou | PPL |
| CN | 1279440 | Zingqi | PPL |
| IN | 1163293 | Tithwāl | PPL |
| IN | 1163420 | Thruti | PPL |
| IN | 1171555 | Mahmūd Khāneke | PPL |
| IN | 1178984 | Ganga Sāgar | PPL |
| IN | 1181619 | Chalunka | PPL |
| IN | 1252651 | Zuvvaladinne | PPL |
| IN | 1252656 | Zulidok | PPL |
| IN | 1252657 | Zulhami | PPL |
| IN | 1252658 | Zūlakallu | PPL |
| IN | 1252659 | Zuchhip | PPL |
| IN | 1252660 | Zozar | PPL |
| IN | 1252661 | Zotlāng | PPL |
| US | 4045510 | Amchitka | PPL |
| US | 4045976 | Navy Town | PPL |
| US | 4046221 | Bauxite | PPL |
| US | 4046230 | Cherokee | PPL |
| US | 4046235 | Baxters | PPL |
| US | 4046242 | College Hill | PPL |
| US | 4046246 | Concrete | PPL |
| US | 4046252 | Cost | PPL |
| US | 4046264 | Doty | PPL |
| US | 4046270 | East Fresnos Colonia | PPL |
| US | 4046276 | El Monte Colonia | PPL |
| US | 4046286 | Evans | PPL |
| BR | 3384864 | Zundão | PPL |
| BR | 3384868 | Zumbi | PPL |
| BR | 3384869 | Zumbi | PPL |
| BR | 3384870 | Zumbi | PPL |
| BR | 3384871 | Zumbi | PPL |
| BR | 3384872 | Zorra | PPL |
| BR | 3384873 | Zombaria | PPL |
| BR | 3384874 | Zombaria | PPL |
| BR | 3384877 | Zimbro | PPL |
| BR | 3384880 | Zezito | PPL |
| BR | 3384884 | Zelândia | PPL |
| BR | 3384886 | Zé Gomes | PPL |
#### 고위도 일반 정착지: 1천 이상·5만 미만 제외 표본

절대 위도 ≥60°라는 검토 신호일 뿐, 유일한 중심지나 원격성의 증명이 아니다. 중심성 계산은 하지 않았다.

| ID | 국가 | 이름 | 인구 | 위도 |
| --- | --- | --- | --- | --- |
| 525404 | RU | Monchegorsk | 49868 | 67.93972 |
| 471101 | RU | Vsevolozhsk | 48224 | 60.01512 |
| 1540356 | RU | Raduzhny | 47679 | 62.09611 |
| 1498087 | RU | Nadym | 46339 | 65.53333 |
| 511794 | RU | Pechora | 46113 | 65.14717 |
| 496519 | RU | Sertolovo | 43622 | 60.1444 |
| 6696686 | RU | Pyt-Yakh | 41500 | 60.74985 |
| 2019951 | RU | Mirny | 40308 | 62.53528 |
| 3162778 | NO | Åsane | 40146 | 60.47444 |
| 3415212 | IS | Kópavogur | 40040 | 64.11234 |
| 469707 | RU | Yagry | 40000 | 64.59417 |
| 6696767 | RU | Langepas | 40000 | 61.25439 |
| 1540711 | RU | Muravlenko | 39137 | 63.78977 |
| 553190 | RU | Kandalaksha | 38431 | 67.15123 |
| 1541359 | RU | Lyantor | 38200 | 61.61945 |
| 496478 | RU | Sestroretsk | 37248 | 60.09801 |
| 3144631 | NO | Nesttun | 35638 | 60.31821 |
| 476062 | RU | Velikiy Ustyug | 32642 | 60.76186 |
| 1505579 | RU | Inta | 32080 | 66.03169 |
| 3416706 | IS | Hafnarfjörður | 31525 | 64.0671 |
| 1502725 | RU | Yugorsk | 30878 | 61.31226 |
| 543899 | RU | Kostomuksha | 30135 | 64.571 |
| 548391 | RU | Kirovsk | 29605 | 67.61475 |
| 6315399 | RU | Isakogorka | 28571 | 64.446 |
| 1494276 | RU | Poykovskiy | 28080 | 61.00136 |
| 1504139 | RU | Kayyerkan | 27295 | 69.37861 |
| 1500933 | RU | Labytnangi | 27067 | 66.65722 |
| 5861187 | US | Eagle River | 24793 | 61.32139 |
| 8198723 | FI | Sastamala | 24495 | 61.34942 |
| 515698 | RU | Olenegorsk | 23670 | 68.1432 |
| 1507116 | RU | Dudinka | 23619 | 69.40583 |
| 11886891 | RU | Fedorovskiy | 23375 | 61.6063 |
| 13645359 | RU | Narian-Mar | 22912 | 67.66782 |
| 654137 | FI | Karhula | 22867 | 60.52156 |
| 515246 | RU | Onega | 22693 | 63.9057 |
| 652305 | FI | Klaukkala | 21019 | 60.38244 |
| 490466 | RU | Sortavala | 20760 | 61.71233 |
| 1539209 | RU | Gubkinskiy | 20463 | 64.434 |
| 8644037 | IS | Reykjanesbær | 19724 | 63.99813 |
| 5879898 | US | Badger | 19482 | 64.8 |

### 수집 실패 / 경고

[{"source": "cities500", "status": "cached", "failures": []}, {"source": "allCountries", "status": "downloaded", "failures": []}]

<!-- geonames-statistics:end -->
