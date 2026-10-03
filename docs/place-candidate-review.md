# 현대 정착지 후보 정제: ID별 근거 검토

검토일: 2026-10-03. 원본은 이전 감사와 같은 공식 GeoNames 2026-10-01 스냅샷이다.
새 dump를 다운로드하거나 지도 데이터·Worker·UI·배포 manifest를 변경하지 않는다.

## 유지한 규칙

- `candidate()`의 전 세계 1차 정의를 유지한다. 수도·PPLA/PPLA2 및 인구 기준 일반 정착지 정책은 기존 [감사 문서](place-data-audit.md)와 같다.
- 구·읍·면·동·borough·ward 등 내부 미세 지명은 출처와 객체 ID가 확인된 경우에만 별도 정제본에서 제외한다.
- 이름 키워드, 같은 이름, 가까운 좌표, 인구 0을 삭제·병합의 근거로 사용하지 않는다.
- `auto-review`는 표시 확정이 아니다. 최종 rank/minZoom/지역 중심성은 계산하지 않는다.
- 중요한 PPLA3·저인구 정착지는 `inclusion-review`로만 남긴다. 이번 단계에서 자동 승격하거나 국가별 대량 예외표를 만들지 않는다.

## 산출물과 재현

근거·판단의 canonical 입력은 `reports/places/candidate-reviews.json`이다. source SHA-256 및 각
ID의 이름·국가·코드·좌표가 원본과 맞지 않으면 다시 검토해야 하므로 생성은 실패한다.
판단은 `exclude`(확인 제외), `hold`(불확실 보류), `retain`(원래 후보 유지),
`inclusion-review`(필터 밖 예외 검토)로 구분한다. 원본 속성을 바꾸는 override가 아니다.

```sh
python -X utf8 tools/build-place-candidates.py review
python -X utf8 -m unittest discover -s tests -p test_place_candidates.py -v
```

- 원래 `.cache/candidates.ndjson`과 `geonames-statistics.json`은 그대로 보존한다.
- `.cache/refined-candidates.ndjson`은 이번 확인 제외·보류 ID만 뺀 별도 후보 풀이다. 나머지는 미검토 원본 후보다.
- `candidate-review-summary.json`과 아래 표는 같은 source·검토 입력에서 네트워크 없이 생성한다.
- 큰 원본 ZIP과 두 NDJSON 모두 ignored cache이며 Git에 추가하지 않는다.

## 이전 감사 해석 정정

1. **Kotō 11209896:** 도쿄 특별구로 단정했던 설명이 잘못됐다. 원본은 `32.77856, 130.74537`,
   `admin1=21/admin2=1858418`로 구마모토 쪽이다. `江東区`와 `湖東` 별칭이 혼재한다.
   이름이나 인구만으로 도쿄로 이동시키거나 구마모토의 특정 지명으로 바꾸지 않는다.
2. **Masan 1841246:** 좌표 `35.12725, 126.83149` 및 소속은 광주 쪽이다. 이를 창원 마산
   통합 사례만으로 설명할 수 없다. 이름·인구·지점 의미를 재확인할 때까지 정제본에서는 보류한다.
3. **Puyang 1798425:** 원본의 `浙江/3307`, `浦阳街道/浦江` 별칭은 河南의 `濮阳市`와 다르다.
   실제 河南 후보 `9181182`는 이미 1차 목록에 있다. 359만 인구를 이유로 중요한 누락 도시로
   확정했던 예시를 취소하고 보류한다. 서로 다른 ID를 합치거나 인구를 이식하지 않는다.

## 확인 한계와 다음 검토 묶음

이번은 대표 문제 ID의 첫 정제 묶음이지 전 세계 32,277개를 의미 단위로 확정한 작업이 아니다.
공식 행정기관 자료와 GeoNames 원본 좌표·소속·별칭을 대조했지만, 전 세계 행정 경계 point-in-polygon이나
도시 인구 범위 검증을 수행하지 않았다. 검색 색인으로만 확인 가능한 공식 페이지는 표에 그 한계를 기록한다.
Yuseong 페이지 timeout, 이천 페이지 bad request 및 잘못된 부평/크랜스턴 URL은 공식 색인 또는
현재 공식 페이지로 대체했다. 비공식 미러로 정체를 확정하지 않았다.

