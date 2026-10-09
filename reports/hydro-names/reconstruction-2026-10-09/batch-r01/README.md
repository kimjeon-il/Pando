# 호수 이름 재검증 r01

3개 대상의 새 근거와 독립 검토를 마쳤다. 일반화된 수역 동일성 지원 2건, 전체 형상의 이름 범위 보류 1건이다. 현재 제품 반영·자동 명명·한국어명 부여는 없다.

## 판정

- 1159109497 · MacKay Lake: 주요 서쪽 호수와 북동쪽 팔 모양 수역은 일치한다. 남서쪽 경계는 지도상 Lockhart River 표기를 가로지른다. 근처 Lockhart Lake 표기 중심은 모두 형상 밖에 있다. 남서쪽 연결 수역의 이름 범위가 미해결이므로 전체 형상에 하나의 이름을 부여하지 않는다. 두 호수가 합쳐졌다고 입증된 것은 아니다.
- 1159106899 · Becharof Lake: 일반화된 본체와 연결된 Island Arm의 동일성을 공식 사용례와 지도로 뒷받침한다. 섬 구멍과 상세 해안선은 생략된 형상이다. 현재 GNIS/BGN의 공식 명칭 판결을 확인했다는 뜻은 아니다.
- 1159107065 · Lac Tasiujaq: 현재 공원 사용명과 과거 Lac Guillaume-Delisle 지도명을 독립 DFO 문서로 연결했다. 바닷물과 담수가 섞이고 조수 영향을 받는 수역이며, Le Goulet 쪽 정확한 이름 경계와 공식 등록 결정은 미확인이다.

## 기하와 기준

원본 외곽선 173·104·105개 좌표, 합계382개(폐합점 포함)를 보존했다. 원천 source_id, 기준 FID/logicalFID, 전체 좌표 순서를 대조했고 기준 표시 형상은 같은 순서의 소수점6자리 양자화임을 확인했다. 독립 검토자가 원래 디코더로 재실행해 동일한 결과를 얻었다.

기준은 불변 커밋 fd6744f5e72a0c1a107452dbde6d416ab57237db와 hydrov0.13.1이다. 다시 읽은 입력 해시는 복구된2026-10-08 초기 인벤토리와 일치한다. 현재 라이브 배포는 확인하지 않았다. 잃어버린504건 상세 장부를 복구하거나 이번3건과 합산하지 않는다.

## 보존 내용과 권리

연구자가 작성한 사실 추출, 원문URL·발행기관·일자·취득해시, 좌표/등록 사실, 판정 한계, 독립검토와 검증기를 보존했다. 원문 취득 위치는 공식URL로 식별하며, 배포하지 않는 원문은 해시와 사실 추출만 보존했다.

selected geometry는 Natural Earth 공개영역 자료의 세 대상만 추출한 것이다. sources/becharof-fws-guide-use-areas-2012.pdf는 공식 미디어 페이지에서 이 정확한 파일에 Public Domain을 명시한2,153,038바이트 원본이다. source-publication-rights.json에 확인 근거가 있다. 그 외 캐나다 지도, HTML,26MB 신청서, 화면/지도 crop, 전체 입력 캐시는 배포 묶음에 넣지 않았다.

차단목록은 남은 기록에서 보수적으로 재구성한 일부이며 기존95개 전체 목록을 복구한 것이 아니다. 두 새403 출판물은 중단했고, 범위가 불명확한2016 명칭 발표는 요청하지 않았다. 별도 원문502/reader 오류도 증거에서 제외했다.

## 검증 실행

`python validate-geometry-reference.py`

`python review/validate-independent-review.py`

`python validate-package.py`

앞의 두 기본 검증은 보존된 선택 기하·자료 간 일관성을 검증한다. 원문 전체 입력과 외부 지도 파일을 다시 읽어 검증했다는 뜻은 아니다. 당시 전체 입력·원문 검토 결과와 해시는 별도 validation 파일에 기록되어 있다.

이 폴더의 연구 제출 파일에는 독립검토 전 상태 문구가 그대로 보존된다. 최종 범위 판정은 results.json과 review/independent-review.json을 우선한다. 공개 사본에서는 임시 저장 위치와 연구 결과에 불필요한 작업 정보만 제외했고, 관찰 사실·원문 해시·판정은 그대로 보존했다.

## 원문 출처

- [Mobile Core Bathurst Caribou Management Zone](https://www.gov.nt.ca/sites/ecc/files/resources/publication_text_fsu_caribou_management_zone_messaging_dec_18_2018.pdf)
- [Tursujuq](https://www.nunavikparks.ca/en/parks/tursujuq)
- [Règlementation sur la pêche dans les parcs nationaux du Nunavik: Parc national Tursujuq 2024–2025](https://nunavikparks.ca/assets/documents/Fishing_Tursujuq_2024_FR.pdf)
- [Recovery Strategy for the Harbour Seal, Lacs des Loups Marins subspecies (Phoca vitulina mellonae)](https://www.canada.ca/en/environment-climate-change/services/species-risk-public-registry/recovery-strategies/harbour-seal-lacs-loups-marins.html)
- [Becharof National Wildlife Refuge: About Us](https://www.fws.gov/refuge/becharof/about-us)
- [Guide Use Areas within Alaska Peninsula and Becharof NWRs](https://www.fws.gov/sites/default/files/documents/2024-04/3.pdf)
- [Egegik River & Becharof Lake System: RDI application](https://www.blm.gov/sites/default/files/docs/2025-08/AK_Egegik%20Becharof%20Ruth_App_12-28-17.pdf)
