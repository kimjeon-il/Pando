# 현대 정착지 후보 정제: ID별 근거 검토

최초 검토일: 2026-10-03; 지역별 후속 검토일: 2026-10-04. 원본은 공식 GeoNames 2026-10-01 스냅샷이다.
기준 cities500 스냅샷을 교체하지 않으며 지도 데이터·Worker·UI·배포 manifest를 변경하지 않는다.

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

### 유럽 5개 권역의 확정 제외 최초 적용

2026-10-04에 기존 `review` 명령으로 정제 후보 풀을 다시 생성하고,
5개 권역의 `exclude` 158개 ID가 `.cache/refined-candidates.ndjson`에 모두 없는지 확인했다.
아래 보류 재검증 전의 최초 적용 결과이며, 추가 제외는 다음 절에 반영했다.

| 권역 | 확정 제외 | 정제본에 남은 제외 ID |
| --- | ---: | ---: |
| 서유럽 | 33 | 0 |
| 중앙유럽 | 19 | 0 |
| 남유럽 | 38 | 0 |
| 동유럽 | 60 | 0 |
| 북유럽 | 8 | 0 |
| 합계 | 158 | 0 |

기존 보류 판단과 제외 근거는 보존했다. 원본 및 나머지 후보의 속성·ID도 변경하지 않았다.
이 적용 대상은 정제 후보 풀이며 지도 표시용 데이터 생성·연결은 후속 작업이다.

### 유럽 보류 190건 1차 재검증 (2026-10-04)

5개 권역의 기존 `hold` **190건 전부**를 원래 ID·속성·기존 쟁점에 맞춰 다시 검증했다. 그중 **유지 49건, 추가 제외 4건, 보류 유지 137건**이다.

| 권역 | 재검증 대상 | 유지로 변경 | 제외로 변경 | 보류 유지 |
| --- | ---: | ---: | ---: | ---: |
| 서유럽 | 20 | 8 | 4 | 8 |
| 중앙유럽 | 4 | 2 | 0 | 2 |
| 남유럽 | 21 | 7 | 0 | 14 |
| 동유럽 | 69 | 4 | 0 | 65 |
| 북유럽 | 76 | 28 | 0 | 48 |
| 합계 | 190 | 49 | 4 | 137 |

유지 변경은 새 공식 지명등록부의 지점·소속·취락 구별, 지자체의 실제 마을·도시 중심 설명으로 기존 쟁점이 해소된 경우에 한했다.
복수 도시의 사업·통계·행정 영역이 단일 정착지처럼 들어간 기록은 추가 제외했다.
합병이나 통계 시가지 편입 자체, 목록 부재, 인구0, 이름·거리만을 제외/병합 근거로 쓰지 않았다.

보류 유지 항목에도 공식 자료 재대조 결과와 아직 확보하지 못한 연결 근거를 ID별 판단에 기록했다. 루마니아 시가지 폴리곤의 다른 취락 포함,
에스토니아 목표 경계 밖 최단거리(4.3~141.4m), 교구·시설과 단일 취락 구별, 동일 이름의 대표점 문제가 남은 사례를 자동 승인하지 않았다.
아이슬란드 Borgarnes는 2026-03-03 확정 계획등록부와 도시 지도까지 확인했지만 지도만으로 두 GN ID의 역할을 구별하지 못해 보류했다.

기존 확정 제외 158건에 이번 추가 제외 4건을 반영하여 유럽 확정 제외는 **162건**이다.
유지로 바뀐 49건은 원본 속성 그대로 정제 후보 풀로 복귀하고, 추가 제외와 남은 보류는 정제본에서 제거된다.
기존 출처·검토 순서와 대상 밖 모든 판단을 보존했다. 변경 전 입력과 상세 재대조·원문 해시는 ignored
`reports/places/.cache/hold-revalidation-20261004/`에 보존했다. 원문 다운로드와 공식 색인만 확인한 자료는 출처 표에서 구분한다.
인구 범위·현행 행정 역할·rank/minZoom·좌표 정밀화와 지도 런타임 연결은 이번 판정 변경에 포함하지 않는다.

### 유럽 잔여 보류 137건 2차 재검증 (2026-10-04)

1차 재검증 뒤 남은 `hold` **137건 전부**를 다시 조사했다. **유지로 변경 15건, 추가 제외 0건, 보류 유지 122건**이다.

| 권역 | 재검증 대상 | 유지로 변경 | 제외로 변경 | 보류 유지 |
| --- | ---: | ---: | ---: | ---: |
| 서유럽 | 8 | 2 | 0 | 6 |
| 중앙유럽 | 2 | 0 | 0 | 2 |
| 남유럽 | 14 | 3 | 0 | 11 |
| 동유럽 | 65 | 4 | 0 | 61 |
| 북유럽 | 48 | 6 | 0 | 42 |
| 합계 | 137 | 15 | 0 | 122 |

국가 지명등록부의 취락 유형·등록점·상위 구군, 정착지 도형, 공식 외부 ID 연결을 원본과 대조했다.
공식 지명점이 가까워도 다른 취락·역·시설의 점일 가능성이 남거나 원점이 다른 시가지에 있으면 자동 승인하지 않았다.
등록부·공식 사이트 접근 실패와 목록 부재를 제외 근거로 사용하지 않았다.

Borgarnes는 국가 IS 50V의 지명 영역과 별도 실제 시가지 도형을 확보하여 두 원본 점이 모두 같은 시가지에 포함됨을 확인했다.
기존 후보3418076의 취락 정체만 승인하고 필터 밖11258566을 추가하거나 두 점을 병합하지 않았다.
몰타의 Paola·Senglea·Vittoriosa는 NSO 실제 도형과 PA 지명점을 함께 대조하여 이전 일반화 경계의 불일치를 해소했다.
에스토니아5건은 최신 AKS/KNR 경계·기준점까지 추가 대조했지만 원점이 다른 취락 경계 안에 있어 보류를 유지했다.
루마니아41건의 통계 시가지 도형은 물리적 햄릿과 같다고 간주하지 않았다. 군사기지·교구·시설 이름의 취락 포함 범위도 미결이면 보류했다.

유럽의 누적 확정 제외는 **162건**, 잔여 보류는 **122건**이다.
이번 유지 변경 15건은 원본 속성 그대로 정제 후보 풀에 복귀했다. 제외·보류 ID는 정제본에서 빠진다.
새 출처95개 중 직접 원문80개의 SHA-256·bytes를 확인했고, 공식 색인15개에는 원문 해시를 부여하지 않았다.
원본 ZIP·기준 후보 및 대상 밖10634개 판단·기존 출처를 보존했다. ID별 추가 조사와 원문 해시는 ignored
`reports/places/.cache/hold-revalidation-20261004-round2/`에 보존했다.
새 근거가 기존 쟁점을 풀지 못한 항목은 기존 판단을 유지하며, 원문 다운로드와 공식 색인 근거를 출처 표에서 구분한다.
인구·현행 행정 역할·rank/minZoom·좌표 정밀화와 지도 런타임 연결은 이번 변경 범위에 포함하지 않는다.

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

## 네 번째 검토 묶음: 서유럽 1차 정체 검토

사용자 지정 순서는 **서유럽 → 중앙유럽 → 남유럽 → 동유럽 → 북유럽**이다.
이번 서유럽 범위는 FR·GB·IE·BE·NL·LU·MC로 고정했다. 독일·오스트리아·스위스는
다음 중앙유럽 범위에 두며, 영국에는 북아일랜드 후보도 포함한다.

기존 1차 후보 **588개 전부**에 ID별 판단을 추가했다. 정착지 정체를 유지한 후보 535개,
확인 제외 33개, 보류 20개이다. 별도로 필터 밖 누락 **23개**를 `inclusion-review`로 기록했다.
따라서 이번 추가 판단은 총 611개이며, 앞의 78개 판단과 근거는 유지했다.

