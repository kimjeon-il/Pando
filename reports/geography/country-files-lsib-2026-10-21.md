# 국가별 원본 분리와 LSIB 11.4 육상 국경 보충

> 보고서 ID: `GEO-WORLD-20261021` · 상태: `implemented-partially / provisional` · 지도 반영: `work-gis-only` · 색인일: 2026-10-21  
> 조사·수정 기준: `work/gis`, 원본 커밋 `4c7f30453fc5de61efd1ab0fb03d7fdaa92fe3a7`  
> Web/App 공통 라이브러리 자료 수정. main 병합·push·배포 및 앱 실행파일 빌드 없음.

## 대상과 기준일

국가·지역 객체 281개를 각각 `source/countries/state-*.json`으로 분리했다. 이름·존속기간·날짜별 형상은 해당 객체가 소유한다. 
계보 262개는 `source/lineages/`의 참조 전용 schema 2 파일이다. `source/views/world.json`은 258개 객체/버전의 표시 선택 목록이며 공통 기준일이 없다. 
날짜 없는 가져오기는 객체에 명시한 대표 버전을 사용하고 `sourceReferenceDate: null`을 기록한다. 날짜를 지정하면 해당 객체의 기간으로만 조회한다. 
역사 뷰어의 날짜 있는 출력 쿼리는 별도 `historical-publication.recipe.json`에 둔다. 출력 날짜를 전 세계 관측일이나 국가 수립일로 사용하지 않는다.

LSIB 11.4 발행일은 2025-02-24이다. 이 날짜는 각 경계의 법적 효력일이나 현지 관측일로 확정되지 않았다. 날짜가 있는 역사 형상을 현대 LSIB로 교체하지 않았다.

## 근거와 방법

