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

## 두 번째 검토 묶음: 한국의 옛 중심·중복점과 일본 합병 지명

첫 38개 판단에 이어 **25개 ID**를 추가했다. 신규 판단은 확인 제외 5개, 보류 6개,
기존 후보 유지 11개, 필터 밖 포함 예외 검토 3개이다. 아래 재생성 표는 후속 묶음까지 포함한 누적 결과다.

- **확인 제외:** 거제 옛 신현읍, 양산 옛 웅상읍, 川口市 내부 鳩ヶ谷本町,
  さいたま市 내부 옛 与野, 浜松市 내부 옛 浜北. 합병 후 도시의 내부 지명으로 판단했으며
  이들 이름이 지역명으로 더 이상 사용되지 않는다는 뜻은 아니다.
- **보류:** Kwangyang 1841775, Kyosai 1842754, Geoje 11101805,
  Sinan 6395804, Uiwang 6573901, Yeosu 13439582. 원래 좌표·소속·별칭과 공식
  시/군청·내부 행정단위를 대조했지만 경계 포함·대표점·인구 범위를 확정하지 못했다.
  이름이나 거리만으로 병합·삭제 확정·좌표 이동·인구 이식을 하지 않는다.
- **유지:** Eisen/Nangen은 별칭과 소속·지점을 대조했을 때 현대 영천/남원에 대응한다.
  낡은 표제어라는 이유로 정착지를 지우지 않는다. 광양·여수의 현행 시 중심, 인구 0인
  압해읍 쪽 신안 행정중심, 군청 소재지 창녕, 일본의 현행 합병 도시 3개와 Miyoshi 동명 도시 2개도 유지한다.
- **포함 예외 검토:** 태백 1835515, 삼척(Santyoku) 1838069, 양구 1832909는
  현행 시/군 중심의 누락 사례로 기록했다. 원래 5만 기준이나 PPLA3 정책을 변경하지 않으며
  `inclusion-review`는 아직 정제본에 추가하는 승인이 아니다.

옛 표제어의 현대 대표 이름과 인구 범위는 후속 데이터 정규화 항목이다. 이번 판단은 ID의
후보 유지·제외·보류만 정하며 원본 이름을 영천/남원/삼척으로 다시 쓰지는 않는다.
`읍`/`町` 별칭만 보고 군 중심 정착지 창녕이나 愛知県 みよし市를 삭제하지 않은 사례도 남겼다.
반대로 거제의 3개 원본 후보는 이번 정제본에서 모두 제외/보류되므로 **현재 거제 중심 후보가
미해결 상태로 남는다.** 잘못된 위치를 확정하는 대신 이후 정확한 대표점·현대명 검토로 해결해야 한다.

## 세 번째 검토 묶음: 중국 동명 도시·내부 구와 인구 범위

**15개 ID**를 추가 검토했다. 확인 제외 3개, 보류 1개, 기존 후보 유지 10개,
필터 밖 포함 예외 검토 1개이다. 한국 보류 3개는 근거만 보강하고 판단은 유지했다.