다음 우선순위는 한국의 남은 옛 이름·중복 행정중심, 일본의 합병 전 시/내부 지명,
중국의 같은 로마자·다른 한자 지명 및 인구 영역 불일치이다. 동좌표/근접 ID 쌍은 병합 없이
개별 근거부터 확인한다. 이 검토 목록을 지도 런타임이나 검색 데이터에 연결하지 않는다.

<!-- geonames-statistics:start -->

## 재생성 가능한 ID별 검토 결과

검토 원본: `cities500` / SHA-256 `4ba815404241c08ca40a5dcdcfe35dee4ae51bb848bfff2c01d8ad35507ae232`.

| 항목 | 건수 |
| --- | --- |
| 1차 후보 (변경 없음) | 32277 |
| 이번 ID별 검토 | 38 |
| 후보에서 확인 제외 | 20 |
| 후보에서 임시 보류 | 4 |
| 별도 정제 후보 | 32253 |
| 정제본 내 미검토 | 32248 |

정제본은 전 세계 검증 완료 목록이 아니다. 미검토 기록은 원래 후보 그대로 남는다.
`inclusion-review`는 필터 밖의 재검토 제안이며 정제본에 추가하지 않는다.

| country | baseline | refined | excluded | held |
| --- | --- | --- | --- | --- |
| JP | 865 | 857 | 6 | 2 |
| KR | 113 | 102 | 9 | 2 |
| US | 3600 | 3595 | 5 | 0 |

### exclude