| 국가 | 기존 후보 | 유지 | 확인 제외 | 보류 | 필터 밖 예외 검토 |
| --- | --- | --- | --- | --- | --- |
| 프랑스 FR | 149 | 131 | 16 | 2 | 7 |
| 영국 GB | 298 | 269 | 16 | 13 | 0 |
| 아일랜드 IE | 30 | 28 | 0 | 2 | 4 |
| 벨기에 BE | 27 | 26 | 1 | 0 | 5 |
| 네덜란드 NL | 71 | 68 | 0 | 3 | 4 |
| 룩셈부르크 LU | 12 | 12 | 0 | 0 | 3 |
| 모나코 MC | 1 | 1 | 0 | 0 | 0 |
| 합계 | 588 | 535 | 33 | 20 | 23 |

### 확인 방식과 판단 수준

`retain`은 정착지 후보의 정체를 유지한다는 판단이다. **정확한 대표점·현재 인구·공간 범위·
지도 표시 순위까지 검증 완료했다는 뜻은 아니다.** 국가별로 확인한 자료의 수준이 다르므로
각 ID의 이유와 근거에 경계 포함, 이름·행정 실체 확인, 라벨 좌표 대조를 구분했다.

- **프랑스:** 정부 코뮌 API의 공식명·INSEE 코드·소속을 대조하고, 각 원본 좌표로 소속
  코뮌을 직접 조회했다. 일반 후보 130개가 이름·소속·코뮌 포함에 대응했다. Évry는
  현행 Évry-Courcouronnes의 Essonne 행정중심 정체를 유지하고 합병명·인구 정규화를 남겼다.
  파리 13개 arrondissement와 Gare·Maison Blanche는 시의 공식 경계 자료로 확인했다.
  **Paris 09 Opéra 2989487은 표제어와 달리 좌표가 공식 2구 안에 있다.** 내부 구역 제외와
  좌표 불일치를 함께 기록하고 점을 임의로 옮기지 않았다. Juan-les-Pins도 Antibes 내부
  quartier로 제외했다. Saint-Quentin-en-Yvelines·Marne La Vallée는 복수 코뮌 집합 의미를 보류했다.
- **영국:** ONS의 2022년 GB BUA 전체 8,545개 이름·코드와 필요한 경계를 조회했다.
  북아일랜드는 NISRA의 공식 SDL 2015 경계를 사용하고 WGS84 원본 점을
  TM65 Irish Grid(EPSG:29903)로 변환해 23개 후보의 포함을 대조했다. 경계의 기준 시점과
  현재 도시 인구 검증을 혼동하지 않는다. London 내부 후보 15개는 원본 점의 borough 포함과
  London Plan의 내부 중심지 목록을 함께 대조해 제외했고, 수도 London은 유지했다.
  ONS 자료의 London BUA 자체가 borough 경계라는 특수성이 있어 개별 정착지 증명에 쓰지 않았다.
  Hull 내부 Saint Andrews Quay retail park도 제외했다. Weymouth·Stroud·Scunthorpe·
  Newtown St Boswells·Livingston·Gosport·Bedford는 공식 이름에 대응하나 점이 일반화 경계
  밖 약 0.4~104m에 있어 **경계 포함 확인이라고 보고하지 않는다.** 정체는 유지하고 정밀
  대표점을 후속 검토로 남긴다. Glenfield·Giffnock은 공식 council 소재지로 확인한 행정중심이며
  Leicester·Glasgow 통계 시가지 안이라는 사실만으로 내부 ward로 지우지 않았다.
- **아일랜드:** CSO Census 2022 정착지명·코드와 경계를 대조했다. 기존 30개 후보의 점은
  각각 공식 정착지 영역 안에 있었다. An Muileann gCearr/Mullingar, Cluain Meala/Clonmel,
  Leifear/Lifford는 원본의 영어 별칭과 경계 이름이 대응해 유지했다. Tallaght는 Dublin 시가지
  포함과 South Dublin 행정중심의 관계를, Courtbrack는 정착지 존재와 PPLA2 선정 근거를 보류했다.
- **네덜란드:** PDOK 결과 중 BAG의 `woonplaats`만 사용하고 공식 locality ID·gemeente ID를
  이름·별칭·원본 소속과 대조했다. fuzzy 검색 전체를 동일 객체로 처리하지 않았다.
  Hoorn·Oosterhout의 동명 다른 gemeente를 구분했고 The Hague/'s-Gravenhage 및 Bergen(NH)을
  명시적으로 대조했다. BAG centroid 거리 확인은 **경계 포함 검증이 아니다.** Zaanstad는
  여러 정착지의 gemeente, Almere Stad는 도시 전체 Almere와 내부 stadsdeel 별칭 혼합,
  Velsen-Zuid는 작은 마을 이름과 큰 인구·선정 근거의 불일치로 보류했다.
- **벨기에:** Statbel 2025 REFNIS의 현행 commune/gemeente 이름·NIS 코드로 정체를 확인했다.
  이 이름표에는 대표점 경계가 없어 26개 유지 후보의 **좌표 포함은 독립 검증하지 않았다.**
  Hasselt는 합병 이후 코드 71072를 확인했지만 원본 필드는 덮어쓰지 않았다. Deurne는 Antwerpen
  내부 district로 제외했다. Brussels와 이어진 시가지의 독립 commune는 근접만으로 삭제하지 않았다.
- **룩셈부르크·모나코:** 룩셈부르크는 ACT 2026 공식 locality 목록의 CACLR ID·이름·코뮌·
  라벨 좌표를 대조했다. Redange-sur-Attert는 공식 Redange/Attert와 대응한다. Capellen도
  Mamer 내부 locality라는 이유만으로 행정중심 후보에서 제외하지 않았다. 모나코는 공국 영토가
  하나의 commune라는 공식 도시 정체로 수도 후보를 유지했다. 이들 자료는 정밀 대표점·인구 승인이 아니다.

### 필터 밖 누락과 남은 보류

랭스·르아브르·엑상프로방스·브레스트·뮐루즈·불로뉴비양쿠르·아르장퇴유는 PPLA3 때문에
빠지는 프랑스 코뮌 중심의 개별 예외 검토로 기록했다. 벨기에의 Anderlecht·Tournai·Ostend·
Sint-Niklaas·Mouscron, 아일랜드의 Drogheda·Bray·Athlone·Letterkenny, 네덜란드의
Doetinchem·Kerkrade·Kampen·Weert, 룩셈부르크의 Ettelbruck·Dudelange·Differdange도
개별 예외 검토로 남겼다. Sint-Niklaas의 프랑스어 별칭 Saint-Nicolas가 다른 벨기에 commune와
겹치는 사례는 현행 원명·소속 지역을 구분해 확인했다. 이는 **필터 밖 전체 지명 전수검토나
최종 포함 승인**이 아니며 국가별 일괄 예외를 만들지 않는다.

서유럽 보류 20개는 아래 생성 표에서 확인할 수 있다. 특히 Brighton·Hove, Almere Stad,
Zaanstad, Craigavon 등은 도시 전체·구성 중심·광역 인구 범위를 구분해야 한다.
Almere는 고정 cities500 안에서 내부 구역과 분리된 현행 도시 대표 ID를 확인하지 못해
중심 정착지 대응이 미해결 상태로 남는다. 삭제 확정·ID 병합·인구 이식·좌표 추측 수정은 하지 않는다.

공식 API·경계·레지스트리 응답의 URL·확인일·SHA-256을 검토 ledger의 근거에 기록했다.
응답 원본과 대조 중간 결과는 ignored `.cache/western-europe/`에 있다. ledger가 판단의
유일한 입력이며, 기존 `review` 명령이 같은 입력에서 정제본·집계·아래 표를 생성한다.
서유럽 588개에 1차 판단이 생겼지만 보류 해소·대표 이름/점·인구 범위·rank/minZoom과
실제 지도 데이터 생성·연결은 남아 있다. 현재 검토 결과는 지도 런타임에 연결하지 않는다.