- **확인 제외:** Tanggu 1793424, Hangu 1808931, Daxing 1807544.
  앞의 두 기록은 天津 滨海新区 내부의 옛 塘沽·汉沽 지역으로, [2009년 공식 행정구역 조정](https://www.tj.gov.cn/zwgk/szfwj/tjsrmzf/202005/t20200519_2365317.html)을
  원본 소속·별칭과 대조했다. 大兴/Huangcun은 [北京 大兴区의 내부 구·진 구조](https://www.bjdx.gov.cn/bjsdxqrmzf/zjdx/dxgk/index.html)와 대조해 제외했다.
  지역 이름·시가지가 사라졌다는 판단은 아니며, 인구를 상위 도시 기록에 합산하지 않는다.
- **동명 도시 유지:** 江苏 苏州와 安徽 宿州, 福建 福州와 江西 抚州,
  江西 宜春와 黑龙江 伊春는 로마자가 같아도 한자·성·소속·위치가 서로 다른 도시이다.
  浙江 台州도 별도로 유지한다. 각 ID의 공식 정체 근거는 아래 생성 표에 연결했다.
  이 확인은 도시 존재·정체에 대한 판단이며 정확한 대표점·인구 범위·표시 순위의 승인은 아니다.
- **보류:** Fuzhou 8309983에는 福州市와 鼓楼区/Gulou Qu 별칭이 섞여 있다.
  [공식 鼓楼区 설명](https://www.gl.gov.cn/xjwz/rw/)은 내부 시구임을 확인하지만, 이 ID의
  도시 대표점/구 중심 의미를 확정하지 못했다. 인구 0이나 다른 후보와의 근접 자체가 보류 이유는 아니다.
  정상 성도 PPLA 1810821은 유지하고 두 ID를 자동 병합하거나 이름을 교체하지 않는다.
- **포함 예외 검토:** 江苏 泰州 1793505는 [공식 도시 개황](https://www.taizhou.gov.cn/cms_files/filemanager/288403819/attach/20237/ce0cdc2d266148068c4506c69ea8d853.pdf)상 지급시이나
  원본 코드가 PPLA3여서 1차 필터 밖이다. 개별 `inclusion-review`로만 기록하고,
  중국 PPLA3 일괄 예외나 원본 코드 교체를 추가하지 않는다. 浙江 台州 8400694와도 별개이다.
- **인구 0 행정중심 유지:** 广西 玉林 12256566은 PPLA2 후보로 유지한다.
  인근 PPLA3나 榆林镇·鱼鳞乡·育林乡 등의 동명 ID에서 인구·이름을 가져오지 않는다.

**인구 범위의 구체적 불일치도 기록했다.** Zibo 1785286의 4,704,138과 Weifang 1791681의
9,386,705는 [山东省 공식 2020년 지급시별 인구조사 표](https://tjj.shandong.gov.cn/art/2021/5/21/art_6293_10287511.html)의
전체 행정영역 수치와 정확히 일치한다. GeoNames 값의 원 출처 계보를 증명한 것은 아니지만,
이를 각각 단일 시가지의 인구로 검증됐다고 볼 수 없다. 도시 후보 자체는 유지하고 원본 값도
보존하며, 최종 규모·rank 검토에서 공간 범위를 구분해야 한다는 판단을 남겼다.
다른 중국 도시도 크다는 이유만으로 일괄 보류하거나 새 인구 값으로 덮어쓰지 않는다.

Kyosai 1842754·Geoje 11101805는 [거제시 통계지도](https://data.geoje.go.kr/index.geoje?menuCd=DOM_000000202003001000),
Uiwang 6573901은 [의왕시 행정구역도](https://www.uiwang.go.kr/UWKORINTRO0103)를 추가 대조했다.
각 내부 행정단위와 시청 위치는 확인했지만 원본 좌표의 경계 포함·대표점 의미까지 검증하지 못했으므로
보류를 해제하지 않았다. 공식 설명 지도만 보고 좌표를 교정하거나 현재 도시 ID로 병합하지 않는다.

## 확인 한계와 다음 검토 묶음

이번은 대표 문제 ID의 세 정제 묶음이지 전 세계 32,277개를 의미 단위로 확정한 작업이 아니다.
공식 행정기관 자료와 GeoNames 원본 좌표·소속·별칭을 대조했지만, 전 세계 행정 경계 point-in-polygon이나
도시 인구 범위 검증을 수행하지 않았다. 검색 색인으로만 확인 가능한 공식 페이지는 표에 그 한계를 기록한다.
Yuseong 페이지 timeout, 이천 페이지 bad request 및 잘못된 부평/크랜스턴 URL은 공식 색인 또는
현재 공식 페이지로 대체했다. 비공식 미러로 정체를 확정하지 않았다.

두 번째 묶음에서 영천 페이지의 404, 거제·양산·의왕 페이지 timeout, 신안 페이지 502,
삼척 홈페이지 WAF 차단 등으로 전문을 읽지 못한 자료는 공식 검색 색인 또는 공식 연보/도보를
사용한 사실을 각 근거에 기록했다. 보류 ID의 좌표 의미를 확인하지 못한 것을 검증 완료로 표시하지 않는다.

세 번째 묶음에서도 安徽 宿州·江苏 苏州·江西 抚州 개황, 广西 玉林 지리 및 山东省 인구조사
전문은 접근 실패/timeout으로 공식 검색 색인을 사용했다. 공식 환경영향평가 PDF의 지리 설명을
사용한 경우도 `official-indexed-document`로 구분했다. 전문을 읽은 자료와 색인 근거를 혼동하지 않는다.

다음 우선순위는 이번 보류 ID의 경계·대표점 검증과 한국의 남은 옛 이름·중복 행정중심,
일본의 남은 합병 전 시/내부 지명, 중국의 같은 로마자·다른 한자 지명 및 인구 영역 불일치이다.
동좌표/근접 ID 쌍은 병합 없이 개별 근거부터 확인한다. 이 검토 목록을 지도 런타임이나 검색 데이터에 연결하지 않는다.

<!-- geonames-statistics:start -->

## 재생성 가능한 ID별 검토 결과

검토 원본: `cities500` / SHA-256 `4ba815404241c08ca40a5dcdcfe35dee4ae51bb848bfff2c01d8ad35507ae232`.

| 항목 | 건수 |
| --- | --- |
| 1차 후보 (변경 없음) | 32277 |
| 누적 ID별 검토 | 78 |
| 후보에서 확인 제외 | 28 |
| 후보에서 임시 보류 | 11 |
| 별도 정제 후보 | 32238 |
| 정제본 내 미검토 | 32212 |

정제본은 전 세계 검증 완료 목록이 아니다. 미검토 기록은 원래 후보 그대로 남는다.
`inclusion-review`는 필터 밖의 재검토 제안이며 정제본에 추가하지 않는다.

| country | baseline | refined | excluded | held |
| --- | --- | --- | --- | --- |
| CN | 670 | 666 | 3 | 1 |
| JP | 865 | 854 | 9 | 2 |
| KR | 113 | 94 | 11 | 8 |
| US | 3600 | 3595 | 5 | 0 |

### exclude

| ID | 국가 | 원명 | 코드 / 인구 | 좌표 lat / lon | 1차 포함 | 판단 | 근거 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1793424 | CN | Tanggu | PPL / 535298 | 39.02111 / 117.64694 | yes | 天津 滨海新区 내부의 塘沽 지역이다. 원본 塘沽 별칭과 현행 滨海 소속을 2009년 옛 구 폐지 자료와 대조해 이번 내부 구·지역 제외 범위를 적용한다. 인구535298이 커도 별도 도시로 승인하지 않으며 지역 이름·시가지의 소멸을 뜻하거나 다른 ID와 병합하는 것은 아니다. | [binhaiMerger](https://www.tj.gov.cn/zwgk/szfwj/tjsrmzf/202005/t20200519_2365317.html) |
| 1807544 | CN | Daxing | PPL / 104904 | 39.74025 / 116.32693 | yes | 北京 大兴/Huangcun 별칭의 내부 구·진 중심 기록이다. 공식 大兴区와 黄村 등 내부 단위를 대조해 독립 현대 도시 후보가 아닌 내부 지명으로 제외한다. 인구10만 이상이라는 이유로 자동표시를 승인하지 않으며 모든 중국 현급 행정중심을 같은 규칙으로 제거하지 않는다. | [daxingDistrict](https://www.bjdx.gov.cn/bjsdxqrmzf/zjdx/dxgk/index.html) |
| 1808931 | CN | Hangu | PPL / 208369 | 39.24889 / 117.78917 | yes | 天津의 옛 汉沽区는 2009년 滨海新区로 통합됐고 원본도 天津/滨海 소속의 Hangu이다. 도시 내부 옛 구·지역으로 제외하며 비슷한 로마자 이름의 다른 국가·성 지명에 적용하지 않는다. 인구208369을 天津이나 滨海의 다른 기록에 합산하지 않는다. | [binhaiMerger](https://www.tj.gov.cn/zwgk/szfwj/tjsrmzf/202005/t20200519_2365317.html) |
| 1832034 | KR | Yuseong | PPLA2 / 0 | 36.35389 / 127.33667 | yes | 대전 유성구의 내부 구급 중심. 저인구 행정중심 유지 규칙이 미세 지명 제외보다 우선하는 것은 아니다. | [yuseong](https://www.yuseong.go.kr/kor/sub06_01_03.do) |
| 1834203 | KR | Dongnae | PPLA2 / 0 | 35.20159 / 129.08477 | yes | 부산 동래구 내부 구급 중심으로 시·군급 정착지 범위 밖. | [dongnae](https://www.dongnae.go.kr/index.dongnae?menuCd=DOM_000000101001000000) |
| 1839110 | KR | Beobwon | PPLA2 / 0 | 37.84902 / 126.87533 | yes | 파주시 법원읍. 인구 0 PPLA2이지만 이번 범위에서 읍급은 제외. | [beobwon](https://dong.paju.go.kr/dong/dong_01/dong_sub03/dong_sub03_01/dong_sub03_01_01.jsp) |
| 1848254 | JP | Yono | PPL / 102364 | 35.88333 / 139.63333 | yes | 埼玉의 옛 与野市는 2001년 합병 후 さいたま市 내부이고 2003년 옛 시역에 中央区가 설치됐다. 원본 中央区 별칭·소속과 대조해 내부 지명으로 제외한다. 大阪의 동명 Yono 9277769에 이 판단을 전파하지 않는다. | [saitamaMerger](https://www.city.saitama.lg.jp/20th/gaiyou/p081036.html) |
| 1863023 | JP | Hatogaya-honchō | PPL / 53062 | 35.83314 / 139.7425 | yes | 옛 鳩ヶ谷市는 2011-10-11 川口市에 합병됐고 원본 鳩ヶ谷本町는 현재 川口市 내부 町 지명이다. 별도 현대 도시로 유지하지 않으며 현재 Kawaguchi 1859730에 인구53062를 합산하지 않는다. | [hatogayaMerger](https://www.city.kawaguchi.lg.jp/material/files/group/3/52381572.pdf) |
| 1863293 | JP | Hamakita | PPL / 86502 | 34.8 / 137.78333 | yes | 원본 浜北市는 2005년 浜松市에 합병됐고 옛 浜北区도 2024년 浜名区로 재편됐다. 현재 도시 내부 지명으로 제외한다. Hamamatsu 1863289에 옛 인구86502를 더하거나 ID를 병합하지 않는다. | [hamamatsuMerger](https://www.city.hamamatsu.shizuoka.jp/shiminkyodo/kaigi/chiikikyougikai/ground/index.html), [hamamatsuWards](https://www.city.hamamatsu.shizuoka.jp/kikaku/kuseido/index.html) |
| 1882056 | KR | Sinhyeon | PPL / 82560 | 34.8825 / 128.62667 | yes | 거제시 옛 신현읍은 2008-07-01 폐지되고 장평·고현·상문·수양동으로 분동됐다. 이번 현대 정착지 범위에서 별도 읍/도시 후보로 유지하지 않는다. 다른 거제 ID와 자동 병합하거나 신현 인구82560을 현대 거제시 인구로 사용하지 않는다. | [geojeHistory](https://tour.geoje.go.kr/index.geoje?menuCd=DOM_000008905001000000) |
| 1896953 | KR | Pubal | PPL / 63026 | 37.29167 / 127.50778 | yes | 이천시 부발읍으로 인구 기준을 통과해도 읍급 제외. | [bubal](https://www.icheon.go.kr/csc/contents.do?mid=0102010200) |
| 1897118 | KR | Hwado | PPL / 106358 | 37.6525 / 127.3075 | yes | 남양주시 화도읍. 인구 10만 이상이어도 읍급이므로 자동표시 심사 대상으로 남기지 않는다. | [namyangju](https://www.nyj.go.kr/www/contents.do?key=2866) |
| 1912205 | KR | Ungsang | PPL / 83360 | 35.40611 / 129.16861 | yes | 양산시 옛 웅상읍에 대응하며 현재는 웅상출장소의 서창·소주·평산·덕계 4개 동 지역이다. 이번 범위의 별도 시·군 중심으로 승격하지 않고 제외한다. 웅상이라는 지역명 자체가 사라졌다는 판단은 아니다. | [ungsangHistory](https://yangsan.go.kr/ungsang/contents.do?mid=0202000000), [ungsangDongs](https://www.yangsan.go.kr/ungsang/contents.do?mid=0106000000) |
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
| 1841775 | KR | Kwangyang | PPL / 89281 | 34.97528 / 127.58917 | yes | 광양읍 쪽 옛 중심 후보와 중동의 시 중심 PPLA2 1884178을 구분해야 한다. 공식 시청/읍사무소 주소는 다르지만 이 ID의 정확한 읍 경계 포함과 인구89281의 의미는 미확정이다. 동일 도시 이름이라는 이유로 병합하거나 현재 시 중심으로 좌표를 옮기지 않고 보류한다. | [gwangyangOffices](https://gwangyang.go.kr/boardDownload.es?bid=0056&list_no=86165&seq=1) |
| 1842754 | KR | Kyosai | PPL / 72124 | 34.85028 / 128.58861 | yes | Koje/Kŏje 별칭을 가지지만 고현동의 현행 시청 중심과 다른 거제면 쪽 지점이다. 현대 거제시 전체와 면 내부 정착지 중 어느 의미인지 경계·인구 검증 전 확정하지 않는다. Geoje 11101805나 옛 신현에 이름·인구를 이식하지 않고 보류한다. | [geojeDistricts](https://www.geoje.go.kr/stat/index.geoje?menuCd=DOM_000008905001007000), [geojeCity](https://www.geoje.go.kr/index.do), [geojeMap](https://data.geoje.go.kr/index.geoje?menuCd=DOM_000000202003001000) |
| 1865689 | JP | Aihara | PPL / 725493 | 35.6 / 139.31667 | yes | 相原 내부 지역 및 Sagamihara 별칭에 시 규모 인구725493이 붙음. 경계·인구 의미 미확정으로 Sagamihara와 합치지 않고 보류. | [sagamihara](https://www.city.sagamihara.kanagawa.jp/midoriku/hashimoto/index.html) |
| 6395804 | KR | Sinan | PPL / 53150 | 34.8262 / 126.10863 | yes | 압해읍의 현재 군 중심 PPLA2 11725780과 다른 섬 쪽 좌표에 군 전체 별칭 신안군 및 인구53150이 붙어 있다. 군 행정영역 대표점인지 실제 정착지인지 미확정으로 보류한다. 같은 이름의 두 ID를 병합하거나 인구를 새 중심에 이식하지 않는다. | [sinanOffice](https://eng.shinan.go.kr/), [sinanLocation](https://cn.shinan.go.kr/download/younbo/2016/16_02.pdf) |
| 6573901 | KR | Uiwang | PPL / 63040 | 37.36528 / 126.94778 | yes | 원본 admin2=31160은 Gunpo 1842030과 같고 지점도 군포 후보와 가깝다. 실제 의왕시는 고천동에 시청을 둔 별도 시이므로 단순 중복으로 합치지 않는다. 이름·소속·대표점 불일치 의심을 보류하고 정확한 의왕 정착지 대응을 재검토한다. 인구63040이나 좌표를 추정 수정하지 않는다. | [uiwangOffice](https://www.uiwang.go.kr/UWKORINTRO0302), [uiwangMap](https://www.uiwang.go.kr/UWKORINTRO0103) |
| 8309983 | CN | Fuzhou | PPLA2 / 0 | 26.07711 / 119.29153 | yes | 원본에 福州市와 내부 鼓楼区/Gulou Qu 별칭이 혼재한다. 공식 자료는 鼓楼가 福州 핵심 시구임을 확인하지만 이 ID가 도시의 별도 대표점인지 구 중심인지까지 확정하지 못했다. 보류 이유는 인구0이나 근접 자체가 아닌 정체 혼합이며 1810821과 자동 병합·이름 교체하지 않는다. | [fuzhouGulou](https://www.gl.gov.cn/xjwz/rw/), [fuzhouFujian](https://www.fuzhou.gov.cn/zgfzzt/shbj/xxgk/spgs/202510/P020251024565187323512.pdf) |
| 11101805 | KR | Geoje | PPL / 232921 | 34.81379 / 128.70556 | yes | 고현동의 현재 시 중심에서 떨어진 남동부 좌표에 시 규모 인구232921이 붙어 있다. 이 ID가 실제 정착지 중심을 나타내는지 행정영역 대표점인지 미확정이다. 이름 Geoje만으로 정상 대표점으로 확정하거나 Kyosai/Sinhyeon과 합치지 않고 보류한다. | [geojeCity](https://www.geoje.go.kr/index.do), [geojeDistricts](https://www.geoje.go.kr/stat/index.geoje?menuCd=DOM_000008905001007000), [geojeMap](https://data.geoje.go.kr/index.geoje?menuCd=DOM_000000202003001000) |
| 11209896 | JP | Kotō | PPL / 543730 | 32.77856 / 130.74537 | yes | 원본 admin1=21/admin2=1858418과 좌표는 구마모토 쪽인데 江東区/Koto City/湖東 별칭과 인구543730이 혼재. 도쿄 특별구로 단정했던 이전 감사 설명을 정정하고 보류. | [koto](https://www.city.koto.lg.jp/kuse/profile/ichi/index.html) |
| 13439582 | KR | Yeosu | PPLA2 / 0 | 34.71932 / 127.74849 | yes | 학동 시청 쪽 기존 여수 PPLA2 1884138과 달리 남동쪽에 있는 최근 추가 지점이다. 이 지점의 행정중심/정착지 의미를 확인하지 못했으므로 보류한다. 인구0이나 같은 이름 자체는 제외 근거로 쓰지 않으며 다른 ID에 좌표·인구를 합치지 않는다. | [yeosuOffice](https://news.yeosu.go.kr/com/com-2.html) |

### inclusion-review

| ID | 국가 | 원명 | 코드 / 인구 | 좌표 lat / lon | 1차 포함 | 판단 | 근거 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1265014 | IN | Latur | PPLA3 / 382940 | 18.39721 / 76.56784 | no | district 중심 도시지만 PPLA3라 제외. 행정중심 정착지 예외 후보이며 이번 정제본에는 추가하지 않는다. | [latur](https://latur.gov.in/en/administrative-setup/) |
| 1273241 | IN | Deoghar | PPLA3 / 203123 | 24.48983 / 86.69902 | no | district의 주요 도시임을 확인. PPLA3 소수 예외 검토만 기록하며 자동 추가하지 않는다. | [deoghar](https://deoghar.nic.in/history/) |
| 1791388 | CN | Wenzhou | PPLA3 / 2650000 | 27.99942 / 120.66682 | no | 温州市 중심의 누락 후보. 큰 인구의 행정구역/시가지 범위는 미검증이므로 최종 순위 없이 소수 예외 검토만 기록. | [wenzhou](https://wztjj.wenzhou.gov.cn/attach/0/d077e71612ed4b42b271c1ac499e41de.pdf) |
| 1793505 | CN | Taizhou | PPLA3 / 1607108 | 32.49069 / 119.90812 | no | 江苏 泰州市는 공식 지급시이며 浙江 台州市 8400694와 다른 도시이다. PPLA3로 분류돼 1차 필터 밖인 중요한 지역 중심의 개별 예외 검토에 기록한다. 중국 PPLA3 전체의 승격이나 featureCode 변경 없이 원본1607108의 인구 범위도 후속 검토로 남긴다. | [taizhouJiangsu](https://www.taizhou.gov.cn/cms_files/filemanager/288403819/attach/20237/ce0cdc2d266148068c4506c69ea8d853.pdf), [taizhouZhejiang](https://sthjj.zjtz.gov.cn/module/download/downfile.jsp?classid=0&filename=bae0e738847c4aeeb4a2eccd97e8996f.pdf) |
| 1832909 | KR | Yanggu | PPL / 24027 | 38.10583 / 127.98944 | no | 군청이 소재한 양구 중심 정착지 후보는 원본 PPL 인구24027로 제외된다. 내부 읍 전체를 복구하는 대신 군 중심의 소수 예외 검토로 남긴다. 동일 로마자의 중국 지명과 병합하지 않는다. | [yangguOffice](https://www.yanggu.go.kr/contract/notice/phoneNumberView.do) |
| 1835515 | KR | T’aebaek | PPL / 48962 | 37.1759 / 128.9889 | no | 태백은 현행 시이지만 원본 PPL 인구48962가 5만 기준에 미달해 빠진다. 시 중심 정착지의 소수 예외 검토로 남기고 인구를 5만으로 올리거나 전체 저인구 PPL을 복구하지 않는다. | [taebaek](https://www.taebaek.go.kr/www/index.do) |
| 1838069 | KR | Santyoku | PPL / 42145 | 37.44056 / 129.17083 | no | Samcheok/삼척 별칭의 현대 시 중심 후보지만 원본 PPL 인구42145가 기준 미달이다. 오래된 표제어 교정과 소수 포함 예외를 검토하며 이번 정제본에는 추가하지 않는다. | [samcheok](https://state.gwd.go.kr/upload/report/kw_nws_data/kw_mgr_5167_20260205150529.pdf) |
| 1843137 | KR | Gangneung | PPLA3 / 208161 | 37.75266 / 128.87239 | no | 강릉시 중심의 중요한 누락. 원래 PPLA3 제외는 유지하고 소수 ID 예외 승인을 위한 검토 대상으로만 기록. | [gangneung](https://www.gn.go.kr/) |
| 5221659 | US | Cranston | PPLA3 / 81073 | 41.77982 / -71.43728 | no | Providence 대도시권 안에 있어도 독립 시이다. 위성/근접성만으로 미세 지명으로 취급하지 않고 PPLA3 예외 검토. | [cranston](https://cranstonri.gov/government/default.aspx) |
| 5756758 | US | Tigard | PPLA3 / 51253 | 45.43123 / -122.77149 | no | Oregon의 incorporated city. PPLA3 소수 예외 검토 대상이며 인구50k+만으로 모든 PPLA3을 복구하지 않는다. | [tigard](https://sos.oregon.gov/blue-book/government/pages/tigard.aspx) |
| 5983607 | CA | Inuvik | PPL / 3243 | 68.36166 / -133.72817 | no | 인구3243이지만 Western Arctic 행정중심. 저밀도 지역 대표 정착지 예외 검토 대상으로 남기고 자동 추가/순위 결정하지 않는다. | [inuvik](https://www.inuvik.ca/en/town-hall/resources/PRINTABLE-LISTS/Community-Plan---First-Reading-Dec-4_Optimized.pdf) |

### retain

| ID | 국가 | 원명 | 코드 / 인구 | 좌표 lat / lon | 1차 포함 | 판단 | 근거 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1785286 | CN | Zibo | PPL / 4704138 | 36.79056 / 118.06333 | yes | 淄博 후보 정체는 유지한다. 원본 인구4704138은 2020년 공식 전체 지급시 인구와 정확히 일치하며 단일 시가지 인구로 검증된 값이 아니다. 원본 인구를 임의로 교체하거나 도시 자체를 제외하지 않으며 최종 규모·rank 검토에서 이 공간 범위를 구분해야 한다. | [shandongCensus](https://tjj.shandong.gov.cn/art/2021/5/21/art_6293_10287511.html) |
| 1786746 | CN | Yichun | PPLA2 / 1045952 | 27.83333 / 114.4 | yes | 江西 宜春市 후보를 유지한다. 黑龙江 伊春 2033413과 로마자 Yichun만 같고 한자·소속·위치·ID가 다르다. 두 도시를 병합하거나 인구를 합산하지 않으며 이 정체 확인으로 원본 인구의 공간 범위까지 승인하지 않는다. | [yichunJiangxi](https://www.weather.com.cn/cityintro/101240501.shtml), [yichunHeilongjiang](https://yc.gov.cn/ycsrmzf/c101991/202001/166166.shtml) |
| 1791681 | CN | Weifang | PPL / 9386705 | 36.71 / 119.10194 | yes | 潍坊 후보 정체는 유지한다. 원본 인구9386705는 2020년 공식 전체 지급시 인구와 정확히 일치한다. 이를 단일 시가지 938만 도시로 확정하거나 인구를 추정 보정하지 않는다. 후보 유지와 최종 표시 순위 확정은 다르며 인구 범위 검토를 남긴다. | [shandongCensus](https://tjj.shandong.gov.cn/art/2021/5/21/art_6293_10287511.html) |
| 1793743 | CN | Suzhou | PPLA2 / 1647642 | 33.63611 / 116.97889 | yes | 安徽 宿州市 후보이다. 江苏 苏州市 1886760과 로마자 Suzhou가 같지만 한자·성·소속·좌표가 다르므로 각각 유지한다. 공식 시 개황은 정체 대조 근거이며 두 원본 인구의 통계 범위를 같다고 간주하지 않는다. | [suzhouAnhui](https://www.ahsz.gov.cn/zjsz/zrdl/index.html), [suzhouJiangsu](https://dfzb.suzhou.gov.cn/dfzb/zrdl/202512/36710e4435f34479acc6bc89f950b4a0.shtml) |
| 1810820 | CN | Fuzhou | PPLA2 / 1089888 | 27.95999 / 116.33333 | yes | 江西 抚州市의 후보를 유지한다. 福建 福州市 1810821과 로마자 Fuzhou만 같고 한자·성·소속·위치가 다르다. 공식 시 전체 인구나 다른 Fuzhou의 인구를 이식하지 않으며 원본1089888의 범위 검토는 별도로 남긴다. | [fuzhouJiangxi](https://www.jxfz.gov.cn/col/col2/index.html), [fuzhouFujian](https://www.fuzhou.gov.cn/zgfzzt/shbj/xxgk/spgs/202510/P020251024565187323512.pdf) |
| 1810821 | CN | Fuzhou | PPLA / 4094491 | 26.06139 / 119.30611 | yes | 福建 성도 福州市의 PPLA 후보를 유지한다. 江西 抚州 1810820과 병합하지 않는다. 인근 PPLA2 8309983을 보류하는 것과 성도 자체를 제외하는 것은 다르며 원본4094491의 인구 범위·최종 표시 순위는 확정하지 않는다. | [fuzhouFujian](https://www.fuzhou.gov.cn/zgfzzt/shbj/xxgk/spgs/202510/P020251024565187323512.pdf), [fuzhouJiangxi](https://www.jxfz.gov.cn/col/col2/index.html) |
| 1832617 | KR | Eisen | PPL / 56006 | 35.9675 / 128.93083 | yes | Yongch'on/Yŏngch’ŏn 별칭·경북 소속·지점은 현대 영천과 대응한다. 옛 표제어만으로 폐지 정착지로 제외하지 않는다. 현대 대표명 영천/Yeongcheon은 다음 이름 정규화 단계의 검토 사항이며 원본 Eisen과 인구56006은 변경하지 않는다. | [yeongcheon](https://www.yc.go.kr/nongtech/contents.do?mId=0102000000) |
| 1840379 | KR | Nangen | PPL / 81257 | 35.41 / 127.38583 | yes | Namwon/Namwŏn 별칭·전북 소속·지점은 현대 남원과 대응한다. 낡은 표제어 Nangen만으로 삭제하지 않으며 남원/Namwon 대표명 검토와 원본 인구81257의 범위 검증을 별도로 남긴다. | [namwon](https://www.namwon.go.kr/index.do?menuUid=ff8080818e3beff0018e40e1d1300288) |
| 1853677 | JP | Ōta | PPLA2 / 224358 | 36.3 / 139.36667 | yes | 군마현 太田市. 도쿄 大田区(8469289)와 동명이지만 별도 ID로 유지. | [otaGunma](https://www.city.ota.gunma.jp/) |
| 1856698 | JP | Miyoshi | PPLA2 / 53616 | 34.8 / 132.85 | yes | 広島県 三次市의 현행 도시 후보이다. 愛知県 みよし市 11612340과 로마자 이름이 같아도 한자·소속·좌표·ID가 다르므로 각각 유지한다. 원본 인구53616을 현재 홈페이지 인구로 바꾸지 않는다. | [miyoshiHiroshima](https://www.city.miyoshi.hiroshima.jp/index.html), [miyoshiAichi](https://www.city.aichi-miyoshi.lg.jp/index.html) |
| 1859730 | JP | Kawaguchi | PPLA2 / 607373 | 35.80521 / 139.71072 | yes | 합병 후 현행 川口市의 도시 중심 PPLA2는 유지한다. 합병 전 鳩ヶ谷本町를 제외하는 것과 현재 시를 제외하는 것은 다르며 원본 인구607373은 변경하지 않는다. | [hatogayaMerger](https://www.city.kawaguchi.lg.jp/material/files/group/3/52381572.pdf) |
| 1863289 | JP | Hamamatsu | PPLA2 / 791707 | 34.7 / 137.73333 | yes | 현행 浜松市의 도시 중심 PPLA2는 유지한다. 내부 浜北 기록 제외와 구 재편을 시 자체의 폐지로 오인하지 않는다. 원본 인구791707에 옛 지역 인구를 합산하지 않는다. | [hamamatsuMerger](https://www.city.hamamatsu.shizuoka.jp/shiminkyodo/kaigi/chiikikyougikai/ground/index.html), [hamamatsuWards](https://www.city.hamamatsu.shizuoka.jp/kikaku/kuseido/index.html) |
| 1884138 | KR | Yeosu | PPLA2 / 268823 | 34.76062 / 127.66215 | yes | 학동 시청 쪽의 현행 여수시 중심 후보는 유지한다. 별도 PPLA2 13439582와 동일 이름이라는 이유로 ID를 합치거나 원본 인구268823을 두 기록에 나눠 적용하지 않는다. | [yeosuOffice](https://news.yeosu.go.kr/com/com-2.html) |
| 1884178 | KR | Gwangyang | PPLA2 / 154266 | 34.9414 / 127.69569 | yes | 중동 시청 쪽의 현행 광양시 중심 PPLA2를 유지한다. 다른 Kwangyang 1841775의 옛 중심/읍 의미와 별도로 판단하며, 시와 시가지 인구 범위가 모두 검증된 것은 아니다. | [gwangyangOffices](https://gwangyang.go.kr/boardDownload.es?bid=0056&list_no=86165&seq=1) |
| 1886760 | CN | Suzhou | PPLA2 / 6715559 | 31.30408 / 120.59538 | yes | 江苏 苏州市 후보를 安徽 宿州 1793743과 별도로 유지한다. 공식 자료도 전체 시역·시구·건성구를 구분하므로 원본6715559를 어떤 공간 범위의 인구인지 확정하지 않은 채 최종 rank에 사용하지 않는다. 이름·인구·좌표는 보존한다. | [suzhouJiangsu](https://dfzb.suzhou.gov.cn/dfzb/zrdl/202512/36710e4435f34479acc6bc89f950b4a0.shtml), [suzhouAnhui](https://www.ahsz.gov.cn/zjsz/zrdl/index.html) |
| 2033413 | CN | Yichun | PPL / 155762 | 47.72143 / 128.87529 | yes | 黑龙江 伊春市 후보를 유지한다. 江西 宜春 1786746과 다른 도시이며 동일 로마자로 중복 삭제하지 않는다. 원본 PPL 인구155762를 전체 시역의 최신 인구로 교체하거나 다른 Yichun에서 가져오지 않는다. | [yichunHeilongjiang](https://yc.gov.cn/ycsrmzf/c101991/202001/166166.shtml), [yichunJiangxi](https://www.weather.com.cn/cityintro/101240501.shtml) |
| 2737038 | PT | Oliveira do Hospital | PPLA2 / 4704 | 40.3618 / -7.86014 | yes | 정상 지방자치 중심. Hospital 키워드 오탐이며 저인구 행정중심 검색 후보 유지. | [oliveira](https://portalautarquico.dgal.gov.pt/pt-PT/entidades-locais/concelhos/oliveira-do-hospital/) |
| 4682464 | US | College Station | PPL / 107889 | 30.62798 / -96.33441 | yes | 정상 시 이름. station 키워드만으로 역/시설 POI로 제외하지 않는다. 원본 인구를 최신 인구로 교체하지 않음. | [college](https://www.cstx.gov/) |
| 6903078 | KR | Changnyeong | PPL / 74668 | 35.54145 / 128.49506 | yes | 공식 안내도에서 군청이 놓인 창녕 중심 정착지와 읍사무소를 구분한다. 창녕읍 별칭만으로 군 중심까지 키워드 삭제하지 않는다. 원본 인구74668은 현재 시가지 인구로 확정하지 않고 그대로 남긴다. | [changnyeongMap](https://www.cng.go.kr/_res/tour/data/02260_d1.pdf) |
| 6940394 | JP | Saitama | PPLA / 1324854 | 35.90807 / 139.65657 | yes | 합병 후 현행 さいたま市 후보를 유지한다. 내부 与野와 근접하거나 예전 인구가 겹친다고 ID를 병합하거나 인구1324854를 재계산하지 않는다. | [saitamaMerger](https://www.city.saitama.lg.jp/20th/gaiyou/p081036.html) |
| 8400694 | CN | Taizhou | PPLA2 / 1485502 | 28.66266 / 121.43312 | yes | 浙江 台州市의 도시 후보를 유지한다. 江苏 泰州市 1793505와 로마자만 같으며 두 도시의 한자·성·좌표·ID가 다르다. 江苏 후보를 검토한다고 이 ID의 인구·이름을 변경하거나 두 ID를 합치지 않는다. | [taizhouZhejiang](https://sthjj.zjtz.gov.cn/module/download/downfile.jsp?classid=0&filename=bae0e738847c4aeeb4a2eccd97e8996f.pdf), [taizhouJiangsu](https://www.taizhou.gov.cn/cms_files/filemanager/288403819/attach/20237/ce0cdc2d266148068c4506c69ea8d853.pdf) |
| 9181182 | CN | Puyang | PPLA2 / 655674 | 35.75641 / 115.04363 | yes | 河南 濮阳市의 현재 기준 후보는 이미 포함되어 있다. 浙江 Puyang(1798425)의 인구나 이름을 가져오지 않는다. | [puyangHenan](https://pyxinqu.puyang.gov.cn/) |
| 11611609 | JP | Sagamihara | PPLA2 / 720780 | 35.56707 / 139.24167 | yes | 相模原市의 시 중심 후보 유지. Aihara와 인구나 별칭이 유사하다고 ID를 합치지 않는다. | [sagamihara](https://www.city.sagamihara.kanagawa.jp/midoriku/hashimoto/index.html) |
| 11612340 | JP | Miyoshi | PPLA2 / 61952 | 35.08971 / 137.08998 | yes | 愛知県 みよし市의 현행 도시 후보이다. 広島県 三次市 1856698과 동명이지만 다른 정착지로 유지한다. 현대 시청 주소의 三好町 문자열만 보고 내부 町 지명으로 제외하지 않으며 원본 인구61952는 보존한다. | [miyoshiAichi](https://www.city.aichi-miyoshi.lg.jp/index.html), [miyoshiHiroshima](https://www.city.miyoshi.hiroshima.jp/index.html) |
| 11725780 | KR | Sinan | PPLA2 / 0 | 34.83394 / 126.35133 | yes | 압해읍의 현행 군 중심 PPLA2를 인구0이라는 이유로 제외하지 않는다. 다른 섬 쪽 PPL 6395804와 별도 ID로 유지하고 그 인구53150을 복사하지 않는다. | [sinanOffice](https://eng.shinan.go.kr/), [sinanLocation](https://cn.shinan.go.kr/download/younbo/2016/16_02.pdf) |
| 12256566 | CN | Yulin | PPLA2 / 0 | 22.65541 / 110.17819 | yes | 广西 玉林市의 PPLA2 후보는 인구0이어도 유지한다. 인근 PPLA3 1785781의 인구1056743을 자동 이식·병합하거나 동명 榆林镇/鱼鳞乡/育林乡까지 같은 도시로 취급하지 않는다. 이 판단은 다른 Yulin ID의 포함 승인이나 정확한 대표점 확정이 아니다. | [yulinGuangxi](https://dnr.gxzf.gov.cn/zfxxgk/fdzdgknr/ghjh/ghjh/t16051983.shtml), [yulinCurrent](https://www.yulin.gov.cn/dhjl/xwfbh_30372/t19011858.shtml) |

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
| [yeongcheon](https://www.yc.go.kr/nongtech/contents.do?mId=0102000000) | 2026-10-03 | official-search-index; full page fetch returned 404 | 영천시의 위치·행정구역·경위도 극점을 안내한다. GeoNames Eisen의 Yongch'on 별칭·경북 소속과 대조하되 최신 인구를 이식하지 않는다. |
| [namwon](https://www.namwon.go.kr/index.do?menuUid=ff8080818e3beff0018e40e1d1300288) | 2026-10-03 | official-page | 남원시 기본현황의 위치와 경위도 범위를 확인했다. GeoNames Nangen의 Namwon 별칭·전북 소속과 대조하며 현재 시가지 인구가 검증됐다는 뜻은 아니다. |
| [geojeHistory](https://tour.geoje.go.kr/index.geoje?menuCd=DOM_000008905001000000) | 2026-10-03 | official-search-index; main-host full page fetch timed out | 2008-07-01 신현읍을 폐지하고 장평·고현·상문·수양동으로 분동한 연혁을 안내한다. |
| [geojeDistricts](https://www.geoje.go.kr/stat/index.geoje?menuCd=DOM_000008905001007000) | 2026-10-03 | official-search-index | 현재 행정구역 목록에서 거제면과 일운면, 고현동 등을 별도 단위로 구분한다. Kyosai·Geoje 원본 지점과 각 경계의 포함 판정은 수행하지 않았다. |
| [geojeCity](https://www.geoje.go.kr/index.do) | 2026-10-03 | official-search-index | 거제시청을 계룡로 125 고현동으로 안내한다. GeoNames의 복수 거제 레코드를 동일 중심점으로 확정하거나 좌표를 임의로 옮기지 않는다. |
| [ungsangHistory](https://yangsan.go.kr/ungsang/contents.do?mid=0202000000) | 2026-10-03 | official-search-index; full page fetch timed out | 옛 웅상읍과 2007년 4월 웅상출장소 설치의 연혁을 구분한다. |
| [ungsangDongs](https://www.yangsan.go.kr/ungsang/contents.do?mid=0106000000) | 2026-10-03 | official-page | 현재 출장소 관할의 서창·소주·평산·덕계 4개 동 행정복지센터를 명시한다. |
| [gwangyangOffices](https://gwangyang.go.kr/boardDownload.es?bid=0056&list_no=86165&seq=1) | 2026-10-03 | official-indexed-document; full document fetch failed | 시청로 33 중동의 광양시청과 남등길 6의 광양읍사무소를 구분한다. 두 GeoNames 레코드의 인구 범위와 정확한 읍 경계 포함 여부까지 확정하지는 않는다. |
| [yeosuOffice](https://news.yeosu.go.kr/com/com-2.html) | 2026-10-03 | official-search-index; full page fetch failed | 여수시청의 소재지를 시청로 1 학동으로 안내한다. 별도 PPLA2 13439582의 대표점 의미는 확인하지 못했다. |
| [sinanOffice](https://eng.shinan.go.kr/) | 2026-10-03 | official-search-index; full page fetch returned 502 | 군청 주소는 압해읍 천사로 1004이다. 인구 0인 행정중심을 자동 삭제하지 않으며, 다른 섬 쪽 PPL의 군 전체 인구·대표점 여부는 미확정이다. |
| [sinanLocation](https://cn.shinan.go.kr/download/younbo/2016/16_02.pdf) | 2026-10-03 | official-indexed-document | 군청 소재지를 압해읍 천사로 1004로 제시하고 군이 여러 섬의 행정구역임을 설명한다. 2016년 연보의 인구를 현재 인구로 취급하지 않는다. |
| [uiwangOffice](https://www.uiwang.go.kr/UWKORINTRO0302) | 2026-10-03 | official-search-index; full page fetch timed out | 의왕시청은 시청로 11 고천동이며 군포와 별도 시이다. 군포와 동일 admin2 및 근접 좌표를 가진 GeoNames Uiwang의 정체를 이 페이지만으로 교정하지 않는다. |
| [changnyeongMap](https://www.cng.go.kr/_res/tour/data/02260_d1.pdf) | 2026-10-03 | official-indexed-document | 창녕읍 시가지의 군청길 1 군청과 읍사무소를 구분하는 공식 도로명주소 안내도이다. 읍 별칭만으로 군 중심 정착지를 삭제하지 않는다. |
| [taebaek](https://www.taebaek.go.kr/www/index.do) | 2026-10-03 | official-search-index | 태백시는 황지동 태붐로 21에 시청을 둔 현행 시이다. GeoNames PPL 인구 48962가 후보 기준에 미달하는 것과 정착지 존재 여부는 다르다. |
| [samcheok](https://state.gwd.go.kr/upload/report/kw_nws_data/kw_mgr_5167_20260205150529.pdf) | 2026-10-03 | official-indexed-document; city homepage blocked by WAF | 2026년 도보는 삼척시청 홈페이지와 중앙로 296 주소를 명시한다. GeoNames Santyoku의 Samcheok 별칭과 대조하며 최신 인구를 추정하지 않는다. |
| [yangguOffice](https://www.yanggu.go.kr/contract/notice/phoneNumberView.do) | 2026-10-03 | official-page | 양구군청의 부서와 양구읍 관공서로 38 주소를 확인했다. 내부 읍 전체의 일괄 복구가 아니라 군 중심 정착지의 소수 예외 검토 근거이다. |
| [hatogayaMerger](https://www.city.kawaguchi.lg.jp/material/files/group/3/52381572.pdf) | 2026-10-03 | official-document | 2011-10-11 川口市와의 합병 및 鳩ヶ谷市本町에서 川口市鳩ヶ谷本町로의 주소 대응을 명시한다. |
| [saitamaMerger](https://www.city.saitama.lg.jp/20th/gaiyou/p081036.html) | 2026-10-03 | official-page | 2001년 浦和·大宮·与野 합병으로 さいたま市가 성립하고 2003년 옛 与野시역에 中央区를 둔 사실을 명시한다. |
| [hamamatsuMerger](https://www.city.hamamatsu.shizuoka.jp/shiminkyodo/kaigi/chiikikyougikai/ground/index.html) | 2026-10-03 | official-page | 2005-07-01 浜北市 등 12시정촌 합병으로 새 浜松市가 성립한 사실을 명시한다. |
| [hamamatsuWards](https://www.city.hamamatsu.shizuoka.jp/kikaku/kuseido/index.html) | 2026-10-03 | official-page | 2024년 구 재편으로 옛 浜北区는 浜名区에 속한다. 폐지된 구 이름을 현재 독립 도시로 승격하지 않는다. |
| [miyoshiHiroshima](https://www.city.miyoshi.hiroshima.jp/index.html) | 2026-10-03 | official-page | 広島県三次市의 현행 시청과 소재지를 확인했다. 愛知県みよし市와 같은 로마자 Miyoshi지만 별도 시이다. |
| [miyoshiAichi](https://www.city.aichi-miyoshi.lg.jp/index.html) | 2026-10-03 | official-page | 愛知県みよし市三好町의 현행 시청을 확인했다. 広島県三次市의 이름·인구와 병합하지 않는다. |
| [uiwangMap](https://www.uiwang.go.kr/UWKORINTRO0103) | 2026-10-03 | official-page | 현행 행정구역도에서 고천·오전·부곡·내손1·내손2·청계동과 고천동의 시청을 확인했다. 설명용 지도는 GeoNames 6573901 좌표의 경계 포함이나 대표점 의미를 확정하는 지오메트리 자료는 아니다. |
| [geojeMap](https://data.geoje.go.kr/index.geoje?menuCd=DOM_000000202003001000) | 2026-10-03 | official-page | 통계지도에서 거제면·일운면·고현동 등을 별도 행정단위로 확인했다. 이번 확인은 화면의 행정단위 대조이며 두 GeoNames 좌표의 point-in-polygon 또는 인구 범위 검증이 아니다. |
| [suzhouJiangsu](https://dfzb.suzhou.gov.cn/dfzb/zrdl/202512/36710e4435f34479acc6bc89f950b4a0.shtml) | 2026-10-03 | official-search-index; full page fetch failed | 苏州市를 江苏省 동남부의 장강 삼각주 도시로 설명하고 경위도 범위와 전체 시역·시구·건성구 면적을 구분한다. 安徽 宿州와 동일 로마자 이름이라는 이유로 합치지 않는다. |
| [suzhouAnhui](https://www.ahsz.gov.cn/zjsz/zrdl/index.html) | 2026-10-03 | official-search-index; full page fetch failed | 宿州市는 安徽 최북부의 현행 도시이며 4개 현과 1개 구를 관할한다고 설명한다. 원본의 安徽/3413 및 宿州市 별칭을 江苏 苏州와 구분하는 근거이다. |
| [fuzhouFujian](https://www.fuzhou.gov.cn/zgfzzt/shbj/xxgk/spgs/202510/P020251024565187323512.pdf) | 2026-10-03 | official-indexed-document | 환경 현황의 지리 절에서 福州市를 福建省 성도, 민강 하류의 도시로 설명하고 경위도 범위를 제시한다. 이 자료로 GeoNames의 인구4094491까지 검증하거나 江西 抚州와 병합하지 않는다. |
| [fuzhouJiangxi](https://www.jxfz.gov.cn/col/col2/index.html) | 2026-10-03 | official-search-index; full page fetch failed | 抚州市가 江西 동부에 위치하며 临川·东乡 두 구와 9개 현 등을 관할한다고 설명한다. 福建의 福州와 다른 도시이며 전체 행정영역 인구를 단일 시가지 인구로 사용하지 않는다. |
| [fuzhouGulou](https://www.gl.gov.cn/xjwz/rw/) | 2026-10-03 | official-page | 鼓楼区는 福州의 핵심 시구이며 9개 가도와 1개 진으로 구성됨을 설명한다. Fuzhou 8309983의 福州市/鼓楼区 혼합 별칭을 도시와 내부 구 중 하나로 확정하지 못하므로 보류 근거로 사용한다. |
| [yichunJiangxi](https://www.weather.com.cn/cityintro/101240501.shtml) | 2026-10-03 | official-page | 宜春市를 江西 서북부 도시로 소개하고 경위도 범위를 제시한다. 黑龙江 伊春와 다른 한자·소속·위치를 가진 도시임을 대조하는 근거이며 인구1045952의 공간 범위를 검증한 자료는 아니다. |
| [yichunHeilongjiang](https://yc.gov.cn/ycsrmzf/c101991/202001/166166.shtml) | 2026-10-03 | official-page | 伊春市는 黑龙江 동북부이며 북위46°28′~49°26′, 동경127°37′~130°46′ 범위를 가진다고 설명한다. 江西 宜春와 별개이며 동일 로마자 ID의 병합 근거가 아니다. |
| [taizhouJiangsu](https://www.taizhou.gov.cn/cms_files/filemanager/288403819/attach/20237/ce0cdc2d266148068c4506c69ea8d853.pdf) | 2026-10-03 | official-document | 2022-2025 무폐기물 도시 실시계획의 도시 개황에서 泰州를 江苏의 지급시로 설명하고 경위도 범위를 제시한다. 원본 PPLA3 때문에 필터 밖인 ID의 개별 검토 근거이며 코드 자동 변경이나 승격 근거로 사용하지 않는다. |
| [taizhouZhejiang](https://sthjj.zjtz.gov.cn/module/download/downfile.jsp?classid=0&filename=bae0e738847c4aeeb4a2eccd97e8996f.pdf) | 2026-10-03 | official-indexed-document | 환경 현황 절에서 台州市를 浙江 중부 연해 도시로 설명하고 시정부가 있는 椒江区와 그 경위도 범위를 제시한다. 江苏 泰州市와 별개인 台州 후보 정체 대조에만 사용한다. |
| [yulinGuangxi](https://dnr.gxzf.gov.cn/zfxxgk/fdzdgknr/ghjh/ghjh/t16051983.shtml) | 2026-10-03 | official-search-index; full page fetch timed out | 玉林市 광물자원 계획은 广西 동남부 위치와 경위도 범위를 설명한다. 오래된 계획의 지리 설명만 대조하며 당시 인구를 현재 수치로 사용하지 않는다. |
| [yulinCurrent](https://www.yulin.gov.cn/dhjl/xwfbh_30372/t19011858.shtml) | 2026-10-03 | official-search-index | 2024년 공식 기자회견에서 玉林을 현행 지급시로 확인한다. PPLA2 인구0을 부재로 오인하지 않으며 인근 PPLA3의 인구를 이식하지 않는다. |
| [binhaiMerger](https://www.tj.gov.cn/zwgk/szfwj/tjsrmzf/202005/t20200519_2365317.html) | 2026-10-03 | official-page | 2009-10-21 승인으로 塘沽区·汉沽区·大港区를 폐지하고 天津市 滨海新区를 설치했다. 내부 옛 구의 별도 후보 제외에 사용하며 지역 이름이나 시가지 자체가 사라졌다는 뜻은 아니다. |
| [daxingDistrict](https://www.bjdx.gov.cn/bjsdxqrmzf/zjdx/dxgk/index.html) | 2026-10-03 | official-page | 大兴区는 北京 남부의 내부 구이며 黄村 등의 진과 清源·兴丰 등의 가도를 관할한다. 원본 大兴/Huangcun 별칭·北京 소속에 대응한 내부 지명 제외 근거이다. |
| [shandongCensus](https://tjj.shandong.gov.cn/art/2021/5/21/art_6293_10287511.html) | 2026-10-03 | official-search-index; full page fetch timed out | 2020년 16개 지급시 지역 인구 표에 淄博4704138·潍坊9386705가 기재돼 있다. 두 GeoNames PPL의 숫자가 전체 지급시 인구와 일치함을 확인하지만 원 출처의 계보나 도시 시가지 인구까지 검증하지는 않는다. |

정제 파일: `.cache/refined-candidates.ndjson`, SHA-256 `fbf18f8680161d91755d5caeca2e6d7ee99db43c60f7a6a704b16cbf8b1191b5`.

<!-- geonames-statistics:end -->