| ID | 국가 | 원명 | 코드 / 인구 | 좌표 lat / lon | 1차 포함 | 판단 | 근거 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1832034 | KR | Yuseong | PPLA2 / 0 | 36.35389 / 127.33667 | yes | 대전 유성구의 내부 구급 중심. 저인구 행정중심 유지 규칙이 미세 지명 제외보다 우선하는 것은 아니다. | [yuseong](https://www.yuseong.go.kr/kor/sub06_01_03.do) |
| 1834203 | KR | Dongnae | PPLA2 / 0 | 35.20159 / 129.08477 | yes | 부산 동래구 내부 구급 중심으로 시·군급 정착지 범위 밖. | [dongnae](https://www.dongnae.go.kr/index.dongnae?menuCd=DOM_000000101001000000) |
| 1839110 | KR | Beobwon | PPLA2 / 0 | 37.84902 / 126.87533 | yes | 파주시 법원읍. 인구 0 PPLA2이지만 이번 범위에서 읍급은 제외. | [beobwon](https://dong.paju.go.kr/dong/dong_01/dong_sub03/dong_sub03_01/dong_sub03_01_01.jsp) |
| 1896953 | KR | Pubal | PPL / 63026 | 37.29167 / 127.50778 | yes | 이천시 부발읍으로 인구 기준을 통과해도 읍급 제외. | [bubal](https://www.icheon.go.kr/csc/contents.do?mid=0102010200) |
| 1897118 | KR | Hwado | PPL / 106358 | 37.6525 / 127.3075 | yes | 남양주시 화도읍. 인구 10만 이상이어도 읍급이므로 자동표시 심사 대상으로 남기지 않는다. | [namyangju](https://www.nyj.go.kr/www/contents.do?key=2866) |
| 1912209 | KR | Wabu | PPL / 96775 | 37.58972 / 127.22028 | yes | 남양주시 와부읍으로 미세 지명 범위. | [namyangju](https://www.nyj.go.kr/www/contents.do?key=2866) |
| 1925936 | KR | Naesŏ | PPL / 80987 | 35.24972 / 128.52 | yes | 창원시 마산회원구 내서읍으로 읍급 제외. | [naeseo](https://www.changwon.go.kr/cwportal/_res/gu/data/pdf/p12139_down01_2026.pdf) |
| 1925943 | KR | Hwawŏn | PPL / 64718 | 35.80167 / 128.50083 | yes | 달성군 화원읍. 군의 내부 읍 레코드이며 별도 군 중심으로 승격하지 않는다. | [hwawon](https://dalseong.daegu.kr/kor/index.do?menu_id=90003298) |
| 5110266 | US | The Bronx | PPLA2 / 1385108 | 40.84985 / -73.86641 | yes | New York City 내부 borough/county. 다른 county seat 전체를 제외하는 규칙으로 일반화하지 않는다. | [nyc](https://portal.311.nyc.gov/article/?kanumber=KA-02877) |
| 5110302 | US | Brooklyn | PPLA2 / 2736074 | 40.6501 / -73.94958 | yes | New York City 내부 borough/county. 다른 county seat 전체를 제외하는 규칙으로 일반화하지 않는다. | [nyc](https://portal.311.nyc.gov/article/?kanumber=KA-02877) |
| 5125771 | US | Manhattan | PPLA2 / 1487536 | 40.78343 / -73.96625 | yes | New York City 내부 borough/county. 다른 county seat 전체를 제외하는 규칙으로 일반화하지 않는다. | [nyc](https://portal.311.nyc.gov/article/?kanumber=KA-02877) |
| 5133273 | US | Queens | PPLA2 / 2316841 | 40.68149 / -73.83652 | yes | New York City 내부 borough/county. 다른 county seat 전체를 제외하는 규칙으로 일반화하지 않는다. | [nyc](https://portal.311.nyc.gov/article/?kanumber=KA-02877) |
| 5139568 | US | Staten Island | PPLA2 / 468730 | 40.56233 / -74.13986 | yes | New York City 내부 borough/county. 다른 county seat 전체를 제외하는 규칙으로 일반화하지 않는다. | [nyc](https://portal.311.nyc.gov/article/?kanumber=KA-02877) |
| 8125829 | JP | Kamigyō-ku | PPLA3 / 83000 | 35.02954 / 135.75666 | no | 교토시 내부 구. 원래부터 제외되어 있으며 큰 PPLA3의 일괄 복구 대상이 아님을 확인. | [kyoto](https://www.city.kyoto.lg.jp/kamigyo/index.html) |
| 8469284 | JP | Katsushika | PPLA2 / 453093 | 35.73333 / 139.85 | yes | 도쿄 특별구 중심. 특별구의 자치단체 지위와 별개로 이번 도시 내부 ward 제외 범위를 적용한다. | [tokyo](https://www.gikai.metro.tokyo.lg.jp/link/ward_municipality.html) |
| 8469285 | JP | Kita | PPLA2 / 332140 | 35.75264 / 139.73348 | yes | 도쿄 특별구 중심. 특별구의 자치단체 지위와 별개로 이번 도시 내부 ward 제외 범위를 적용한다. | [tokyo](https://www.gikai.metro.tokyo.lg.jp/link/ward_municipality.html) |
| 8469289 | JP | Ōta | PPLA2 / 748081 | 35.56126 / 139.71605 | yes | 도쿄 특별구 중심. 특별구의 자치단체 지위와 별개로 이번 도시 내부 ward 제외 범위를 적용한다. | [tokyo](https://www.gikai.metro.tokyo.lg.jp/link/ward_municipality.html) |
| 8715035 | JP | Nakano | PPLA2 / 344880 | 35.70449 / 139.66946 | yes | 도쿄 특별구 중심. 특별구의 자치단체 지위와 별개로 이번 도시 내부 ward 제외 범위를 적용한다. | [tokyo](https://www.gikai.metro.tokyo.lg.jp/link/ward_municipality.html) |
| 11549691 | KR | Bupyeong | PPLA2 / 0 | 37.50533 / 126.72202 | yes | 인천 부평구 내부 구급 중심으로 별도 시가 아니다. | [bupyeong](https://www.icbp.go.kr/main/) |
| 13353695 | JP | Chūō | PPLA2 / 169179 | 35.67004 / 139.77544 | yes | 도쿄 특별구 중심. 특별구의 자치단체 지위와 별개로 이번 도시 내부 ward 제외 범위를 적용한다. | [tokyo](https://www.gikai.metro.tokyo.lg.jp/link/ward_municipality.html) |
| 13353696 | JP | Minato City | PPLA2 / 260486 | 35.6581 / 139.7515 | yes | 도쿄 특별구 중심. 특별구의 자치단체 지위와 별개로 이번 도시 내부 ward 제외 범위를 적용한다. | [tokyo](https://www.gikai.metro.tokyo.lg.jp/link/ward_municipality.html) |

### hold

| ID | 국가 | 원명 | 코드 / 인구 | 좌표 lat / lon | 1차 포함 | 판단 | 근거 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1798425 | CN | Puyang | PPLA3 / 3590000 | 29.45679 / 119.88872 | no | 浙江 浦阳街道/浦江 별칭과 인구3590000이 붙은 레코드. 河南 濮阳(9181182)과 다른 ID·위치·소속이며 기존 대도시 누락 예시를 정정. 이미 필터 밖이므로 추가하지 않는다. | [pujiang](https://www.pj.gov.cn/col/col1229196645/index.html), [puyangHenan](https://pyxinqu.puyang.gov.cn/) |
| 1833332 | KR | Tallang-dong | PPL / 54954 | 33.49028 / 126.47528 | yes | 노형동/Wollang 별칭이 섞인 내부 동급 의심. 정확한 현대 지점 확인 전 삭제 확정이나 이름 교체 없이 보류. | [jeju](https://audit.jeju.go.kr/news/activity/result.htm?act=download&no=1&page=4&seq=36530) |
| 1841246 | KR | Masan | PPL / 434371 | 35.12725 / 126.83149 | yes | 원본은 광주 admin1=18/admin2=24020 및 경도126.83149인데 인구434371과 마산 이름이 붙음. 창원 마산으로 추정해 좌표 수정·이름 병합하지 않고 정체/인구 검증까지 보류. | [naeseo](https://www.changwon.go.kr/cwportal/_res/gu/data/pdf/p12139_down01_2026.pdf) |
| 1865689 | JP | Aihara | PPL / 725493 | 35.6 / 139.31667 | yes | 相原 내부 지역 및 Sagamihara 별칭에 시 규모 인구725493이 붙음. 경계·인구 의미 미확정으로 Sagamihara와 합치지 않고 보류. | [sagamihara](https://www.city.sagamihara.kanagawa.jp/midoriku/hashimoto/index.html) |
| 11209896 | JP | Kotō | PPL / 543730 | 32.77856 / 130.74537 | yes | 원본 admin1=21/admin2=1858418과 좌표는 구마모토 쪽인데 江東区/Koto City/湖東 별칭과 인구543730이 혼재. 도쿄 특별구로 단정했던 이전 감사 설명을 정정하고 보류. | [koto](https://www.city.koto.lg.jp/kuse/profile/ichi/index.html) |

### inclusion-review

| ID | 국가 | 원명 | 코드 / 인구 | 좌표 lat / lon | 1차 포함 | 판단 | 근거 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1265014 | IN | Latur | PPLA3 / 382940 | 18.39721 / 76.56784 | no | district 중심 도시지만 PPLA3라 제외. 행정중심 정착지 예외 후보이며 이번 정제본에는 추가하지 않는다. | [latur](https://latur.gov.in/en/administrative-setup/) |
| 1273241 | IN | Deoghar | PPLA3 / 203123 | 24.48983 / 86.69902 | no | district의 주요 도시임을 확인. PPLA3 소수 예외 검토만 기록하며 자동 추가하지 않는다. | [deoghar](https://deoghar.nic.in/history/) |
| 1791388 | CN | Wenzhou | PPLA3 / 2650000 | 27.99942 / 120.66682 | no | 温州市 중심의 누락 후보. 큰 인구의 행정구역/시가지 범위는 미검증이므로 최종 순위 없이 소수 예외 검토만 기록. | [wenzhou](https://wztjj.wenzhou.gov.cn/attach/0/d077e71612ed4b42b271c1ac499e41de.pdf) |
| 1843137 | KR | Gangneung | PPLA3 / 208161 | 37.75266 / 128.87239 | no | 강릉시 중심의 중요한 누락. 원래 PPLA3 제외는 유지하고 소수 ID 예외 승인을 위한 검토 대상으로만 기록. | [gangneung](https://www.gn.go.kr/) |
| 5221659 | US | Cranston | PPLA3 / 81073 | 41.77982 / -71.43728 | no | Providence 대도시권 안에 있어도 독립 시이다. 위성/근접성만으로 미세 지명으로 취급하지 않고 PPLA3 예외 검토. | [cranston](https://cranstonri.gov/government/default.aspx) |
| 5756758 | US | Tigard | PPLA3 / 51253 | 45.43123 / -122.77149 | no | Oregon의 incorporated city. PPLA3 소수 예외 검토 대상이며 인구50k+만으로 모든 PPLA3을 복구하지 않는다. | [tigard](https://sos.oregon.gov/blue-book/government/pages/tigard.aspx) |
| 5983607 | CA | Inuvik | PPL / 3243 | 68.36166 / -133.72817 | no | 인구3243이지만 Western Arctic 행정중심. 저밀도 지역 대표 정착지 예외 검토 대상으로 남기고 자동 추가/순위 결정하지 않는다. | [inuvik](https://www.inuvik.ca/en/town-hall/resources/PRINTABLE-LISTS/Community-Plan---First-Reading-Dec-4_Optimized.pdf) |

### retain

| ID | 국가 | 원명 | 코드 / 인구 | 좌표 lat / lon | 1차 포함 | 판단 | 근거 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1853677 | JP | Ōta | PPLA2 / 224358 | 36.3 / 139.36667 | yes | 군마현 太田市. 도쿄 大田区(8469289)와 동명이지만 별도 ID로 유지. | [otaGunma](https://www.city.ota.gunma.jp/) |
| 2737038 | PT | Oliveira do Hospital | PPLA2 / 4704 | 40.3618 / -7.86014 | yes | 정상 지방자치 중심. Hospital 키워드 오탐이며 저인구 행정중심 검색 후보 유지. | [oliveira](https://portalautarquico.dgal.gov.pt/pt-PT/entidades-locais/concelhos/oliveira-do-hospital/) |
| 4682464 | US | College Station | PPL / 107889 | 30.62798 / -96.33441 | yes | 정상 시 이름. station 키워드만으로 역/시설 POI로 제외하지 않는다. 원본 인구를 최신 인구로 교체하지 않음. | [college](https://www.cstx.gov/) |
| 9181182 | CN | Puyang | PPLA2 / 655674 | 35.75641 / 115.04363 | yes | 河南 濮阳市의 현재 기준 후보는 이미 포함되어 있다. 浙江 Puyang(1798425)의 인구나 이름을 가져오지 않는다. | [puyangHenan](https://pyxinqu.puyang.gov.cn/) |
| 11611609 | JP | Sagamihara | PPLA2 / 720780 | 35.56707 / 139.24167 | yes | 相模原市의 시 중심 후보 유지. Aihara와 인구나 별칭이 유사하다고 ID를 합치지 않는다. | [sagamihara](https://www.city.sagamihara.kanagawa.jp/midoriku/hashimoto/index.html) |

### 자료 확인 방식과 한계

| 근거 | 확인일 | 확인 방식 | 판정에 사용한 사실 |
| --- | --- | --- | --- |
| [yuseong](https://www.yuseong.go.kr/kor/sub06_01_03.do) | 2026-10-03 | official-search-index; full page fetch timed out | 유성의 현재 행정 실체는 대전의 구이다. |
| [dongnae](https://www.dongnae.go.kr/index.dongnae?menuCd=DOM_000000101001000000) | 2026-10-03 | official-page | 부산 동래구청 주소와 구청 행정조직을 확인했다. |
| [bupyeong](https://www.icbp.go.kr/main/) | 2026-10-03 | official-page; corrected obsolete bupyeong.go.kr URL | 부평은 인천의 구이며 별도 시가 아니다. |
| [beobwon](https://dong.paju.go.kr/dong/dong_01/dong_sub03/dong_sub03_01/dong_sub03_01_01.jsp) | 2026-10-03 | official-page | 법원은 파주시 법원읍으로 안내된다. |
| [namyangju](https://www.nyj.go.kr/www/contents.do?key=2866) | 2026-10-03 | official-page | 공식 읍면동 목록에 와부읍과 화도읍을 명시한다. |
| [bubal](https://www.icheon.go.kr/csc/contents.do?mid=0102010200) | 2026-10-03 | official-search-index; full page fetch returned bad request | 부발읍의 연혁과 1989년 읍 승격을 안내한다. |
| [naeseo](https://www.changwon.go.kr/cwportal/_res/gu/data/pdf/p12139_down01_2026.pdf) | 2026-10-03 | official-indexed-document | 2026년 업무계획에 내서읍 호계리 등 마산회원구 내 읍 지역을 제시한다. |
| [hwawon](https://dalseong.daegu.kr/kor/index.do?menu_id=90003298) | 2026-10-03 | official-page | 달성군 행정조직의 읍면 목록에 화원읍을 명시한다. |
| [tokyo](https://www.gikai.metro.tokyo.lg.jp/link/ward_municipality.html) | 2026-10-03 | official-page | 葛飾・北・大田・中野・中央・港을 도쿄23구 목록에, 별도 시들을 시정촌 목록에 구분한다. |
| [nyc](https://portal.311.nyc.gov/article/?kanumber=KA-02877) | 2026-10-03 | official-page | Bronx, Brooklyn, Manhattan, Queens, Staten Island은 모두 New York City의 borough이며 county이기도 하다. |
| [kyoto](https://www.city.kyoto.lg.jp/kamigyo/index.html) | 2026-10-03 | official-search-index | 上京区는 교토시 내부 구로 안내된다. |
| [sagamihara](https://www.city.sagamihara.kanagawa.jp/midoriku/hashimoto/index.html) | 2026-10-03 | official-search-index | 相原1~6丁目를 相模原市 緑区 橋本地区 내부 지역으로 열거한다. GeoNames Aihara 레코드 자체의 경계 일치까지 증명하지는 않는다. |
| [koto](https://www.city.koto.lg.jp/kuse/profile/ichi/index.html) | 2026-10-03 | official-search-index | 도쿄 江東区의 위치 안내이다. GeoNames 11209896의 구마모토 좌표와 도쿄 별칭을 동일 객체로 확정하지 않는다. |
| [jeju](https://audit.jeju.go.kr/news/activity/result.htm?act=download&no=1&page=4&seq=36530) | 2026-10-03 | official-indexed-document | 노형동은 제주시 내부 동 목록에 있다. Tallang/Wollang 별칭의 정확한 현대 지점은 아직 미확정이다. |
| [college](https://www.cstx.gov/) | 2026-10-03 | official-search-index | College Station은 Texas의 시이며 station이라는 단어가 시설 판정을 뜻하지 않는다. |
| [oliveira](https://portalautarquico.dgal.gov.pt/pt-PT/entidades-locais/concelhos/oliveira-do-hospital/) | 2026-10-03 | official-page | Oliveira do Hospital은 지방자치단체 이름이며 Hospital이라는 단어만으로 병원 POI로 제외할 수 없다. |
| [otaGunma](https://www.city.ota.gunma.jp/) | 2026-10-03 | official-page | 군마 太田市는 도쿄 大田区와 다른 시이다. 동명 GeoNames ID를 병합하지 않는다. |
| [pujiang](https://www.pj.gov.cn/col/col1229196645/index.html) | 2026-10-03 | official-search-index | 浦阳街道办事处를 浦江县의 향진가도 목록에 명시한다. 河南 濮阳市와 표기 및 소속이 다르다. |
| [puyangHenan](https://pyxinqu.puyang.gov.cn/) | 2026-10-03 | official-search-index | 河南 濮阳市의 공식 행정기관이다. GeoNames 9181182는 河南/4109와 濮阳 별칭을 가지며 1798425의 浙江/3307 및 浦阳과 다르다. |
| [gangneung](https://www.gn.go.kr/) | 2026-10-03 | official-search-index | 강릉은 강원특별자치도의 시이다. PPLA3로 빠진 정착지의 소수 예외 검토 대상이다. |
| [latur](https://latur.gov.in/en/administrative-setup/) | 2026-10-03 | official-search-index | 라투르시와 district 행정중심을 명시한다. |
| [deoghar](https://deoghar.nic.in/history/) | 2026-10-03 | official-search-index | Deoghar를 district의 주요 도시로 설명한다. |
| [cranston](https://cranstonri.gov/government/default.aspx) | 2026-10-03 | official-page | Cranston은 Rhode Island의 시이며 Providence 대도시권에 속해도 독립 시이다. |
| [tigard](https://sos.oregon.gov/blue-book/government/pages/tigard.aspx) | 2026-10-03 | official-search-index | Tigard를 incorporated city로 등재한다. |
| [inuvik](https://www.inuvik.ca/en/town-hall/resources/PRINTABLE-LISTS/Community-Plan---First-Reading-Dec-4_Optimized.pdf) | 2026-10-03 | official-indexed-document | Inuvik을 Western Arctic의 정부 행정중심으로 설명한다. 지역의 유일 중심 또는 최종 자동표시 순위를 계산한 것은 아니다. |
| [wenzhou](https://wztjj.wenzhou.gov.cn/attach/0/d077e71612ed4b42b271c1ac499e41de.pdf) | 2026-10-03 | official-indexed-document | 温州 도시·현·구의 통계 체계를 구분한다. GeoNames 인구를 최신 시가지 인구로 검증하거나 바꾸지는 않는다. |

정제 파일: `.cache/refined-candidates.ndjson`, SHA-256 `3768577baf4127dfc896684685c3781101e0a01d6c8dcc31e8da491827eba326`.

<!-- geonames-statistics:end -->
