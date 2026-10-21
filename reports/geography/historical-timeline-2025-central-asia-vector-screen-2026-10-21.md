# 2025년 중앙아시아 역사 벡터 자료 탐색
> GEO-TIME-005 · 2026-10-21 · investigating · not-applied

> 후속 검토: 2026-10-20 UTC / 2026-10-21 한국 · 기준 `e5b31d700fb6a9e2e2b0ab67356b3883011f22c3` (웹·앱 통합 저장소 동일 revision)

기존 [GEO-TIME-001](historical-timeline-2025-central-asia-2026-10-17.md)의 키르기스스탄–타지키스탄 2025-03-13 국경조약 사건에 관한 공간자료 후속 조사. 신규 사건 집계 0건.

- 미국 국무부 LSIB 11.4(2025-02-24 발행): 전체 ZIP 및 데이터 전용 GPKG가 목록에 제공됨. ZIP 내부 SHP 구성은 원본 미열람으로 미확인. 조약 서명일보다 앞선 판본의 비교 후보이며 대상 경계의 실제 유효일은 미확인. https://catalog.data.gov/dataset/large-scale-international-boundaries
- geoBoundaries KGZ/TJK ADM0(2017 표현, 2023 빌드, GeoJSON): 조약 이후 경계로 사용할 수 없음. https://www.geoboundaries.org/api/current/gbOpen/KGZ/ADM0/ ; https://www.geoboundaries.org/api/current/gbOpen/TJK/ADM0/
- CShapes 2.0(1886–2019, SHP/GeoJSON): 대상 연도가 아님; CC BY-NC-SA 4.0. https://icr.ethz.ch/data/cshapes/
- 키르기스스탄 정부 지도 페이지의 제목은 **Digital Map of Border Crossing Points**(국경 통과지점 안내지도). 조약 경계선 벡터 레이어·다운로드 제공 여부와 2025년 조약 반영 여부는 미확인. https://gps.gov.kg/wp-content/uploads/Digital-maps/en/index.html

원본 파일 다운로드·해시·CRS·객체 ID·형상·위상·변환·화면 0.5px 검사는 미실행. 조약 부속 경계 좌표, 영토 교환의 효력일과 공개 재배포 조건 미확인. 자료 후보만 기록하며 역사 형상 적합성은 검증되지 않았음. 제품 정본 및 main, 배포 변경 0건. 2025년 조사 미완료.

## 후보 메타데이터 후속 검토

최신 [벡터 자료 운영 규칙](../../docs/historical-vector-source-workflow.md)에 따라 위 공개 목록·API 본문을 읽었다. 원본 보고서 커밋은 `e5b31d700fb6a9e2e2b0ab67356b3883011f22c3`이다. 형상 데이터 파일 자체는 다운로드하지 않았으므로 아래 상태는 모두 **source-indexed / 역사 적합성 provisional**이다.

| 후보·공간 범위 | 판본·시간 의미 | 권리·검증 한계 | 후속 판단 |
| --- | --- | --- | --- |
| LSIB, 세계 경계선 중 KGZ/TJK 구간 후보 | 11.4 발행·갱신 2025-02-24; 현지 측량·구간 유효일 미확인 | 목록은 CC0 링크와 `restricted public`·`rights=copyright`를 함께 표시. 미국 정책상 경계 표현이며 실효지배와 일치한다고 보장하지 않음. 원본 이용 조건·필수 속성 미검사 | 서명 전 비교 후보에 한정. 목록의 약 100m 설명은 해당 구간의 Pando 화면 정확도 검증이 아님. |
| geoBoundaries KGZ/TJK ADM0, 각 국가 전체 | 표현연도 2017; 원자료 갱신 2023-01-19; 빌드 2023-12-12; 둘 다 다운로드 링크의 revision `9469f09` | API별 `boundaryLicense=Open Data Commons Open Database License 1.0`, 원천 OpenStreetMap/Wambacher. 형상 파일·CRS·실제 속성 ID 미검사 | 2025 조약 이후 자료로 사용 불가. 같은 계열 원천이므로 독립 역사 사료 두 개로 세지 않음. |
| CShapes 2.0, 세계 / 유럽 별도 판본 | 세계 1886–2019, 유럽 1816 이후; 원페이지의 범위 설명 확인 | CC BY-NC-SA 4.0; 특정 파일·코딩 판본 미선택, 원본 미열람 | 2025 대상 연도 밖. 과거 비교 후보만 유지하고 배포 적합성은 승인하지 않음. |
| gps.gov.kg 국경 통과지점 안내지도 | 페이지 제목·이용안내 확인; 경계 형상의 판본·유효기간 미확인 | 조약 경계 벡터의 존재·CRS·권리 미확인 | 국경선 데이터 확보로 집계하지 않음. 조약 부속도면·공식 공간 서비스 추가 확인 필요. |

현행 대상은 `state:KGZ`·`state:TJK`다. 위 자료에서는 조약 부속 좌표·실제 효력일·인계 구간과 독립 역사 사료 2개 대조가 확보되지 않았다. 기존 양자조약 보류는 해소되지 않으며, 서명일을 국가 lifetime 또는 형상 유효일로 입력하지 않는다. 1801-01-01은 조사 하한이다.

자료 파일의 CRS·레이어·형상/속성·해시, 변환·공유경계·위상 및 2560 CSS px/flatZoom=64/0.5 CSS px 검사는 모두 미실행이다. 상세 revision·현행 데이터 대조 및 별도 원문 부재 보류는 [후속 검토](reviews/followup-2026-10-20-vector-sources.md)에 남겼다. 이 보완은 원보고서 전체를 대체하지 않는다.