## 다섯 번째 검토 묶음: 중앙유럽 1차 정체 검토

중앙유럽 범위는 **DE·AT·CH·LI·PL·CZ·SK·HU·SI**로 고정했다. 슬로베니아는 이 묶음에서
검토했으므로 다음 남유럽 묶음과 중복하지 않는다. 기존 후보 **879개 전부**에 ID별 판단을
추가했다. 정착지 정체 유지 856개, 확인 제외 19개, 보류 4개이며, 필터 밖 누락 84개를
`inclusion-review`로 별도 기록했다. 이번 추가 판단은 총 963개이고 앞의 689개 판단·근거는
변경하지 않았다.

| 국가 | 기존 후보 | 유지 | 확인 제외 | 보류 | 필터 밖 예외 검토 |
| --- | --- | --- | --- | --- | --- |
| 독일 DE | 55 | 53 | 2 | 0 | 49 |
| 오스트리아 AT | 30 | 29 | 1 | 0 | 5 |
| 스위스 CH | 106 | 105 | 0 | 1 | 3 |
| 리히텐슈타인 LI | 11 | 11 | 0 | 0 | 0 |
| 폴란드 PL | 223 | 209 | 14 | 0 | 13 |
| 체코 CZ | 23 | 21 | 2 | 0 | 7 |
| 슬로바키아 SK | 63 | 62 | 0 | 1 | 4 |
| 헝가리 HU | 156 | 156 | 0 | 0 | 2 |
| 슬로베니아 SI | 212 | 210 | 0 | 2 | 1 |
| 합계 | 879 | 856 | 19 | 4 | 84 |

### 확인 방식과 자료 기준일