- 원본: [미 국무부 LSIB 공식 목록](https://geodata.state.gov/geonetwork/srv/api/records/3bdb81a0-c1b9-439a-a0b1-85dac30c59b2), [공식 배포 ZIP](https://data.geodata.state.gov/LSIB.zip). 미국 정부 관점의 자료이며 법적·역사적 정답을 보증하지 않는다.
- 원본 395개 벡터와 전체 속성은 `tools/historical-library/sources/lsib-11.4/boundaries.geojson.gz`에 별도 보존했다. 43,179,013 bytes. 원본 ZIP/SHP/DBF/master 해시와 권리·판본은 같은 폴더의 `provenance.json`, upstream README/XML에 기록했다.
- 분쟁 보호 근거: [Natural Earth v5.1.1](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.1/10m_cultural)의 분쟁선과 0.15도 주변 구간, 별도로 지정한 보호 국가 쌍. 이 완충은 보수적인 제외 규칙이며 분쟁의 정확한 범위 판정이 아니다.
- 기존 공유 경계와 LSIB가 실제 교차하는 지점 사이만 양쪽 국가에 동일하게 적용했다. 해안 접점이나 삼합점을 임의의 직선으로 연결하지 않았다. 교차점 밖의 옛 끝부분은 유지했다.
- 후보 위상 검토는 Shapely, 최종 제품 형상 정규화는 기존 C++ 계산 코어를 사용했다. 별도의 런타임 형상 소유자는 추가하지 않았다.
- 원본 좌표는 보존하고 표시 파생본만 0.0004도 허용치로 단순화했다. 고배율 기준은 2560 CSS px, flatZoom=64이다.

## 확인 결과와 한계

- 현대 객체 **137개**, 국가 쌍 **230개**, 구간 **243개**를 부분 보충했다. 완전 교체로 표시하지 않는다. 전부 보류한 목록은 **198항목**이다. 같은 국가 쌍에 여러 LSIB 선이 있어 항목 수와 고유 국가 쌍 수는 다를 수 있다.
- 원본 대비 281개 객체의 ID·존속기간·버전 ID 유지, 역사 버전 41개 형상 동일, 그 외 144개 객체 형상 동일을 확인했다. 현대 변경 폴리곤 유효성과 전역 미공유 변 집합 동일을 확인해 해안선 변경·공유선 단절을 검사했다.
- 실제 보충한 243개 구간을 상세 LSIB 원본과 양방향 비교했다. 표본 5,893,626개, 표본 최대 0.182045 CSS px, 연속 선분의 편차 상한 **0.409600 CSS px**이다. 0.001도 이하 표본 간격의 절반을 오차 상한에 더했다.
- 이 수치는 **교차점 사이에 보충한 구간의 원본 대비 단순화 편차**이다. 남긴 옛 끝부분, 교체하지 않은 경계, 실제 지상 국경의 정확도, 독립적인 역사 경계의 0.5px 충족을 검증한 수치가 아니다.
- 모든 해안선·섬 외곽과 기존 영유권 배정은 유지했다. 쿠릴·독도·센카쿠·대만·포클랜드 등 해상/도서 영유권은 이번 육상선 보충으로 변경되지 않는다. 하중도·공동 주권·분리선은 별도 검토가 필요하다.
- 새 자료 위치 수는 1,100,074개다. canonical packet 생성 예산은 기존 decoded 10/compressed 5.5 MiB에서 24/13 MiB로 조정했다. 실제 gzip packet은 12,612,625 bytes다. 전송 형식은 같지만 자료량·메모리 부담이 증가했다. 기기 성능 측정은 하지 않았다.

## 데이터 반영과 검증

국가 원본·참조 계보·명시적 표시 목록, 재생성 도구, 편집·독립 게시 경로와 관련 테스트를 함께 변경했다. 원본 Natural Earth 파일은 유지했다. 자세한 검증 상태는 아래 최종 실행 기록을 참고한다.

- [보류 및 부분 보충 전체 목록 JSON](diagnostics/country-files-lsib-inventory-2026-10-21.json)
- [원본·역사·해안·공유선 무결성 검사](diagnostics/country-files-lsib-integrity-2026-10-21.json)
- [보충 구간 고배율 편차 검사](diagnostics/country-files-lsib-screen-2026-10-21.json)

## 최종 실행 기록

| 범위 | 결과와 한계 |
| --- | --- |
| 객체 분리·참조·대표 가져오기·편집 저장·private source materialization·native JS transport | 관련 unit 49개. 첫 실행의 3건 실패를 수정하고 해당 15개만 재실행해 통과. 실제 Rust/WebView 실행은 하지 않음 |
| 직접 source 소비자와 해안·폴리곤 회귀 | 관련 unit 34개 통과 |
| 파생 packet·전국 chunk·공유선 일치 | 관련 unit 10개. 자료 개수·snapshot 계약 변경 2건 수정 후 해당 2개만 재실행해 통과. 원본/source packet Float64 동일, 공유선 전 구간 동일 |
| inspection / source 이름·국기 독립 게시 반영 | inspection unit 10개 통과, 실제 historical compiler를 사용한 publication metadata unit 1개 통과 |
| Python source 소비자 | 15개 중 기존 Web/editor 구분 기대 1건 수정 후 해당 1개 재실행 통과 |
| LSIB 접합·쌍방 경계·분쟁 제외 | Python unit 5개 통과. 미세한 부동소수점 접합점 중복을 수정하고 재검증함 |
| 브라우저 편집 흐름 | 실제 Chromium에서 대표 선택·저장·재로드·날짜 없는 가져오기 및 기존 이름·날짜 undo/redo·재로드 2개 통과. mock native 저장소이며 실제 OS 연결 검증과 다름 |
| 공개 Web 뷰어 | 재생성한 역사 프로젝트 준비 완료와 남북한 존속기간 확인 1개 통과, pageerror 없음 |
| 정적 검사·데이터 산출물 | 변경 JS ESLint 통과, chunk freshness / world bundle digest·size / version metadata 검사 통과, 한국 재생성 도구 --check 통과 |
| 재생성 | source chunks, current world, historical project, world mesh/preview/bundle/shared lines 및 prepared meshes 생성. prepared 337개 중 176개 재사용. 앱 실행파일은 빌드하지 않음 |
| 검토 | 독립 read-only reviewer 1회. 과거 embedded lineage recipe와 workflow 소비자 및 lineage schema 생성 문제 수정. 별도 에이전트 검사·전체 suite 없음 |

원시 실행 로그는 로컬 `build-native/lsib-supplement/`에 보존했다. 초기 실패를 통과로 집계하지 않으며 위 표는 수정 후 해당 범위의 결과다. pnpm 실행이 의존성 재설치를 시도하다 TTY 조건에서 중단되어, 설치 없이 기존 Node CLI로 브라우저 검사를 실행했다.

기하 검사를 재현할 때 보존한 inventory JSON을 `--candidate`에 전달할 수 있다. 무결성 도구는 `--base 4c7f30453fc5de61efd1ab0fb03d7fdaa92fe3a7`, 화면 편차 도구는 `--archive <보존 ZIP>`과 `--output <진단 경로>`를 요구한다. ZIP 해시는 provenance에 고정했다. 부분 진단은 `--pair AFG/CHN`처럼 지정한다.

## 전부 보류한 경계

아래 목록의 분쟁·보호는 기하 자동 교체를 하지 않았다는 뜻이다. 각 국가 쌍의 법적 지위를 새로 확정하지 않는다. 코드가 다른 팔레스타인/남수단/서사하라 등의 항목도 원본 코드를 유지했다.

| 국가·지역 쌍 | 보류 사유 | 구간별 세부 사유 |
| --- | --- | --- |
| 아프가니스탄 (AFG) / 파키스탄 (PAK) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 알바니아 (ALB) / 코소보 (KOS) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 안도라 (AND) / 프랑스 (FRA) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 아랍에미리트 (ARE) / 사우디아라비아 (SAU) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 아르헨티나 (ARG) / 브라질섬 (BRI) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 아르헨티나 (ARG) / 파라과이 (PRY) | 하중도 귀속 별도 검토 필요 | — |
| 아르헨티나 (ARG) / 남부파타고니아빙원 (SPI) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 아르헨티나 (ARG) / 우루과이 (URY) | 하중도 귀속 별도 검토 필요 | — |
| 아르메니아 (ARM) / 아제르바이잔 (AZE) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 아르메니아 (ARM) / 이란 (IRN) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 오스트리아 (AUT) / 리히텐슈타인 (LIE) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 아제르바이잔 (AZE) / 이란 (IRN) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 부룬디 (BDI) / 콩고 민주 공화국 (COD) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 부르키나파소 (BFA) / 가나 (GHA) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 벨리즈 (BLZ) / 과테말라 (GTM) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 벨리즈 (BLZ) / 멕시코 (MEX) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 브라질 (BRA) / 브라질섬 (BRI) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 브라질 (BRA) / 프랑스 (FRA) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 브라질 (BRA) / 가이아나 (GUY) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 브라질 (BRA) / 페루 (PER) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 브라질 (BRA) / 수리남 (SUR) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 브라질 (BRA) / 우루과이 (URY) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 브라질섬 (BRI) / 우루과이 (URY) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 비르타윌 (BRT) / 이집트 (EGY) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 비르타윌 (BRT) / 수단 (SDN) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 부탄 (BTN) / 중화인민공화국 (CHN) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 부탄 (BTN) / 인도 (IND) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 중앙아프리카 공화국 (CAF) / 수단 (SDN) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 중앙아프리카 공화국 (CAF) / 남수단 (SDS) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 칠레 (CHL) / 남부파타고니아빙원 (SPI) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 중화인민공화국 (CHN) / 홍콩 (HKG) | 특수 경계·분리선 | — |
| 중화인민공화국 (CHN) / 인도 (IND) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 중화인민공화국 (CHN) / 시아첸빙하 (KAS) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 중화인민공화국 (CHN) / 네팔 (NPL) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 중화인민공화국 (CHN) / 파키스탄 (PAK) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 중화인민공화국 (CHN) / 조선민주주의인민공화국 (PRK) | 기존 날짜별 역사 형상 보호 | — |
| 코트디부아르 (CIV) / 라이베리아 (LBR) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 유엔 키프로스 완충 지대 (CNM) / 북키프로스 (CYN) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 유엔 키프로스 완충 지대 (CNM) / 키프로스 (CYP) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 유엔 키프로스 완충 지대 (CNM) / 데켈리아 (ESB) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 콩고 민주 공화국 (COD) / 남수단 (SDS) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 콩고 민주 공화국 (COD) / 탄자니아 (TZA) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 쿠바 (CUB) / 관타나모만 해군 기지 (USG) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 북키프로스 (CYN) / 데켈리아 (ESB) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 키프로스 (CYP) / 데켈리아 (ESB) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 키프로스 (CYP) / 아크로티리 (WSB) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 독일 (DEU) / 룩셈부르크 (LUX) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 지부티 (DJI) / 소말릴란드 (SOL) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 알제리 (DZA) / 모로코 (MAR) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 알제리 (DZA) / 모리타니 (MRT) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 알제리 (DZA) / 서사하라 (SAH) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 이집트 (EGY) / 이스라엘 (ISR) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 이집트 (EGY) / 팔레스타인 (PSX) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 이집트 (EGY) / 수단 (SDN) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 에스파냐 (ESP) / 지브롤터 (GIB) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 에스파냐 (ESP) / 포르투갈 (PRT) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 에스토니아 (EST) / 라트비아 (LVA) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 에티오피아 (ETH) / 남수단 (SDS) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 에티오피아 (ETH) / 소말릴란드 (SOL) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 에티오피아 (ETH) / 소말리아 (SOM) | 특수 경계·분리선 | — |
| 핀란드 (FIN) / 스웨덴 (SWE) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 프랑스 (FRA) / 모나코 (MCO) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 프랑스 (FRA) / 수리남 (SUR) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 조지아 (GEO) / 러시아 (RUS) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 가나 (GHA) / 토고 (TGO) | 안전한 접합·위상 조건 미충족 | Candidate country polygon invalid |
| 과테말라 (GTM) / 온두라스 (HND) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 가이아나 (GUY) / 수리남 (SUR) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 크로아티아 (HRV) / 세르비아 (SRB) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 크로아티아 (HRV) / 슬로베니아 (SVN) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 인도 (IND) / 시아첸빙하 (KAS) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 인도 (IND) / 미얀마 (MMR) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 인도 (IND) / 네팔 (NPL) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 인도 (IND) / 파키스탄 (PAK) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 이라크 (IRQ) / 쿠웨이트 (KWT) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 이스라엘 (ISR) / 요르단 (JOR) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 이스라엘 (ISR) / 레바논 (LBN) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 이스라엘 (ISR) / 팔레스타인 (PSX) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 이스라엘 (ISR) / 시리아 (SYR) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 이탈리아 (ITA) / 산마리노 (SMR) | 안전한 접합·위상 조건 미충족 | Closed enclave chain requires separate ownership review |
| 이탈리아 (ITA) / 바티칸 시국 (VAT) | 안전한 접합·위상 조건 미충족 | Closed enclave chain requires separate ownership review |
| 요르단 (JOR) / 팔레스타인 (PSX) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 요르단 (JOR) / 시리아 (SYR) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 바이코누르 (KAB) / 카자흐스탄 (KAZ) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 시아첸빙하 (KAS) / 파키스탄 (PAK) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 케냐 (KEN) / 남수단 (SDS) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 케냐 (KEN) / 소말리아 (SOM) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 대한민국 (KOR) / 조선민주주의인민공화국 (PRK) | 기존 날짜별 역사 형상 보호 | — |
| 코소보 (KOS) / 북마케도니아 (MKD) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 코소보 (KOS) / 몬테네그로 (MNE) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 코소보 (KOS) / 세르비아 (SRB) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 쿠웨이트 (KWT) / 사우디아라비아 (SAU) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 레바논 (LBN) / 시리아 (SYR) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 리비아 (LBY) / 차드 (TCD) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 리비아 (LBY) / 튀니지 (TUN) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 레소토 (LSO) / 남아프리카 공화국 (ZAF) | 안전한 접합·위상 조건 미충족 | Closed enclave chain requires separate ownership review |
| 생마르탱 (MAF) / 신트마르턴 (SXM) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 모로코 (MAR) / 서사하라 (SAH) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 몰도바 (MDA) / 우크라이나 (UKR) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 말리 (MLI) / 니제르 (NER) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 모리타니 (MRT) / 서사하라 (SAH) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 말레이시아 (MYS) / 태국 (THA) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 나이지리아 (NGA) / 차드 (TCD) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 오만 (OMN) / 사우디아라비아 (SAU) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 오만 (OMN) / 예멘 (YEM) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 조선민주주의인민공화국 (PRK) / 러시아 (RUS) | 기존 날짜별 역사 형상 보호 | — |
| 카타르 (QAT) / 사우디아라비아 (SAU) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 러시아 (RUS) / 우크라이나 (UKR) | 분쟁선 인접 또는 명시적 보호 쌍 | — |
| 르완다 (RWA) / 우간다 (UGA) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 수단 (SDN) / 남수단 (SDS) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 남수단 (SDS) / 우간다 (UGA) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 소말릴란드 (SOL) / 소말리아 (SOM) | 기존 국가 코드 쌍과 LSIB 불일치 | — |
| 투르크메니스탄 (TKM) / 우즈베키스탄 (UZB) | 안전한 접합·위상 조건 미충족 | No safe intersection anchors; old chain retained |
| 키프로스 (CYP) / XQZ (XQZ) | 기존 공유 경계와 대응하지 않음 | — |
| 알바니아 (ALB) / XKS (XKS) | 기존 공유 경계와 대응하지 않음 | — |
| 아르헨티나 (ARG) / XQP (XQP) | 기존 공유 경계와 대응하지 않음 | — |
| 바레인 (BHR) / 사우디아라비아 (SAU) | 기존 공유 경계와 대응하지 않음 | — |
| 벨기에 (BEL) / QX2 (QX2) | 기존 공유 경계와 대응하지 않음 | — |
| 보츠와나 (BWA) / 잠비아 (ZMB) | 기존 공유 경계와 대응하지 않음 | — |
| 브라질 (BRA) / GUF (GUF) | 기존 공유 경계와 대응하지 않음 | — |
| 중앙아프리카 공화국 (CAF) / SSD (SSD) | 기존 공유 경계와 대응하지 않음 | — |
| 중화인민공화국 (CHN) / XXO (XXO) | 기존 공유 경계와 대응하지 않음 | — |
| 중화인민공화국 (CHN) / XSQ (XSQ) | 기존 공유 경계와 대응하지 않음 | — |
| 콩고 민주 공화국 (COD) / SSD (SSD) | 기존 공유 경계와 대응하지 않음 | — |
| 키프로스 (CYP) / XXD (XXD) | 기존 공유 경계와 대응하지 않음 | — |
| 덴마크 (DNK) / 스웨덴 (SWE) | 기존 공유 경계와 대응하지 않음 | — |
| 지부티 (DJI) / 소말리아 (SOM) | 기존 공유 경계와 대응하지 않음 | — |
| 이집트 (EGY) / 이집트 (EGY) | 기존 공유 경계와 대응하지 않음 | — |
| 이집트 (EGY) / XGZ (XGZ) | 기존 공유 경계와 대응하지 않음 | — |
| 에티오피아 (ETH) / SSD (SSD) | 기존 공유 경계와 대응하지 않음 | — |
| 프랑스 (FRA) / QX2 (QX2) | 기존 공유 경계와 대응하지 않음 | — |
| GUF (GUF) / 수리남 (SUR) | 기존 공유 경계와 대응하지 않음 | — |
| 독일 (DEU) / QX2 (QX2) | 불확실한 귀속·공동 주권 | — |
| 케냐 (KEN) / SSD (SSD) | 기존 공유 경계와 대응하지 않음 | — |
| 몬테네그로 (MNE) / XKS (XKS) | 기존 공유 경계와 대응하지 않음 | — |
| 북마케도니아 (MKD) / XKS (XKS) | 기존 공유 경계와 대응하지 않음 | — |
| 세르비아 (SRB) / XKS (XKS) | 기존 공유 경계와 대응하지 않음 | — |
| 룩셈부르크 (LUX) / QX2 (QX2) | 불확실한 귀속·공동 주권 | — |
| 말레이시아 (MYS) / 싱가포르 (SGP) | 기존 공유 경계와 대응하지 않음 | — |
| 모로코 (MAR) / 모리타니 (MRT) | 기존 공유 경계와 대응하지 않음 | — |
| SSD (SSD) / XQN (XQN) | 기존 공유 경계와 대응하지 않음 | — |
| 수단 (SDN) / SSD (SSD) | 기존 공유 경계와 대응하지 않음 | — |
| SSD (SSD) / 우간다 (UGA) | 기존 공유 경계와 대응하지 않음 | — |
| 수단 (SDN) / 수단 (SDN) | 기존 공유 경계와 대응하지 않음 | — |
| 베냉 (BEN) / XXX (XXX) | 특수 경계·분리선 | Burkina Faso Claim |
| 부탄 (BTN) / XQY (XQY) | 특수 경계·분리선 | China Claim |
| 브라질 (BRA) / XQP (XQP) | 특수 경계·분리선 | Uruguay Claim |
| 부르키나파소 (BFA) / XXX (XXX) | 특수 경계·분리선 | Benin Claim |
| 중화인민공화국 (CHN) / XQO (XQO) | 특수 경계·분리선 | India Claim |
| 중화인민공화국 (CHN) / XQO (XQO) | 특수 경계·분리선 | Line of Actual Control |
| 중화인민공화국 (CHN) / XQO (XQO) | 특수 경계·분리선 | Line of Actual Control |
| 중화인민공화국 (CHN) / XQO (XQO) | 특수 경계·분리선 | Line of Actual Control |
| 중화인민공화국 (CHN) / XQO (XQO) | 특수 경계·분리선 | India Claim |
| 중화인민공화국 (CHN) / XQY (XQY) | 특수 경계·분리선 | Bhutan Claim |
| 중화인민공화국 (CHN) / XQO (XQO) | 특수 경계·분리선 | Line of Actual Control |
| 중화인민공화국 (CHN) / XQO (XQO) | 특수 경계·분리선 | Line of Actual Control |
| 중화인민공화국 (CHN) / XQO (XQO) | 특수 경계·분리선 | Line of Actual Control |
| 중화인민공화국 (CHN) / 마카오 (MAC) | 특수 경계·분리선 | — |
| 중화인민공화국 (CHN) / XQO (XQO) | 특수 경계·분리선 | Line of Actual Control |
| 콩고 민주 공화국 (COD) / XQR (XQR) | 특수 경계·분리선 | — |
| 콩고 공화국 (COG) / XQR (XQR) | 특수 경계·분리선 | — |
| 프랑스 (FRA) / QX2 (QX2) | 특수 경계·분리선 | Italy claim |
| 이스라엘 (ISR) / XGZ (XGZ) | 특수 경계·분리선 | 1950 Armistice Line |
| 인도 (IND) / XQO (XQO) | 특수 경계·분리선 | Line of Actual Control |
| 인도 (IND) / XQO (XQO) | 특수 경계·분리선 | China Claim |
| 인도 (IND) / XQO (XQO) | 특수 경계·분리선 | China Claim |
| 인도 (IND) / XQO (XQO) | 특수 경계·분리선 | China Claim |
| 인도 (IND) / XQO (XQO) | 특수 경계·분리선 | Line of Actual Control |
| 인도 (IND) / XQO (XQO) | 특수 경계·분리선 | China Claim |
| 인도 (IND) / XXO (XXO) | 특수 경계·분리선 | Nepal Claim |
| 인도 (IND) / XQO (XQO) | 특수 경계·분리선 | China Claim |
| 인도 (IND) / XQO (XQO) | 특수 경계·분리선 | China Claim |
| 인도 (IND) / XQO (XQO) | 특수 경계·분리선 | China Claim |
| 이스라엘 (ISR) / QX4 (QX4) | 특수 경계·분리선 | 1949 Armistice Line |
| 이스라엘 (ISR) / XWB (XWB) | 특수 경계·분리선 | 1949 Armistice Line |
| 이탈리아 (ITA) / QX2 (QX2) | 특수 경계·분리선 | France claim |
| 요르단 (JOR) / XWB (XWB) | 특수 경계·분리선 | 1994 Treaty Line |
| 케냐 (KEN) / 케냐 (KEN) | 특수 경계·분리선 | Provisional Boundary |
| 케냐 (KEN) / SSD (SSD) | 특수 경계·분리선 | Administrative Boundary |
| 키르기스스탄 (KGZ) / QX2 (QX2) | 특수 경계·분리선 | — |
| 키르기스스탄 (KGZ) / QX2 (QX2) | 특수 경계·분리선 | Tajikistan Claim |
| 키르기스스탄 (KGZ) / QX2 (QX2) | 특수 경계·분리선 | — |
| 네팔 (NPL) / XXO (XXO) | 특수 경계·분리선 | Line of Control |
| SSD (SSD) / SSD (SSD) | 특수 경계·분리선 | Provisional Boundary |
| QX2 (QX2) / 타지키스탄 (TJK) | 특수 경계·분리선 | — |
| QX2 (QX2) / 타지키스탄 (TJK) | 특수 경계·분리선 | Kyrgyzstan Claim |
| QX2 (QX2) / 타지키스탄 (TJK) | 특수 경계·분리선 | — |
| 우루과이 (URY) / XQP (XQP) | 특수 경계·분리선 | Brazil Claim |
| 쿠바 (CUB) / 쿠바 (CUB) | 특수 경계·분리선 | — |
| 이스라엘 (ISR) / 이스라엘 (ISR) | 특수 경계·분리선 | UNDOF Line A-1 |
| 조선민주주의인민공화국 (PRK) / QX2 (QX2) | 특수 경계·분리선 | — |
| 조선민주주의인민공화국 (PRK) / 조선민주주의인민공화국 (PRK) | 특수 경계·분리선 | DMZ |
| 대한민국 (KOR) / QX2 (QX2) | 특수 경계·분리선 | — |
| 대한민국 (KOR) / 대한민국 (KOR) | 특수 경계·분리선 | DMZ |
| 수단 (SDN) / XQN (XQN) | 특수 경계·분리선 | — |
| 시리아 (SYR) / 시리아 (SYR) | 특수 경계·분리선 | UNDOF Line B |
| QX4 (QX4) / XWB (XWB) | 특수 경계·분리선 | 1949 Armistice Line |
| QX4 (QX4) / XWB (XWB) | 특수 경계·분리선 | 1949 Armistice Line DMZ |
| XWB (XWB) / XWB (XWB) | 특수 경계·분리선 | 1949 Armistice Line DMZ |

## 부분 보충 후 남은 옛 구간

모든 아래 국가 쌍은 실제 교차점 밖의 옛 끝부분을 남겼다. 길이는 지도 좌표의 각도 길이이며 km·면적·국경 정확도 비율이 아니다. 정확한 접합 좌표·원본 선 ID는 JSON 목록에 있다.

| 국가 쌍 | 보충 구간 수 | 남긴 옛 끝부분 길이(도) | 전체 보류된 추가 구간 수 |
| --- | ---: | ---: | ---: |
| 아프가니스탄 (AFG) / 중화인민공화국 (CHN) | 1 | 0.360121 | 0 |
| 아프가니스탄 (AFG) / 이란 (IRN) | 1 | 1.507621 | 0 |
| 아프가니스탄 (AFG) / 타지키스탄 (TJK) | 1 | 0.384853 | 0 |
| 아프가니스탄 (AFG) / 투르크메니스탄 (TKM) | 1 | 0.149117 | 0 |
| 아프가니스탄 (AFG) / 우즈베키스탄 (UZB) | 1 | 0.306689 | 0 |
| 앙골라 (AGO) / 콩고 민주 공화국 (COD) | 2 | 1.465445 | 0 |
| 앙골라 (AGO) / 콩고 공화국 (COG) | 1 | 0.430127 | 0 |
| 앙골라 (AGO) / 나미비아 (NAM) | 1 | 2.062950 | 0 |
| 앙골라 (AGO) / 잠비아 (ZMB) | 1 | 0.390507 | 0 |
| 알바니아 (ALB) / 그리스 (GRC) | 1 | 0.374549 | 0 |
| 알바니아 (ALB) / 북마케도니아 (MKD) | 1 | 0.276267 | 0 |
| 알바니아 (ALB) / 몬테네그로 (MNE) | 1 | 0.066004 | 0 |
| 안도라 (AND) / 에스파냐 (ESP) | 1 | 0.179243 | 0 |
| 아랍에미리트 (ARE) / 오만 (OMN) | 2 | 1.362368 | 2 |
| 아르헨티나 (ARG) / 볼리비아 (BOL) | 1 | 0.421520 | 0 |
| 아르헨티나 (ARG) / 브라질 (BRA) | 1 | 0.206920 | 0 |
| 아르헨티나 (ARG) / 칠레 (CHL) | 2 | 2.409896 | 2 |
| 아르메니아 (ARM) / 조지아 (GEO) | 1 | 0.739920 | 0 |
| 아르메니아 (ARM) / 튀르키예 (TUR) | 1 | 0.658031 | 0 |
| 오스트리아 (AUT) / 스위스 (CHE) | 2 | 0.457037 | 0 |
| 오스트리아 (AUT) / 체코 (CZE) | 1 | 0.176210 | 0 |
| 오스트리아 (AUT) / 독일 (DEU) | 1 | 1.982577 | 0 |
| 오스트리아 (AUT) / 헝가리 (HUN) | 1 | 0.357408 | 0 |
| 오스트리아 (AUT) / 이탈리아 (ITA) | 1 | 0.142497 | 0 |
| 오스트리아 (AUT) / 슬로바키아 (SVK) | 1 | 0.112079 | 0 |
| 오스트리아 (AUT) / 슬로베니아 (SVN) | 1 | 0.095933 | 0 |
| 아제르바이잔 (AZE) / 조지아 (GEO) | 1 | 0.363596 | 0 |
| 아제르바이잔 (AZE) / 러시아 (RUS) | 1 | 0.279540 | 0 |
| 아제르바이잔 (AZE) / 튀르키예 (TUR) | 1 | 0.051525 | 0 |
| 부룬디 (BDI) / 르완다 (RWA) | 1 | 0.203760 | 0 |
| 부룬디 (BDI) / 탄자니아 (TZA) | 1 | 0.517801 | 0 |
| 벨기에 (BEL) / 독일 (DEU) | 1 | 0.443760 | 0 |
| 벨기에 (BEL) / 프랑스 (FRA) | 1 | 0.395241 | 0 |
| 벨기에 (BEL) / 룩셈부르크 (LUX) | 1 | 0.095830 | 0 |
| 벨기에 (BEL) / 네덜란드 (NLD) | 2 | 0.673236 | 0 |
| 베냉 (BEN) / 부르키나파소 (BFA) | 1 | 0.261458 | 0 |
| 베냉 (BEN) / 니제르 (NER) | 1 | 0.104906 | 0 |
| 베냉 (BEN) / 나이지리아 (NGA) | 1 | 0.077432 | 0 |
| 베냉 (BEN) / 토고 (TGO) | 1 | 1.106206 | 0 |
| 부르키나파소 (BFA) / 코트디부아르 (CIV) | 1 | 0.062274 | 0 |
| 부르키나파소 (BFA) / 말리 (MLI) | 1 | 0.742707 | 0 |
| 부르키나파소 (BFA) / 니제르 (NER) | 1 | 0.648201 | 0 |
| 부르키나파소 (BFA) / 토고 (TGO) | 1 | 1.100452 | 0 |
| 방글라데시 (BGD) / 인도 (IND) | 1 | 22.436180 | 0 |
| 방글라데시 (BGD) / 미얀마 (MMR) | 1 | 0.759712 | 0 |
| 불가리아 (BGR) / 그리스 (GRC) | 1 | 0.276771 | 0 |
| 불가리아 (BGR) / 북마케도니아 (MKD) | 1 | 0.855564 | 0 |
| 불가리아 (BGR) / 루마니아 (ROU) | 1 | 0.517616 | 0 |
| 불가리아 (BGR) / 세르비아 (SRB) | 1 | 0.369985 | 0 |
| 불가리아 (BGR) / 튀르키예 (TUR) | 1 | 0.166216 | 0 |
| 보스니아헤르체고비나 (BIH) / 크로아티아 (HRV) | 2 | 0.455673 | 0 |
| 보스니아헤르체고비나 (BIH) / 몬테네그로 (MNE) | 1 | 0.045526 | 0 |
| 보스니아헤르체고비나 (BIH) / 세르비아 (SRB) | 1 | 0.279093 | 0 |
| 벨라루스 (BLR) / 리투아니아 (LTU) | 1 | 0.460490 | 0 |
| 벨라루스 (BLR) / 라트비아 (LVA) | 1 | 0.100761 | 0 |
| 벨라루스 (BLR) / 폴란드 (POL) | 1 | 1.454182 | 0 |
| 벨라루스 (BLR) / 러시아 (RUS) | 1 | 0.373836 | 0 |
| 벨라루스 (BLR) / 우크라이나 (UKR) | 1 | 0.162005 | 0 |
| 볼리비아 (BOL) / 브라질 (BRA) | 1 | 0.150138 | 0 |
| 볼리비아 (BOL) / 칠레 (CHL) | 1 | 0.893696 | 0 |
| 볼리비아 (BOL) / 페루 (PER) | 1 | 3.957675 | 0 |
| 볼리비아 (BOL) / 파라과이 (PRY) | 1 | 2.831575 | 0 |
| 브라질 (BRA) / 콜롬비아 (COL) | 1 | 2.928868 | 0 |
| 브라질 (BRA) / 파라과이 (PRY) | 1 | 0.043367 | 0 |
| 브라질 (BRA) / 베네수엘라 (VEN) | 1 | 0.736763 | 0 |
| 브루나이 (BRN) / 말레이시아 (MYS) | 2 | 0.751898 | 0 |
| 보츠와나 (BWA) / 나미비아 (NAM) | 1 | 2.773386 | 0 |
| 보츠와나 (BWA) / 남아프리카 공화국 (ZAF) | 1 | 0.278668 | 0 |
| 보츠와나 (BWA) / 짐바브웨 (ZWE) | 1 | 1.454393 | 0 |
| 중앙아프리카 공화국 (CAF) / 카메룬 (CMR) | 1 | 0.274705 | 0 |
| 중앙아프리카 공화국 (CAF) / 콩고 민주 공화국 (COD) | 1 | 0.155443 | 0 |
| 중앙아프리카 공화국 (CAF) / 콩고 공화국 (COG) | 1 | 1.451690 | 0 |
| 중앙아프리카 공화국 (CAF) / 차드 (TCD) | 1 | 0.515700 | 0 |
| 캐나다 (CAN) / 미국 (USA) | 1 | 10.372583 | 2 |
| 스위스 (CHE) / 독일 (DEU) | 1 | 0.049907 | 0 |
| 스위스 (CHE) / 프랑스 (FRA) | 1 | 0.174422 | 0 |
| 스위스 (CHE) / 이탈리아 (ITA) | 1 | 0.356474 | 0 |
| 스위스 (CHE) / 리히텐슈타인 (LIE) | 1 | 0.150294 | 0 |
| 칠레 (CHL) / 페루 (PER) | 1 | 0.288435 | 0 |
| 중화인민공화국 (CHN) / 카자흐스탄 (KAZ) | 1 | 0.560524 | 0 |
| 중화인민공화국 (CHN) / 키르기스스탄 (KGZ) | 1 | 0.759233 | 0 |
| 중화인민공화국 (CHN) / 라오스 (LAO) | 1 | 0.280660 | 0 |
| 중화인민공화국 (CHN) / 미얀마 (MMR) | 1 | 0.161018 | 0 |
| 중화인민공화국 (CHN) / 몽골 (MNG) | 1 | 0.921504 | 0 |
| 중화인민공화국 (CHN) / 러시아 (RUS) | 2 | 1.618806 | 0 |
| 중화인민공화국 (CHN) / 타지키스탄 (TJK) | 1 | 0.216719 | 0 |
| 중화인민공화국 (CHN) / 베트남 (VNM) | 1 | 0.322930 | 0 |
| 코트디부아르 (CIV) / 가나 (GHA) | 1 | 0.305020 | 1 |
| 코트디부아르 (CIV) / 기니 (GIN) | 1 | 0.090845 | 0 |
| 코트디부아르 (CIV) / 말리 (MLI) | 1 | 0.102359 | 0 |
| 카메룬 (CMR) / 콩고 공화국 (COG) | 1 | 1.113728 | 0 |
| 카메룬 (CMR) / 가봉 (GAB) | 1 | 0.211332 | 0 |
| 카메룬 (CMR) / 적도기니 (GNQ) | 1 | 1.613556 | 0 |
| 카메룬 (CMR) / 나이지리아 (NGA) | 1 | 0.672200 | 0 |
| 카메룬 (CMR) / 차드 (TCD) | 1 | 0.973397 | 0 |
| 콩고 민주 공화국 (COD) / 콩고 공화국 (COG) | 1 | 9.477072 | 0 |
| 콩고 민주 공화국 (COD) / 르완다 (RWA) | 1 | 0.021769 | 0 |
| 콩고 민주 공화국 (COD) / 우간다 (UGA) | 1 | 1.700151 | 0 |
| 콩고 민주 공화국 (COD) / 잠비아 (ZMB) | 1 | 2.000860 | 0 |
| 콩고 공화국 (COG) / 가봉 (GAB) | 1 | 0.473748 | 0 |
| 콜롬비아 (COL) / 에콰도르 (ECU) | 1 | 0.673426 | 0 |
| 콜롬비아 (COL) / 파나마 (PAN) | 1 | 0.652557 | 0 |
| 콜롬비아 (COL) / 페루 (PER) | 1 | 0.341472 | 0 |
| 콜롬비아 (COL) / 베네수엘라 (VEN) | 1 | 0.490100 | 0 |
| 코스타리카 (CRI) / 니카라과 (NIC) | 2 | 0.173130 | 0 |
| 코스타리카 (CRI) / 파나마 (PAN) | 1 | 0.053600 | 0 |
| 체코 (CZE) / 독일 (DEU) | 1 | 0.326782 | 0 |
| 체코 (CZE) / 폴란드 (POL) | 1 | 0.672055 | 0 |
| 체코 (CZE) / 슬로바키아 (SVK) | 1 | 0.050766 | 0 |
| 독일 (DEU) / 덴마크 (DNK) | 1 | 0.191217 | 0 |
| 독일 (DEU) / 프랑스 (FRA) | 1 | 0.065378 | 0 |
| 독일 (DEU) / 네덜란드 (NLD) | 1 | 0.750971 | 0 |
| 독일 (DEU) / 폴란드 (POL) | 1 | 1.855722 | 1 |
| 지부티 (DJI) / 에리트레아 (ERI) | 1 | 0.260797 | 0 |
| 지부티 (DJI) / 에티오피아 (ETH) | 1 | 1.845529 | 0 |
| 도미니카 공화국 (DOM) / 아이티 (HTI) | 1 | 0.175841 | 0 |
| 알제리 (DZA) / 리비아 (LBY) | 1 | 1.541595 | 0 |
| 알제리 (DZA) / 말리 (MLI) | 1 | 1.054313 | 0 |
| 알제리 (DZA) / 니제르 (NER) | 1 | 5.734144 | 0 |
| 알제리 (DZA) / 튀니지 (TUN) | 1 | 2.478158 | 0 |
| 에콰도르 (ECU) / 페루 (PER) | 1 | 0.892066 | 0 |
| 이집트 (EGY) / 리비아 (LBY) | 1 | 9.657000 | 0 |
| 에리트레아 (ERI) / 에티오피아 (ETH) | 1 | 0.522165 | 0 |
| 에리트레아 (ERI) / 수단 (SDN) | 1 | 1.243452 | 0 |
| 에스파냐 (ESP) / 프랑스 (FRA) | 2 | 1.102145 | 1 |
| 에스파냐 (ESP) / 모로코 (MAR) | 1 | 0.049551 | 1 |
| 에스토니아 (EST) / 러시아 (RUS) | 1 | 0.889506 | 0 |
| 에티오피아 (ETH) / 케냐 (KEN) | 1 | 2.607200 | 0 |
| 에티오피아 (ETH) / 수단 (SDN) | 1 | 2.304223 | 0 |
| 핀란드 (FIN) / 노르웨이 (NOR) | 1 | 0.593121 | 0 |
| 핀란드 (FIN) / 러시아 (RUS) | 1 | 0.570826 | 0 |
| 프랑스 (FRA) / 이탈리아 (ITA) | 1 | 0.775663 | 0 |
| 프랑스 (FRA) / 룩셈부르크 (LUX) | 1 | 0.528815 | 0 |
| 가봉 (GAB) / 적도기니 (GNQ) | 1 | 0.819234 | 0 |
| 영국 (GBR) / 아일랜드 (IRL) | 1 | 0.052431 | 0 |
| 조지아 (GEO) / 튀르키예 (TUR) | 1 | 0.656092 | 0 |
| 기니 (GIN) / 기니비사우 (GNB) | 1 | 1.524105 | 0 |
| 기니 (GIN) / 라이베리아 (LBR) | 1 | 0.154964 | 0 |
| 기니 (GIN) / 말리 (MLI) | 1 | 0.233727 | 0 |
| 기니 (GIN) / 세네갈 (SEN) | 1 | 0.790233 | 0 |
| 기니 (GIN) / 시에라리온 (SLE) | 1 | 0.086342 | 0 |
| 감비아 (GMB) / 세네갈 (SEN) | 1 | 1.177383 | 0 |
| 기니비사우 (GNB) / 세네갈 (SEN) | 1 | 1.519142 | 0 |
| 그리스 (GRC) / 북마케도니아 (MKD) | 1 | 0.204136 | 0 |
| 그리스 (GRC) / 튀르키예 (TUR) | 1 | 0.202488 | 0 |
| 과테말라 (GTM) / 멕시코 (MEX) | 1 | 1.937404 | 0 |
| 과테말라 (GTM) / 엘살바도르 (SLV) | 1 | 0.038412 | 0 |
| 가이아나 (GUY) / 베네수엘라 (VEN) | 1 | 1.341694 | 0 |
| 온두라스 (HND) / 니카라과 (NIC) | 1 | 0.289856 | 0 |
| 온두라스 (HND) / 엘살바도르 (SLV) | 1 | 0.264938 | 0 |
| 크로아티아 (HRV) / 헝가리 (HUN) | 1 | 0.321004 | 0 |
| 크로아티아 (HRV) / 몬테네그로 (MNE) | 1 | 0.098098 | 0 |
| 헝가리 (HUN) / 루마니아 (ROU) | 1 | 0.110805 | 0 |
| 헝가리 (HUN) / 세르비아 (SRB) | 1 | 0.235206 | 0 |
| 헝가리 (HUN) / 슬로바키아 (SVK) | 1 | 0.110696 | 0 |
| 헝가리 (HUN) / 슬로베니아 (SVN) | 1 | 0.274976 | 0 |
| 헝가리 (HUN) / 우크라이나 (UKR) | 1 | 0.163888 | 0 |
| 인도네시아 (IDN) / 말레이시아 (MYS) | 1 | 0.032136 | 1 |
| 인도네시아 (IDN) / 파푸아뉴기니 (PNG) | 1 | 5.934894 | 0 |
| 인도네시아 (IDN) / 동티모르 (TLS) | 2 | 1.081141 | 0 |
| 이란 (IRN) / 이라크 (IRQ) | 1 | 0.052103 | 0 |
| 이란 (IRN) / 파키스탄 (PAK) | 1 | 2.136763 | 0 |
| 이란 (IRN) / 투르크메니스탄 (TKM) | 1 | 0.376991 | 0 |
| 이란 (IRN) / 튀르키예 (TUR) | 1 | 0.095241 | 0 |
| 이라크 (IRQ) / 요르단 (JOR) | 1 | 1.312984 | 0 |
| 이라크 (IRQ) / 사우디아라비아 (SAU) | 1 | 1.967589 | 0 |
| 이라크 (IRQ) / 시리아 (SYR) | 1 | 0.531145 | 0 |
| 이라크 (IRQ) / 튀르키예 (TUR) | 1 | 0.096498 | 0 |
| 이탈리아 (ITA) / 슬로베니아 (SVN) | 1 | 0.143467 | 0 |
| 요르단 (JOR) / 사우디아라비아 (SAU) | 1 | 5.708964 | 0 |
| 카자흐스탄 (KAZ) / 키르기스스탄 (KGZ) | 1 | 0.349715 | 0 |
| 카자흐스탄 (KAZ) / 러시아 (RUS) | 1 | 0.236404 | 0 |
| 카자흐스탄 (KAZ) / 투르크메니스탄 (TKM) | 1 | 0.228622 | 0 |
| 카자흐스탄 (KAZ) / 우즈베키스탄 (UZB) | 1 | 3.924023 | 0 |
| 케냐 (KEN) / 탄자니아 (TZA) | 1 | 1.197332 | 0 |
| 케냐 (KEN) / 우간다 (UGA) | 1 | 1.549884 | 0 |
| 키르기스스탄 (KGZ) / 타지키스탄 (TJK) | 1 | 1.940978 | 1 |
| 키르기스스탄 (KGZ) / 우즈베키스탄 (UZB) | 1 | 9.678352 | 2 |
| 캄보디아 (KHM) / 라오스 (LAO) | 1 | 0.579910 | 0 |
| 캄보디아 (KHM) / 태국 (THA) | 1 | 0.300536 | 0 |
| 캄보디아 (KHM) / 베트남 (VNM) | 1 | 0.888307 | 0 |
| 라오스 (LAO) / 미얀마 (MMR) | 1 | 0.245785 | 0 |
| 라오스 (LAO) / 태국 (THA) | 1 | 0.074367 | 0 |
| 라오스 (LAO) / 베트남 (VNM) | 1 | 1.326652 | 0 |
| 라이베리아 (LBR) / 시에라리온 (SLE) | 1 | 0.319734 | 0 |
| 리비아 (LBY) / 니제르 (NER) | 1 | 0.633052 | 0 |
| 리비아 (LBY) / 수단 (SDN) | 1 | 2.513690 | 0 |
| 리투아니아 (LTU) / 라트비아 (LVA) | 1 | 1.076846 | 0 |
| 리투아니아 (LTU) / 폴란드 (POL) | 1 | 0.724848 | 0 |
| 리투아니아 (LTU) / 러시아 (RUS) | 1 | 0.376633 | 1 |
| 라트비아 (LVA) / 러시아 (RUS) | 1 | 0.060834 | 0 |
| 몰도바 (MDA) / 루마니아 (ROU) | 1 | 0.378409 | 0 |
| 멕시코 (MEX) / 미국 (USA) | 1 | 2.441832 | 0 |
| 북마케도니아 (MKD) / 세르비아 (SRB) | 1 | 0.223228 | 0 |
| 말리 (MLI) / 모리타니 (MRT) | 1 | 2.010848 | 0 |
| 말리 (MLI) / 세네갈 (SEN) | 1 | 0.463663 | 0 |
| 미얀마 (MMR) / 태국 (THA) | 1 | 0.348635 | 0 |
| 몬테네그로 (MNE) / 세르비아 (SRB) | 1 | 0.939504 | 0 |
| 몽골 (MNG) / 러시아 (RUS) | 1 | 2.271858 | 0 |
| 모잠비크 (MOZ) / 말라위 (MWI) | 1 | 1.674723 | 2 |
| 모잠비크 (MOZ) / 에스와티니 (SWZ) | 1 | 0.985120 | 0 |
| 모잠비크 (MOZ) / 탄자니아 (TZA) | 1 | 0.522339 | 0 |
| 모잠비크 (MOZ) / 남아프리카 공화국 (ZAF) | 2 | 4.245920 | 0 |
| 모잠비크 (MOZ) / 잠비아 (ZMB) | 1 | 0.553490 | 0 |
| 모잠비크 (MOZ) / 짐바브웨 (ZWE) | 1 | 2.005557 | 0 |
| 모리타니 (MRT) / 세네갈 (SEN) | 1 | 0.318672 | 0 |
| 말라위 (MWI) / 탄자니아 (TZA) | 1 | 0.082160 | 0 |
| 말라위 (MWI) / 잠비아 (ZMB) | 1 | 0.170661 | 0 |
| 나미비아 (NAM) / 남아프리카 공화국 (ZAF) | 1 | 3.925968 | 0 |
| 나미비아 (NAM) / 잠비아 (ZMB) | 1 | 0.867132 | 0 |
| 니제르 (NER) / 나이지리아 (NGA) | 1 | 0.102087 | 0 |
| 니제르 (NER) / 차드 (TCD) | 1 | 6.909977 | 0 |
| 노르웨이 (NOR) / 러시아 (RUS) | 1 | 0.061158 | 0 |
| 노르웨이 (NOR) / 스웨덴 (SWE) | 1 | 0.620072 | 0 |
| 폴란드 (POL) / 러시아 (RUS) | 1 | 0.651573 | 0 |
| 폴란드 (POL) / 슬로바키아 (SVK) | 1 | 1.181788 | 0 |
| 폴란드 (POL) / 우크라이나 (UKR) | 1 | 0.194566 | 0 |
| 루마니아 (ROU) / 세르비아 (SRB) | 1 | 0.726103 | 0 |
| 루마니아 (ROU) / 우크라이나 (UKR) | 2 | 0.629829 | 0 |
| 르완다 (RWA) / 탄자니아 (TZA) | 1 | 0.248973 | 0 |
| 사우디아라비아 (SAU) / 예멘 (YEM) | 1 | 0.062103 | 0 |
| 수단 (SDN) / 차드 (TCD) | 1 | 5.222166 | 0 |
| 슬로바키아 (SVK) / 우크라이나 (UKR) | 1 | 0.304755 | 0 |
| 에스와티니 (SWZ) / 남아프리카 공화국 (ZAF) | 1 | 0.165327 | 0 |
| 시리아 (SYR) / 튀르키예 (TUR) | 1 | 0.603414 | 0 |
| 타지키스탄 (TJK) / 우즈베키스탄 (UZB) | 1 | 0.918459 | 1 |
| 탄자니아 (TZA) / 우간다 (UGA) | 1 | 3.106742 | 0 |
| 탄자니아 (TZA) / 잠비아 (ZMB) | 1 | 1.513082 | 0 |
| 남아프리카 공화국 (ZAF) / 짐바브웨 (ZWE) | 1 | 0.217973 | 0 |
| 잠비아 (ZMB) / 짐바브웨 (ZWE) | 1 | 0.198178 | 0 |

## 판본

초판: 2026-10-21, GEO-WORLD-20261021. 원본 자료 발행일·역사 효력일·이번 로컬 반영일은 서로 구분한다.
