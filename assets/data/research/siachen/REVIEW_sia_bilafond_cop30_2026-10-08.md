# 사이첸빙하 시아 라–빌라폰드 라 구간 지형검증

검토일: 2026-10-08  
브랜치: \`research/siachen-rgi7-outline\`  
판정: **지형 데이터 대조 완료 / AGPL 정밀 보정 미실시 / 기존 국경·실효지배 도형 변경 없음**

## 1. 입력 자료

- **Copernicus DEM GLO-30 Public**(2021 AWS COG): \`Copernicus_DSM_COG_10_N35_00_E076_00_DEM.tif\`, 약 30m 공간해상도, 표면고도 모델(DSM).
  - [공식 AWS 자료 소개](https://registry.opendata.aws/copernicus-dem/)
  - [Copernicus DEM 제품 안내](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
  - 사용 원본: https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N35_00_E076_00_DEM/Copernicus_DSM_COG_10_N35_00_E076_00_DEM.tif
  - 다운로드 입력 SHA-256: \`362c08afd374afb88ac380a34b3ac3536e750f2d339d259075f01e659073473f\` (40,237,865 byte).
  - 주요 측량원: TanDEM-X 2011~2015, 일부 과거 자료로 공백 보간. 관측 연도·고도 기준계가 다른 출처와 완전히 일치하지 않으므로 현재의 현장 측량으로 간주하지 않는다.
- **OSM AGPL 근사선:** OpenStreetMap relation 13559521, 2026-10-04 스냅샷을 바탕으로 공개 재구성한 190점 LineString. [출처](https://www.openstreetmap.org/relation/13559521) / [자료 파일](siachen_agpl_osm_candidate.geojson). ODbL 1.0.
- **빙하 비교자료:** RGI 7.0 \`RGI2000-v7.0-G-14-20040\` (2002-07-10 촬영·관측일), [자료 파일](siachen_glacier_rgi7.geojson).
- **통로 위치:** [Sia La / OSM](https://mapcarta.com/14675508), [Sia La / Wikipedia](https://en.wikipedia.org/wiki/Sia_La), [Sia La / Getty TGN/NGA](https://www.getty.edu/vow/TGNFullDisplay?subjectid=7923170), [Bilafond La / OSM](https://mapcarta.com/14710602), [Bilafond La / Getty TGN/NGA](https://www.getty.edu/vow/TGNFullDisplay?subjectid=7902300).
- **지리·군사적 기본 상황:** [CNES 2020 Sentinel-2 위성사진 분석](https://cnes.fr/geoimage/pakistan-inde-chine-massif-k2-glacier-siachen-conflits-frontaliers-affrontements-militaires-toit). CNES가 표현한 전선 또한 *대략적인 구역 구분*이며 군사 진지·분계선의 측량자료가 아니다.

## 2. 방법과 검증

1. Copernicus GLO-30의 35°N, 76°E 타일을 공개 AWS에서 직접 확보했다.
2. \`76.690–76.996°E, 35.356–35.622°N\`의 부분을 읽고 UTM Zone 43N의 30m 격자로 재투영했다. 1001×944셀, 유효자료 약 96.43%. 고도값 범위 약 3,790~7,731m.
3. 시아 라와 빌라폰드 라 사이 **OSM 후보선 길이 약 40.12km**를 250m 간격으로 표본화(161개).
4. 각 표본점에서 OSM 선의 진행방향에 수직인 **양쪽 1km 지형단면**을 DEM에서 추출한 뒤 약 50m 수준으로 평활화했다.
5. OSM 중심선과 수직방향 ±900m 내 최고점의 수평거리·고도차를 계산했다. **이는 능선 본선의 확정 추출이 아니라, 단면에서 가까운 가장 높은 위치를 탐색하는 참고 지표**다. 통로는 안부이므로 산봉우리와 혼동하면 안 된다.

## 3. 시아 라~빌라폰드 라 구간 결과

| 단면 최고점과 OSM AGPL 후보선의 관계 | 결과 |
|---|---:|
| 분석한 OSM 선 길이 | 약 40.12km |
| 표본 수 / 간격 | 161개 / 250m |
| 수직 단면 내 최고점과 OSM 선의 수평거리 중위값 | **70m** |
| 단면 최고점이 OSM 선 150m 이내 | **73.9%** |
| 단면 최고점이 OSM 선 300m 이내 | **83.2%** |
| 수평거리 절댓값 90백분위수 | **740m** |
| OSM 선보다 단면 최고점이 100m 이상 높은 표본 | **6.2% (10개)** |
| OSM 선과 단면 최고점의 고도 차 중위값 | **8.9m** |

**해석:** 지형의 국소 고점과 대략적으로 함께 움직이는 구간이 많음. 그러나 고점이 500~900m 떨어진 구간도 있으므로, OSM 선이 *항상* 산악 분수계를 정확하게 따른다고 판단하면 안 된다. 높은 지점은 사면 건너편의 별도 봉우리일 수도 있다. 수치만으로 AGPL의 공식·군사적 정확도를 검증하지 못한다.

## 4. 통로 좌표의 비교

| 자료 | 점 위치 (경도E, 위도N) | DEM 높이 | 가장 가까운 OSM 선까지 거리 | 선의 측면 |
|---|---|---:|---:|---|
| 시아 라 OSM / Mapcarta | (76.79081, 35.58123) | 5,591.5m | 207.4m | 파키스탄측(서쪽) |
| 시아 라 Wikipedia | (76.79250, 35.58194) | 5,590.1m | **95.9m** | 파키스탄측(서쪽) |
| 시아 라 Getty/NGA | (76.78760, 35.59040) | 5,847.0m | 283.0m | 파키스탄측(서쪽) |
| 빌라폰드 라 OSM / Mapcarta | (76.94873, 35.39186) | 5,457.1m | **34.8m** | 인도측(동쪽) |
| 빌라폰드 라 Getty/NGA | (76.94860, 35.39220) | 5,457.2m | 42.7m | 인도측(동쪽) |

- 시아 라 Wikipedia의 표기 고도 **5,589m**와 DEM 계산 **5,590m**가 매우 근접한다(우연·기준계 차이 등을 고려할 것). 이는 해당 좌표의 지형적 정합성을 뒷받침하지만 절대 위치를 측량한 증명은 아니다.
- 시아 라 Mapcarta의 표기 고도 **5,803m**는 실제 해당 표기 좌표에서의 DEM **5,591.5m**와 약 **211.5m 차이**다. 지명 점·고도 속성의 혼동 가능성이 있어 이 수치를 지형 기준점으로 삼지 않는다.
- 시아 라 Getty/NGA 좌표는 앞의 OSM/Wikipedia 지점과 약 1km 떨어져 있으며 그곳의 DEM 고도도 달라, 같은 안부를 가리키는지 추가 확인이 필요하다.
- 빌라폰드 라의 두 지명 점은 서로 가깝고, 공개 고도 5,450m와 DEM 값 차이는 약 7m로 상대적으로 잘 맞는다.
- 공개 문헌과 CNES는 두 주요 고지 통로의 인도 측 실효통제를 설명하지만, **지명 점의 위치는 군사 진지 또는 공식 국경의 좌표가 아니다.** OSM 선이 시아 라 표지점을 서측에 놓는 문제는 미해결이다.

## 5. 주요 추가 검토 구간

수직 지형단면의 최고점이 OSM 선에서 500m 넘게 떨어지거나 최고점 대비 OSM 선이 100m 이상 낮은 연속 구간:

| AGPL 남쪽 기점으로부터 거리 | 대표 위치 | 의미 |
|---|---|---|
| 약 61.0~63.0km | (76.932°E, 35.399°N) | 빌라폰드 라 북쪽 약 1~3km 구간에서 단면 최고점이 대체로 동쪽 수백m, 최대 고도차 약 232m |
| 약 67.5~67.8km | (76.877°E, 35.387°N) | 단면 최고점이 동쪽 약 400~600m, 최대 고도차 약 111m |
| 약 79.3~80.0km | (76.815°E, 35.462°N) | 국소 고점이 동쪽 약 800~900m이나 고도차는 비교적 작음 |
| 약 90.5~91.0km | (76.758°E, 35.523°N) | 단면 최고점이 동쪽 약 900m, 최대 고도차 약 111m |
| 약 99.3~99.5km | (76.785°E, 35.577°N) | 시아 라 남쪽에서 단면 고점이 동쪽으로 이동 |

※ AGPL 거리는 115km 전체 후보선의 남쪽 시작점부터의 누적 거리이며, 검토 대상 40.12km 구간의 시작점은 약 **60.288km**다. 해당 목록은 **수정 우선순위**가 아니라 지형 단면 재검토 지점이다.

## 6. 판단 및 다음 단계

**판정 A — 재현 가능한 지형 검토 완료:** 원본 DEM 확보, SHA-256 기록, 30m 재투영, 161개 단면, 주요 안부 고도대조, 음영기복·등고선·단면도 생성에 성공했다.

**판정 B — 현 AGPL의 법적·군사적 정밀도 검증 불가:** 공개 선의 상당 부분이 높은 지형에 근접해 있으나, 산악 지형과 군사 통제선은 별개이며 정확한 진지 배치가 확인되지 않는다. 고도 단면의 지역 최고점을 연결해 영토 경계로 삼는 방법은 오류 위험이 크다.

**판정 C — 경계 이동 보류:** 시아 라의 OSM 후보선이 주요 공개 안부 표지를 인도측에 두지 않는 문제는 남지만, GeoJSON을 임의로 서쪽으로 96m 혹은 207m 평행이동하면 능선의 구조·다른 산악 통로·국지적 지배권을 왜곡할 수 있다. 위성 정사영상과 지형분수계/산봉우리 및 실제 통로 위치 자료를 추가 확보하기 전까지 **원본 AGPL 유지**.

**후속 작업 후보:** CNES의 지리정보가 부여된 Sentinel-2 영상 혹은 같은 좌표계의 광학 영상에서 시아 라 및 빌라폰드 라의 실제 안부를 확인한 뒤, OSM 선과 측면 거리를 재측정한다. 국경선 자체는 별도 독립출처 없이 DEM 고점만으로 수정하지 않는다.

## 7. 생성한 결과 파일

- [정량 검증 JSON](sia_bilafond_dem_comparison.json)
- [표본점과 지명·AGPL 오버레이 GeoJSON](sia_bilafond_dem_samples.geojson)
- [Copernicus 30m 음영기복 + OSM AGPL + 지형표지](sia_bilafond_cop30_relief.png)
- [시아 라 단면도](sia_bilafond_sia_osm_transect.png)
- [빌라폰드 라 단면도](sia_bilafond_bila_osm_transect.png)
- [재현용 Python 추출 및 계산 코드](../../../scripts/research/siachen/compare_cop30_sia_bilafond.py) — 참고: 실제 GitHub 경로는 \`scripts/research/siachen/\`.

규칙: 출력은 모두 조사 브랜치의 연구용 참고자료. **메인 국가 데이터·AGPL GeoJSON·RGI 얼음 외곽선·인도/파키스탄 귀속 GeoJSON은 변경하지 않았다.**