879개 기존 후보와 84개 누락 제안의 원본 점을 [Eurostat GISCO LAU 2024 경계](https://gisco-services.ec.europa.eu/distribution/v2/lau/geojson/LAU_RG_01M_2024_4326.geojson)에
대조했다. 모든 점에 같은 국가의 LAU 포함 결과가 있었지만, **지자체 경계 안이라는 사실만으로
도시 정체를 확정하지 않았다.** 원명·별칭과 공식 지자체명, 국가별 지명/도시 목록, 내부 구역
근거를 함께 대조했다. LAU는 정착지의 물리적 시가지 경계가 아니고, 2024년 일반화 경계를
2026년 정밀 경계로 보고하지 않는다. `retain`은 정착지 정체의 1차 유지 판단이며 현재 인구,
정확한 대표점, 행정등급, rank/minZoom 승인과 구분한다.

- **독일:** [Destatis 지자체 원본](https://www.destatis.de/DE/Themen/Laender-Regionen/Regionales/Gemeindeverzeichnis/Administrativ/Archiv/GVAuszugQ/AuszugGV1QAktuell.xlsx?__blob=publicationFile)의
  실제 시트 `Onlineprodukt_Gemeinden31032026`을 읽었다. 지자체 기준일은 **2026-03-31**이고
  인구·라벨 좌표 기준일은 **2024-12-31**이다. 파일명의 `Aktuell`만 보고 2026 인구나 9월
  행정구역으로 표시하지 않는다. `Satzart=60`의 AGS·공식명·소속을 대조했다. Stadt 등 쉼표
  뒤 지위 표기는 이름 본체와 구분하고, Stolberg (Rhld.)·Gronau (Westf.)·Oldenburg (Oldb)는
  AGS·경계·공식 라벨 좌표로 동명 도시를 구분했다. Dessau는 Dessau-Roßlau의 주된 중심
  정착지와 원본 합병명 별칭을 확인해 유지하고 대표 이름·인구 범위 정규화를 남겼다.
- **오스트리아:** [Gemeindeverzeichnis 2026](https://www.statistik.at/fileadmin/pages/453/RegGemVz2026.ods)의
  GKZ·공식명·소속을 확인했다. 구역/인구 기준일은 **2026-01-01**, 작성일은 2026-08-11이다.
  Wien의 구 항목을 별도 도시로 취급하지 않았다. Hermagor는 합병 지자체
  Hermagor-Pressegger See 안의 중심 도시로 확인했다.
- **스위스·리히텐슈타인:** [swisstopo swissNAMES3D 2026](https://www.swisstopo.admin.ch/en/landscape-model-swissnames3d)의
  `TLM_SIEDLUNGSNAME`·`OBJEKTART=Ort`·UUID·공식명·라벨 좌표를 사용했다. 건물,
  정류장, Quartier 이름을 도시 증명으로 쓰지 않았다. 기존 후보 117개와 스위스 누락 제안
  3개가 가까운 공식 Ort에 대응했다. Brugg AG·Renens VD·St-Maurice는 실제 한정명·철자를
  따로 확인했다. 39개는 같은 UUID의 SHP 지명 영역도 대조했으며 **36개만 점이 포함됐다.**
  Interlaken은 영역 밖 84.294m, Hinterrhein은 140.372m, Lugano의 별칭 Ligiaun은 22.236m로
  경계 포함 확인이라고 보고하지 않는다. Hinterrhein·Lugano는 공식 Ort의 이름·라벨 근접과
  해당 지자체 포함으로 정체를 유지하고 정밀 대표점을 남겼다. Tiefencastel·Hinterrhein·Cully·
  Cernier·Brig 등은 합병 후에도 남은 정착지로 확인했으나 원본 행정 중심 역할을 자동 승인하지 않는다.
- **폴란드:** [GUS 공개 TERYT 다운로드](https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx)의
  TERC·SIMC를 읽었다. 다운로드 요청일과 ZIP 회원명은 2026-10-03이나 실제 catalog 및
  `STAN_NA` 기준일은 **2026-01-01**이다. GISCO의 13자리 LAU 코드는 7자리 TERYT와
  같은 ID가 아니므로 [공식 KTS–TERYT 대응표](https://stat.gov.pl/statystyka-regionalna/jednostki-terytorialne/system-kts/jednostki-kts-i-ich-symbole/)의
  `Gminy 2024`로 연결했다. 유지 209개와 누락 제안 13개는 동일 지자체에 속한
  `SIMC RM=96` 도시 이름·SYM에 하나씩 대응했다. Olsztyn 등 동명 도시와 별칭이 겹치는
  다른 도시를 소속으로 구분했다. 혼합 gmina의 도시 부분과 지자체 전체 인구는 구분해 남겼다.
- **체코·슬로바키아:** LAU 2024 경계와 [LAU–NUTS 공식 대응표](https://ec.europa.eu/eurostat/web/nuts/local-administrative-units)의
  도시/지자체 이름·코드를 대조했다. Bratislava·Košice의 점은 내부 구 LAU 안이지만 대응표가
  각각 전체 도시 `SK001C`·`SK002C`의 구성 관계를 명시한다. 수도/지역 중심 도시 이름을
  내부 구 이름으로 바꾸거나 제외하지 않았다. 이 대조는 2024 자료이며 2026년 모든 행정 개편의
  검증 완료를 뜻하지 않는다.
- **헝가리:** [KSH 공식 지명 목록 다운로드](https://www.ksh.hu/apps/hntr.egyeb?p_lang=EN&p_sablon=LETOLTES)의
  실제 제공 파일 `dgh_download_2025.xlsx`, `Localities 01.01.2025.` 시트를 사용했다.
  기존 156개와 누락 제안 2개의 이름·HCSO 코드·법적 지위·소속을 대응시켰다.
  `Settlement-parts`를 전체 도시 목록과 혼동하지 않으며 **2025 목록을 2026 인구로 표시하지 않는다.**
- **슬로베니아:** [GOV.SI의 212개 지자체 연락처](https://www.gov.si/podrocja/drzava-in-druzba/lokalna-samouprava-in-regionalni-razvoj/lokalna-samouprava/obcine/)를
  이름·LAU 소속·기관 주소와 대조했다. Videm/Dobrepolje, Dobrovo/Brda처럼 지자체와 다른
  중심 취락명, 합성 지자체명, 이중언어 표기를 구분했다. Dragomer는 정관이 실제 소재지
  `Na Grivi 5, Dragomer`를 명시하므로 우편 도시 Log pri Brezovici로 교체하지 않았다.
  연락처의 우편 도시만으로 212개의 법정 소재지·정밀 대표점을 전부 승인하지 않는다.

### 확인 제외·보류와 주요 누락

확인 제외 19개는 **Bochum 내부 Wattenscheid, Grevenbroich 내부 Neubrück, Warszawa 내부
13개 구역, Bydgoszcz 내부 Fordon, Praha 내부 Stodůlky, Brno 내부 Brno střed, Unterwart 내부
Eisenzicken**이다. Eisenzicken의 원본은 `PPL / 54353`이지만 현행 Unterwart 지자체 전체 인구는
1,015명이며 공식 설명도 내부 Ortsteil로 구분한다. 잘못된 인구로 일반 도시 필터를 통과한
후보를 제외하고 원본 인구는 덮어쓰지 않았다. Białołeka는 공식 구명 Białołęka와 구분해 기록했다.

보류 4개는 다음과 같다.

| ID | 원명 | 남은 문제 |
| --- | --- | --- |
| 3059435 | Komárno | 점·소속은 Podhájska 안 Dvor Komárno에 대응하나 Danube 도시 이름·인구가 섞였다. 실제 도시의 별도 ID 3059436은 필터 밖 개별 예외 검토로 기록했다. |
| 2660253 | Interlaken | 원본 점은 Matten bei Interlaken 지자체이며 공식 Interlaken 지명 영역 밖 84.294m이다. 도시 대표점 의미를 추가 확인해야 한다. |
| 3218745 | Leskova Dolina | 실제 행정 소재지 Stari Trg pri Ložu와 다른 취락 위치이며 Loška dolina 지자체 별칭이 섞였다. 정상 중심의 별도 PPL ID 3189940을 개별 예외 검토로 기록했다. |
| 8358613 | Kostel | 지자체 전체 별칭·인구와 취락/행정 소재지 의미가 섞였다. 정관의 소재지는 Vas이며 고정 cities500에서 Vas의 도시 레코드는 확인되지 않았다. |

필터 밖 누락 84개는 독일의 원본 인구 10만 이상 `PPLA3/PPLA4` 도시 49개, 폴란드의 원본
인구 5만 이상 `PPLA3` 도시 13개, 체코의 원본 인구 4만 이상 주요 도시 7개와 나머지 국가의
개별 도시/정상 행정 중심을 골라 검토한 결과이다. 프랑크푸르트·도르트문트·라이프치히·
에센·뉘른베르크·보훔, Częstochowa·Gliwice·Bytom, Havířov·Mladá Boleslav·Přerov,
Dornbirn·Wiener Neustadt·Steyr, Köniz·Montreux·Rapperswil, Zvolen·Nové Zámky·
Liptovský Mikuláš·정상 Komárno, Nagykanizsa·Hódmezővásárhely·Stari Trg pri Ložu 등이 포함된다.
이 수치는 **검토 표본 선택 기준**이며 기존 전 세계 필터를 국가별로 변경하지 않았다.
필터 밖 전수검토·최종 포함 승인·정제본 승격을 뜻하지 않는다. ID 병합·좌표 추측·인구 이식을 하지 않는다.

근거별 URL·자료 시점·확인일·접근 방식과 읽은 원본의 SHA-256을 ledger에 기록했다.
원본 응답·경계·대조 결과는 ignored `.cache/central-europe/`에 있다. Bochum 구역 설명,
Hermagor 설명, Kostel 정관, Dragomer 정관은 직접 다운로드 오류/timeout으로 **공식 검색
색인**을 사용한 사실을 명시했다. 실패한 응답의 해시를 근거로 만들지 않았다.
이번 변경도 기존 `review` 명령이 ledger에서 정제본·집계·아래 표를 생성하는 흐름만 사용한다.
대표 이름/점·인구 범위·rank/minZoom과 실제 지도 데이터 생성·연결은 남아 있다.

## 여섯 번째 검토 묶음: 남유럽 1차 정체 검토

2026-10-04에 AL/AD/BA/HR/CY/ES/GR/IT/MT/ME/MK/PT/RS/SM/VA/XK의
기존 후보 1,449개를 대조했다. 슬로베니아는 중앙유럽에서 이미 검토했으므로 중복 집계하지 않는다.
포르투갈 Oliveira do Hospital의 기존 판단을 포함하며, 앞선 1,652개 ID 판단과 근거를 그대로 보존했다.

| 국가 코드 | 기존 후보 | 유지 | 제외 | 보류 | 필터 밖 포함 재검토 |
| --- | --- | --- | --- | --- | --- |
| AL | 35 | 35 | 0 | 0 | 24 |
| AD | 7 | 7 | 0 | 0 | 0 |
| BA | 65 | 65 | 0 | 0 | 17 |
| HR | 578 | 555 | 22 | 1 | 0 |
| CY | 12 | 11 | 0 | 1 | 0 |
| ES | 87 | 81 | 3 | 3 | 65 |
| GR | 54 | 53 | 1 | 0 | 23 |
| IT | 117 | 109 | 6 | 2 | 46 |
| MT | 63 | 57 | 0 | 6 | 5 |
| ME | 25 | 25 | 0 | 0 | 0 |
| MK | 75 | 70 | 4 | 1 | 0 |
| PT | 258 | 251 | 0 | 7 | 45 |
| RS | 26 | 25 | 1 | 0 | 14 |
| SM | 9 | 9 | 0 | 0 | 0 |
| VA | 1 | 1 | 0 | 0 | 0 |
| XK | 37 | 36 | 1 | 0 | 1 |
| 합계 | 1,449 | 1,390 | 38 | 21 | 240 |

`retain`은 공식 명부/취락 목록과 대응하는 정체를 유지한 1차 판단이다. 현행 행정 등급,
도시 전체의 인구 범위, 정밀 대표점, rank/minZoom까지 승인한 건수로 해석하지 않는다.
기존 원본 인구·좌표·행정 코드·이름을 수정하거나 ID를 병합하지 않았다.

공통 공간 대조에는 앞선 검토의 GISCO LAU 2024 경계와 Eurostat 대응표를 재사용했다.
AL/CY/ES/GR/HR/IT/MK/MT/PT/RS의 기존 후보 1,305개 중 1,296개 원점이 해당 국가 LAU에
포함됐다. 그리스의 GeoNames `GR`을 공식 경계의 `EL`에 명시적으로 연결했다.
나머지 9개는 일반화 해안 경계 부근 또는 외부로, 경계 미포함만으로 도시를 삭제하지 않았다.
BA/ME/AD/SM/VA/XK 144개에는 이 자료의 경계가 없어 국가별 공식 명부/취락 자료를 대조했으며
point-in-polygon을 수행한 것처럼 보고하지 않는다.

LAU는 국가마다 의미가 다르다. 포르투갈은 freguesia, 그리스는 community이며,
세르비아·북마케도니아의 대도시 내부 borough도 LAU에 포함된다. 지자체 경계 포함 자체는
단일 물리적 도시나 도시 인구의 증거가 아니다. 그리스어·키릴 문자의 별칭을 Unicode로 비교했고
빈 문자열을 이름 일치로 인정하지 않았다. 지역별 공식 자료의 기준은 다음과 같다.

- 이탈리아: ISTAT `CODICI al 21_02_2026`의 현행 7,894개 comuni. Sardinia는
  2024 코드와 2026 코드 사이의 공식 formerCode 열을 사용했다.
- 스페인: INE 2026-01-01 명부의 52개 시트와 8,132개 지자체.
  CPRO+CMUN 5자리를 사용하며 제어 숫자를 식별자에 포함하지 않는다.
- 크로아티아: DZS 2021 naselje별 Census와 현행 지자체 기관 주소록·정관.
  행정 사무실, 법정 소재지, 주소 끝의 우편 도시를 구분했다.
- 포르투갈: 현행 DGAL 308개 concelhos 목록, 해당 도시/지역의 공식 설명과 LAU 2024.
  CAOP 2025 다운로드에는 실패하여 해당 경계를 적용했다고 주장하지 않는다.
- 알바니아: 법률 115/2014의 61개 bashki와 실제 소재지 부록.
  오래된 소재지 이름과 현행 LAU의 다른 지자체 이름을 분리했다.
- 보스니아 헤르체고비나: 2013 Census의 level 4 취락과 level 3 소속.
  Montenegro는 2023 Census의 opština/naselje 목록을 사용했다.
- 코소보: KAS Census 2024 PX 메타데이터의 지자체·취락 값과 별칭.
  실제 인구 셀·경계를 조회한 자료가 아니며 메타데이터 갱신일을 인구 기준일로 쓰지 않는다.

제외 38개는 Napoli 내부 4개 구역, Roma의 복합 구역명, Verona의 도로명,
Madrid 내부 2개 구역과 Bilbao의 Santutxu, Skopje 내부 4개 구역,
그리스의 고고학 유적 Mosynopolis, Pirot 중앙 광장, 잘못된 중심 역할의 Glanica,
크로아티아의 잘못된 PPLA2 중심 22개이다. 크로아티아의 취락 자체를 부정한 판단은 아니다.
Korčula의 Blato는 유지하고 Mljet의 동명 Blato만 제외했다. Mlini와 Kamenmost는 실제 소재지와
우편 도시가 혼동된 사례이며, Lopatinec과 Vlaka는 사무실 주소와 법정 중심을 구분해 유지했다.
Sesvete는 Zagreb 안에서도 공식 Census의 별도 물리적 정착지여서 단순 구역명으로 제외하지 않았다.

보류 21개는 다음 원본 ID에 개별 근거를 기록했다.

- 몰타 6개: Paola, Imsida, Senglea, Cospicua, Balzan, Vittoriosa.
  이름은 존재하지만 점이 이웃 council LAU 또는 일반화 해안 밖이다. 좌표를 임의로 교환하지 않았다.
- 포르투갈 7개: Monsanto, Cacém, Algueirão, Ourém, Fornos de Algodres, Castelo de Paiva, Vizela.
  인구 범위·복수 중심 이름 또는 도시 중심 대표점의 의미를 확인해야 한다.
  Monsanto는 Alcanena 소속으로 Idanha-a-Nova의 동명 관광 마을과 구분했다.
- 이탈리아 2개: Mestre, Lido di Ostia. 전체 지자체 안 주요 물리적 중심의 별도 표시 여부를 남겼다.
- 스페인 3개: Campiña, Grao de Murviedro, Santa Lucía. 오래된 이름, 큰 인구의 범위와 실제 중심을
  확인해야 한다. Santa Lucía 내륙 중심과 인구가 집중된 해안/Vecindario를 구분했다.
- 키프로스 Kato Lakatamia, 북마케도니아 Labuništa, 크로아티아 Liberpolis 각 1개.
  Liberpolis는 2015 정부 설명이나 2021 Census 부재로 2026 실재/법적 지위를 확정하지 않았다.

필터 밖 제안 240개는 전수 검증이 아닌 다음 범위의 추가 검토 목록이다. ES/IT/GR는
원본 PPLA3 인구 5만 이상, BA는 PPL/PPLA3 인구 1만 이상, RS는 2만 이상 중 이름·소속이 대응하는
도시를 확인했다. 포르투갈은 기존 후보에서 빠진 중심을 대조해 45개를 제안했다.
Madeira/Azores의 동명 Seixal, Maia, Castelo Branco 등과 Lagos 안 Porto de Mós는 본토 지자체
소재지로 연결하지 않았다. 알바니아는 원본에 있는 누락 중심 24개를 제안했으며 법률에 있는
Sofratikë/Dropull, Dermish/Finiq의 소재지 ID는 고정 `cities500` 원본에서 찾지 못해 생성하지 않았다.
몰타는 빠진 5개 council 중심을 제안했다. Santa Luċija의 PPLX 분류, Fgura의 Tarxien 안 원점도
재검토 사유로 명시했다. 코소보 Gračanica는 Lipjan의 Gllanicë와 별개인 올바른 중심 후보이다.
제안은 기존 전역 필터를 바꾸거나 정제본에 추가하지 않는다.

직접 읽은 공식 XLSX/HTML/PDF/API 응답은 근거별 SHA-256·바이트 수·캐시 경로를 기록했다.
직접 접근 실패/WAF 또는 검색 색인으로 확인한 페이지는 `official-indexed-page/document`로 구분하며
실패 응답이나 차단 화면의 해시를 근거로 등록하지 않았다. 2013/2021/2023/2024 통계를
2026 인구로 취급하지 않는다. 실제 표시용 지명 데이터와 지도 런타임 연결은 이 검토에 포함하지 않는다.

## 일곱 번째 검토 묶음: 동유럽 1차 정체 검토

2026-10-04에 BY/BG/MD/RO/RU/UA의 기존 후보 5,492개를 대조했다.
러시아는 국가 코드 RU 전체를 한 묶음으로 처리하므로 아시아 지역 취락도 포함한다.
앞선 3,340개 ID의 판단과 근거를 그대로 보존하고 고정 `cities500` 원본을 교체하지 않았다.

| 국가 코드 | 기존 후보 | 유지 | 제외 | 보류 | 필터 밖 포함 재검토 |
| --- | --- | --- | --- | --- | --- |
| BY | 117 | 115 | 0 | 2 | 12 |
| BG | 100 | 98 | 2 | 0 | 154 |
| MD | 38 | 38 | 0 | 0 | 24 |
| RO | 3,029 | 2,938 | 50 | 41 | 176 |
| RU | 1,956 | 1,929 | 5 | 22 | 74 |
| UA | 252 | 245 | 3 | 4 | 68 |
| 합계 | 5,492 | 5,363 | 60 | 69 | 508 |

`retain`은 국가 공식 명부와 이름·별칭·지역/식별자를 대조한 **1차 정체 유지**이다.
현재 행정 등급, 도시 전체의 인구 범위, 정밀 대표점, rank/minZoom과 지도 표시 승인은 남아 있다.
작은 인구·0 인구·낡은 이름을 단독 제외 근거로 삼지 않았고 원본 속성을 덮어쓰거나 ID를 병합하지 않았다.

국가별 근거와 대조 범위는 다음과 같다.

- **불가리아:** NSI EKATTE의 취락 5,256개와 municipality 265개의 별도 목록을 읽었다.
  취락 목록은 2026-05-15, municipality 목록은 2023-12-12 기준이며 ZIP 생성일은 2026-10-03이다.
  `ek_obst.ekatte`의 실제 소재지와 `ek_atte`의 취락을 구분했다. Spasovo는 General Toshevo,
  Gulyantsi 안 Iskar 마을은 Gulyantsi가 실제 중심이어서 잘못된 `PPLA2` 역할을 제외했다.
  별도 Iskar 도시 ID 728348은 원점·obshtina PVN23을 대조해 필터 밖 제안으로 기록했다.
  Sarnitsa는 현행 PAZ39 중심이며 원본 PAZ08을 임의 수정하지 않고 유지했다.
- **루마니아:** INS의 `SIRUTA_s1 2026` 16,978행을 공식 TIP 정의와 함께 읽었다.
  NIV 3 취락 13,755개 중 TIP 9/17/22는 municipality/town/commune 소재지이고,
  TIP 10/18/23 등은 중심 아닌 locality이다. 지자체 이름과 실제 소재지 취락을 구분했다.
  Zărneşti/Fundeni, Traian Vuia/Sudriaş, Târgşoru Vechi/Strejnicu 등 49개는 원본 이름의
  취락은 존재하지만 다른 취락이 중심이다. Haneș Mină는 공식 county plan의 광산 이름과
  현행 소재지 Almaşu Mare를 함께 대조해 추가 제외했다. 광산 주변 거주 자체를 부정한 판단은 아니다.
  Băile Govora/Prăjila와 Băile Olănești/Livadia는 시청의 실제 도시·resort 설명으로 유지했고,
  Bucharest의 특별 NIV 구조를 일반 locality 부재로 오해하지 않았다.
- **몰도바:** BNS CUATM 2025의 고유 코드·parent·Statut와 루마니아어/러시아어 이름을 읽었다.
  Taraclia, Drochia, Dondușeni, Ocnița 등의 town/municipium과 동명 마을을 구분했다.
  좌안/Transnistria도 원본 country MD 안에서만 대조했다. 자료는 취락 분류 근거이며
  경계·대표점·2026 인구나 실효 지배를 확정하는 자료가 아니다.
- **벨라루스:** Belstat의 2025-01-01 도시·도시형 취락 표를 province와 함께 읽었다.
  2025 인구를 2026 값으로 덮어쓰지 않았다. 도시 목록 밖 농촌 취락 Rahozna는
  부재만으로 제외하지 않고 중심 역할을 보류했다. Krychaw와 Horad Krychaw의 별도 ID도 병합하지 않았다.
- **우크라이나:** Ministry의 2026-07-07 KATOTTG에서 M city, X settlement, C village,
  B urban borough, K special city를 구분하고 province/district 코드 namespace를 명시적으로 연결했다.
  법적 취락 명부가 현장 거주·인구·실효 지배를 보장한다고 해석하지 않는다.
  Bilmak→Kam’yanka, Katerynopil→Kalynopil은 국회 개명 법령과 현행 코드를 대조해 유지했다.
  Kadiyivka도 현행 Кадіївка와 연결했다. 옛 Inhulets는 2002 편입 법령으로 Kryvyi Rih 내부
  도시임을 확인해 제외했으며 같은 district의 동명 village로 잘못 연결하지 않았다.
  Odesa 내부 Cheremushky와 Makiivka 내부 category B Khanzhonkivskyi도 제외했다.
- **러시아:** Rosstat 2026-10-01 OKTMO에서 section 1 municipal unit/Centrum과
  section 2 settlement leaf를 구분했다. TER+KOD1+KOD2+KOD3를 사용하며 제어 숫자는 식별자에 섞지 않는다.
  공식 structure에서 Status 3은 object enabled임을 확인했으며 폐지 코드로 해석하지 않았다.
  GeoNames admin1 지역명 lookup은 보조 crosswalk 자료로만 사용하고 고정 도시 원본을 교체하지 않았다.
  Nenets/Khanty-Mansi/Yamal을 각각 Arkhangelsk/Tyumen의 다른 영역과 구분했다.
  동명 취락은 같은 region의 유일한 higher municipality 중심과 그 parent 코드를 우선 대조했다.
  Moscow/St Petersburg 자체는 federal-city header로 확인하고 일반 settlement leaf 부재로 제외하지 않았다.
  Peterhof/Pushkin/Kolpino는 공식 `MO город` town 명부로 정체를 유지했다.
  Novo-Peredelkino, Klimovsk, Ezhva, Adler, Talnakh는 공식 자료상 도시 내부 구역으로 제외했다.
  러시아 명부에 있는 Ukraine 지역 주장을 근거로 원본 UA 국가 코드를 이동시키지 않았다.

공간 대조는 이전 GISCO LAU 2024 경계를 재사용했다. **BG 100개와 RO 3,029개, 총 3,129개
원점 모두 같은 국가 LAU 안에 포함**됐다. 그러나 같은 국가 포함과 정확한 소속은 다르다.
RO 36개는 원본 parent 대신 이웃 LAU에 포함돼 보류했으며 그 안에 복합 이름 Budeasa도 있다.
BY/MD/RU/UA에는 이번 경계 자료를 적용하지 않았으므로 point-in-polygon 완료로 보고하지 않는다.

보류 69개는 원본 ID별 이유를 ledger에 기록했다.

- RO 41개: 이웃 지자체 안 원점 36개와 Sârbii-Măgura, Ghimeş-Făget, Eforie,
  Breaza, Albeştii de Argeş의 복합 이름/대표점 5개. 좌표를 추정해 이동시키지 않았다.
- RU 22개: 같은 official city 코드로 연결되는 Zarechnyy, Rossosh’, Lesnoy, Ozërsk/Ozersk,
  Ust’-Ilimsk 5쌍(10 ID), Zelenograd/Obruchevo의 영역 의미, Petrodvorets의 historical alias,
  Shovgenovskiy의 개명 연결, Gorod Shebekino/Kisilevsk/gorod Solnetchnogorsk의 다른 도시 ID 관계,
  Vysokaya Gora/Usol’ye/Novosëlovo/Berëzovka/Kedrovyy의 동명 취락 구분.
  공식 이름 일치만으로 어느 원점이 맞는지 확정하거나 ID를 병합하지 않았다.
- UA 4개: Kazanka, Holovanivsk, Bereznehuvate의 같은 district·community 안 동명 X 취락 구분과
  Hlybochok의 village/PPLA2 중심 역할. BY 2개는 Horad Krychaw와 Rahozna이다.

필터 밖 508개는 다음 범위의 **개별 포함 재검토 제안**이다. 전역 `candidate()` 정책을 바꾸지 않는다.

- BG 154개와 RO 176개는 원본에서 찾은 실제 municipality/town/commune 중심 중
  이름·소속/원점 LAU가 대응하는 누락 중심이다. 현재 유지한 동일 중심의 다른 표제어를 중복 제안하지 않는다.
  이 숫자는 모든 법정 중심이 고정 `cities500` 원본에 있다는 뜻이 아니다.
- MD 24개는 CUATM town/municipium에 대응하는 누락 도시이며 Dubăsari, Ceadîr-Lunga,
  Vulcăneşti, Durleşti 등이 포함된다. BY 12개는 원본 인구 1만 이상 공식 도시·도시형 취락 표본이다.
- RU 74개와 UA 68개는 원본 PPL/PPLA3/PPLA4 인구 2만 이상 중 같은 region/district의
  official city에 대응하는 표본이다. 우크라이나 Irpin, Lysychansk, Khartsyzk 등과
  러시아 Vsevolozhsk, Velikiy Ustyug, Monchegorsk, Kanash 등이 포함된다.
  표본 선택용 원본 인구를 최신 현장 인구로 해석하지 않는다.

직접 읽은 공식 ZIP/XLSX/CSV/XML/PDF/HTML 응답은 근거별 SHA-256·바이트 수·캐시 경로를 기록했다.
St Petersburg town 명부(timeout), Moscow district 표(HTTP 477), Komi Ezhva 설명(TLS 만료),
Odesa 시장 보고서(HTTP 502), Alba county plan(DNS 실패)은 공식 검색 색인으로 확인한 접근 한계를 명시했다.
실패·차단 응답에 snapshot hash를 만들거나 TLS 검증을 끄지 않았다. Rosstat의 누락된 TLS 중간 인증서는
공식 root fingerprint와 발급 관계를 검증한 요청별 SSL context로 처리했으며 시스템 trust를 수정하지 않았다.
연구 원본과 대조 자료는 ignored `.cache/eastern-europe/`에 있고 기존 `review` 명령이
정제본·집계·아래 표를 생성한다. **지도 표시용 데이터 생성·연결은 아직 남아 있다.**


## 여덟 번째 검토 묶음: 북유럽 1차 정체 검토

2026-10-04에 DK/NO/SE/FI/IS/EE/LV/LT와 AX/FO/SJ/GG/IM/JE의 기존 후보 1,071개를 대조했다.
GB 298개와 IE 30개는 앞선 서유럽 묶음에서 이미 검토했으므로 중복 판정을 추가하지 않았다.
기존 9,340개 ID의 판단·근거·순서를 보존하고 고정 `cities500` 원본을 교체하지 않았다.

| 국가 코드 | 기존 후보 | 유지 | 제외 | 보류 | 필터 밖 포함 재검토 |
| --- | --- | --- | --- | --- | --- |
| DK | 101 | 95 | 2 | 4 | 10 |
| NO | 382 | 343 | 1 | 38 | 12 |
| SE | 291 | 284 | 1 | 6 | 6 |
| FI | 20 | 18 | 0 | 2 | 210 |
| IS | 9 | 8 | 0 | 1 | 36 |
| EE | 74 | 69 | 0 | 5 | 22 |
| LV | 85 | 84 | 1 | 0 | 22 |
| LT | 40 | 40 | 0 | 0 | 22 |
| AX | 16 | 4 | 0 | 12 | 1 |
| FO | 18 | 17 | 1 | 0 | 15 |
| SJ | 2 | 1 | 0 | 1 | 0 |
| GG | 10 | 4 | 2 | 4 | 0 |
| IM | 21 | 18 | 0 | 3 | 0 |
| JE | 2 | 2 | 0 | 0 | 4 |
| 합계 | 1,071 | 987 | 8 | 76 | 360 |

`retain`은 실제 취락과 원본 이름·소속의 **1차 정체 유지**이다.
현재 행정 역할, 도시 전체 인구 범위, 정밀 대표점, rank/minZoom과 지도 표시 승인은 남아 있다.
지자체 합병·통계 시가지 통합·인구 0·목록 부재를 단독 제외 근거로 사용하지 않았다.
원본 이름·좌표·인구·행정 코드를 수정하거나 다른 ID를 병합하지 않았다.

국가별 근거와 대조 범위는 다음과 같다.

- **덴마크:** Danmarks Statistik BY1/BY3의 시가지 코드·지자체와 공식 지방정부 설명을 함께 읽었다.
  2026 통계는 2025 시가지 경계를 재사용하므로 2026 도시 경계까지 확인한 것으로 해석하지 않는다.
  KL의 98개 지자체 연락처 XLSX는 기준일이 없고 우편 소재지·옛 표제어가 섞일 수 있어 보조 자료로만 썼다.
  Brøndbyvester와 Avedøre는 현행 자료의 bydel로 제외했다. Buddinge의 by/kvarter 혼용,
  Charlottenlund의 결합 구역·우편명, Christiansø의 섬·특수 행정단위, Klinteby Frihed의 이름 범위는 보류했다.
- **노르웨이:** Kartverket SSR에서 공인 이름, 객체 번호, 현재 municipality, 이름 유형과 원점 거리를 대조했다.
  By/Tettsted/Tettbebyggelse와 Tettsteddel(내부 부분), Kommune, 섬·농장·교회·계곡을 구분했다.
  Bygdelag는 넓은 공동체 영역일 수 있어 그 유형이나 시청 우편 주소만으로 단일 취락을 확정하지 않았다.
  Fjerdingby는 공인 Tettsteddel로 제외했고 Kjenn은 Tettbebyggelse/Tettsteddel가 충돌해 보류했다.
  SSB의 2026 시가지 통계는 SSR 명칭을 보강하며 결합/내부 시가지 인구를 원본 한 점에 대입하지 않는다.
  일부 SSR 질의는 500건 첫 페이지 제한이 있어 total/returned를 기록했다. 확인한 공인 객체를
  이름·소속·유형으로 대조한 근거이며 검색 결과 부재나 전체 검색 완료의 근거로 사용하지 않았다.
- **스웨덴:** SCB의 2023 tätort 코드·이름·municipality 표를 공식 지방정부 설명과 함께 대조했다.
  2024 통계 공표일과 이후 이름 정비일을 경계 기준연도로 혼동하지 않았다.
  Stockholm/Malmö 같은 연속 시가지에 포함된다는 이유만으로 실제 named town/centralort를 삭제하지 않았다.
  Haninge는 Handen·Vega·Brandbergen 일부를 묶은 공식 계획의 aggregate로 제외했다.
  결합 시가지 이름과 현재 도시 내부 stadsdel/kommundel는 별도 검토했고, 이름·소속 불일치는 보류했다.
  SCB 전체 통계 시가지 GeoJSON은 파싱 실패로 사용하지 않았으므로 그 polygon 내부 점 검증은 수행하지 않았다.
- **핀란드·올란드:** Statistics Finland의 2024 urban settlement 표와 ÅSUB의 2025 village 통계를 읽었다.
  AX를 원본 국가 코드로 유지하며 FI LAU 경계와의 대응은 명시적으로만 사용했다.
  municipality 이름 일치와 실제 village 이름 증거를 구분하고 Jomala/Yomala의 복수 ID도 병합하지 않았다.
  핀란드 기존 후보 20개 밖의 주요 취락은 개별 포함 재검토로만 기록했다.
- **에스토니아:** EHAK 2026v1 코드/parent와 2026-09-02 settlement 경계를 대조했다.
  Viimsi·Antsla·Taebla·Kurepalu·Kõrveküla 원점은 다른 named village에 포함되어 보류했다.
  원본 admin1/admin2와 현행 코드 차이 및 실제 포함 취락을 ID별 이유에 기록하고 좌표를 임의 이동하지 않았다.
- **라트비아:** VZD의 town/village/municipality/parish를 분리한 명부와 2026-09-30 settlement 경계를 읽었다.
  Aizkraukle의 동명 city/village를 구분했다. Berģi 원점은 Rīga city 안이며 시청의 Berģi neighbourhood에
  대응해 제외했다. 다른 지자체의 동명 village로 잘못 연결하지 않았다.
- **리투아니아:** 국가 ZIS의 named settlement/city 자료를 municipality와 대조했다.
  registry CSV의 HTTP 403 및 일부 API HTTP 500 접근 실패를 기록했고, 제공 자료의 기준일 미기재를
  2026 갱신 증거로 취급하지 않았다. Neringa 지자체 범위와 실제 Nida 취락을 구분했다.
- **아이슬란드:** Statistics Iceland MAN030101의 2026 urban nuclei 127개 범주와 공식 정의를 읽었다.
  POST query의 연도·전체 연령·성별 선택을 기록했다. 응답의 `updated=2020-06-09`는 오래된 필드이며
  2026 공표일의 증거로 쓰지 않았다. Keflavík와 Njarðvík의 결합 통계를 단일 도시 인구로 적용하지 않았다.
  Borgarnes의 두 원본 ID는 약 2.8km 떨어져 있어 기존 ID를 보류하고 다른 ID도 추가하지 않았다.
  Grindavík의 2024 재해 주석을 2026 무거주로 해석하지 않았다.
- **페로 제도:** Hagstova의 2026 village/municipality 표를 공식 검색 색인에서 구분해 읽었다.
  직접 연결 timeout을 명시하며 전문 다운로드나 snapshot hash 확보로 보고하지 않는다.
  Eystur는 여러 village를 묶은 municipality 표제어로 제외하고 Norðragøta·Leirvík 등 실제 village를 구분했다.
- **맨섬·건지·저지:** Isle of Man의 2025 settlement hierarchy와 지방정부의 실제 village 근거,
  Guernsey parish 지도/통계와 실제 town·village 설명, Jersey의 2025 built-up framework 및 공식 EIS를 대조했다.
  Forest Parish/Saint Pierre du Bois Parish는 행정 범위 표제어로 제외했다. 맨섬 3개·건지 4개는
  parish·교회 주변·실제 village 범위를 구분하지 못해 보류했다. Patrick Village는 공식 보호건물 명부
  검색 색인 근거이며 직접 응답의 Request Rejected 차단 화면은 snapshot 근거로 등록하지 않았다.
  저지 Saint Helier/Le Hocq의 실제 취락 이름을 parish/tower 범위와 구분했다.
- **스발바르·얀마옌:** SSB 2026 자료의 실제 Longyearbyen 정체를 유지했다.
  Ny-Ålesund와 합산된 인구는 단일 취락 인구로 적용하지 않았다. Olonkinbyen는 실제 기지 시설과
  일반 도시/취락 후보의 포함 범위 판단이 필요해 보류했다.

공간 대조는 기존 GISCO LAU 2024 경계를 재사용했다. 경계가 적용되는 1,018개 중 **1,009개는
같은 국가 LAU에 포함**됐고 NO 9개는 포함 결과가 없었다. AX 16개는 FI 경계 namespace를 사용했다.
FO/SJ/GG/IM/JE 53개에는 이 경계를 적용하지 않았다. LAU 포함만으로 실제 취락·정확한 대표점·
현행 행정 중심 역할을 확정하지 않는다. 국가 settlement 경계와 충돌하는 사례는 별도 보류했다.

필터 밖 제안은 같은 고정 원본에서 확인한 주요 누락 취락의 제한된 목록이다.
DK는 국가 통계 시가지 인구 1만 이상, NO는 5천 이상 표본을 SSR/지자체로 보강했다.
SE는 SCB 별도 tätort 인구 1만 이상 5개와 실제 centralort Svenstavik 1개를 제안했다.
FI는 개별 TA 취락/KU 지자체/LAU에 대응하는 cl 중심, 인구 1만 이상 취락 또는 지자체와 동명인
공식 parish village 208개와 별도 시 자료로 확인한 Espoo/Vantaa 2개를 제안했다.
복수 ID·복수 취락 코드·행정명 별칭이 모호한 필터 밖 18개는 연구 캐시에만 별도 기록했다.
AX는 municipality 전체 Finström과 구별되는 실제 Godby 마을 1개를 제안했다.
발트 3국은 국가 명부의 취락명·소속 및 주요 중심을 대조했고,
IS는 2026 urban nucleus 인구 500 이상, FO는 별도 village, JE는 공식 지방 중심 이름을 사용했다.
이 선택 기준을 전역 `candidate()` 정책에 추가하거나 제안을 정제본에 자동 포함하지 않았다.

직접 읽은 공식 XLSX/CSV/SHP/PDF/HTML/API 응답에는 SHA-256·바이트 수·캐시 경로를 기록했다.
전문 접근 실패로 공식 검색 색인만 사용한 자료는 `official-indexed-page/document`와 실패 이유를 명시했다.
기준일이 다른 통계를 2026 인구로 덮어쓰지 않았으며 차단 화면·실패 응답을 근거 hash로 등록하지 않았다.
연구 원본과 대조 자료는 ignored `.cache/northern-europe/`에 있고 기존 `review` 명령이
정제본·집계·아래 표를 생성한다. **지도 표시용 데이터 생성·연결은 아직 남아 있다.**

## 확인 한계와 다음 검토 묶음

앞의 세 묶음은 대표 문제 ID 검토이며, 네 번째부터 여덟 번째는 서유럽·중앙유럽·남유럽·동유럽·북유럽 후보의 1차 정체 검토이다.
전 세계 32,277개를 의미 단위로 확정한 작업은 아니다.
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

요청한 유럽 5개 권역의 기존 후보 1차 정체 검토를 마쳤다. 보류 ID와 포함 재검토 제안,
미검증 대표점·인구 범위·현행 행정 역할·rank/minZoom은 후속 검증 항목으로 유지한다.
동좌표/근접 ID 쌍은 병합 없이 개별 근거부터 확인한다.
이 검토 목록을 지도 런타임이나 검색 데이터에 연결하지 않는다.

<!-- geonames-statistics:start -->



## 재생성 가능한 ID별 검토 결과

검토 원본: `cities500` / SHA-256 `4ba815404241c08ca40a5dcdcfe35dee4ae51bb848bfff2c01d8ad35507ae232`.

| 항목 | 건수 |
| --- | --- |
| 1차 후보 (변경 없음) | 32277 |
| 누적 ID별 검토 | 10771 |
| 후보에서 확인 제외 | 190 |
| 후보에서 임시 보류 | 133 |
| 별도 정제 후보 | 31954 |
| 정제본 내 미검토 | 22734 |

정제본은 전 세계 검증 완료 목록이 아니다. 미검토 기록은 원래 후보 그대로 남는다.
`inclusion-review`는 필터 밖의 재검토 제안이며 정제본에 추가하지 않는다.

| country | baseline | refined | excluded | held |
| --- | --- | --- | --- | --- |
| AT | 30 | 29 | 1 | 0 |
| AX | 16 | 5 | 0 | 11 |
| BE | 27 | 26 | 1 | 0 |
| BG | 100 | 98 | 2 | 0 |
| BY | 117 | 115 | 0 | 2 |
| CH | 106 | 105 | 0 | 1 |
| CN | 670 | 666 | 3 | 1 |
| CZ | 23 | 21 | 2 | 0 |
| DE | 55 | 53 | 2 | 0 |
| DK | 101 | 97 | 2 | 2 |
| EE | 74 | 69 | 0 | 5 |
| ES | 87 | 82 | 3 | 2 |
| FI | 20 | 19 | 0 | 1 |
| FO | 18 | 17 | 1 | 0 |
| FR | 149 | 131 | 18 | 0 |
| GB | 298 | 275 | 17 | 6 |
| GG | 10 | 4 | 2 | 4 |
| GR | 54 | 53 | 1 | 0 |
| HR | 578 | 555 | 22 | 1 |
| IM | 21 | 18 | 0 | 3 |
| IT | 117 | 111 | 6 | 0 |
| JP | 865 | 854 | 9 | 2 |
| KR | 113 | 94 | 11 | 8 |
| LV | 85 | 84 | 1 | 0 |
| MK | 75 | 71 | 4 | 0 |
| MT | 63 | 60 | 0 | 3 |
| NL | 71 | 70 | 1 | 0 |
| NO | 382 | 367 | 1 | 14 |
| PL | 223 | 209 | 14 | 0 |
| PT | 258 | 253 | 0 | 5 |
| RO | 3029 | 2938 | 50 | 41 |
| RS | 26 | 25 | 1 | 0 |
| RU | 1956 | 1933 | 5 | 18 |
| SE | 291 | 289 | 1 | 1 |
| SJ | 2 | 1 | 0 | 1 |
| SK | 63 | 62 | 0 | 1 |
| UA | 252 | 249 | 3 | 0 |
| US | 3600 | 3595 | 5 | 0 |
| XK | 37 | 36 | 1 | 0 |

### ID별 판정 근거 보존

개별 ID별 판정표는 Markdown에 중복 기재하지 않습니다. 원본 판정·포함 여부·근거 및 증거 출처는 [검토 요약 JSON](candidate-review-summary.json)의 `reviewedRecords`와 `evidenceSources`, [판정 원장](candidate-reviews.json) 및 [수정 판정](candidate-review-overrides.json)에 보존되어 있습니다.

| 판정 | 검토 ID |
| --- | ---: |
| `exclude` | 191 |
| `hold` | 134 |
| `inclusion-review` | 1226 |
| `retain` | 9220 |

추가 검증이 필요하면 [정리 전 원문](https://github.com/kimjeon-il/Pando/blob/2dc675570d9da16381f80aca2607d817796a6ca3/reports/places/place-candidate-review.md)의 전체 ID별 테이블과 교차 확인할 수 있습니다. 해당 문서는 2026-10-03~04 기준 기록이며 이 압축으로 새 검증이 완료된 것은 아닙니다.

<!-- geonames-statistics:end -->
