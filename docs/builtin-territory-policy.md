# 기본 정치체 표시 정책 (2026-09-06)

새 기본 프로젝트와 기본 지도 초기화에만 적용한다. 외부 원본과 복구 이력은
보존하며 기존 저장 프로젝트의 국가 geometry와 사용자 편집을 재분류하지 않는다.
활성 기본 지도에서 제외하는 객체는 아래의 2026-11-12 정정 계약을 따른다.

| 원본 공간 ID | 새 기본 표시 |
| --- | --- |
| PGA | 웨이크로 잘못 표시된 객체와 활성 객체 정보 제거. 원본 NE Spratly 자료는 증거로 보존. |
| KAB | 카자흐스탄 영토에 포함하고 별도 객체와 활성 객체 정보 제거. |
| BRI | 브라질 국토에 포함 |
| BJN, SER | 콜롬비아 국토에 포함하고 별도 객체와 활성 객체 정보 제거. |
| SCR | 중국 국토에 포함 |
| CYN, SOL | 국가 유지, 국기 추가 |
| CNM | 사용자 요청에 따라 변경 없음 |
| BRT, ATA | 기존 국가 예외 유지 |
| KAS, SPI | 정확한 통제 경계와 원본 polygon 대조가 끝나지 않아 보류 |

이는 실효지배 기준의 기본 채움 정책이지 법적 주권 판정이 아니다.
`builtin-territory-policy.js`는 unchanged canonical feature ID를 공간 참조로 사용한다.
분쟁 정보는 BRA/COL/CHN 국가 전체에 붙이지 않고 해당 sourceId 범위에 연결한다.
콜롬비아 두 섬의 historicalClaimants는 과거 주장국 목록이며 현재 유효한 주장 목록이 아니다.
특히 2012년 ICJ 판결은 니카라과와의 관계에서 콜롬비아 주권을 인정했다.

## 근거

- 웨이크섬: https://www.doi.gov/node/11613
- 브라질섬 현장 관리: https://www.marinha.mil.br/noticias/deluruguaiana-presta-apoio-ao-exercito-brasileiro-em-visita-ilha-brasileira-na-barra-do
- 우루과이 주장: https://medios.presidencia.gub.uy/legal/2019/resoluciones/11/presidencia_1132.pdf
- 콜롬비아/니카라과 ICJ 사건 124: https://www.icj-cij.org/case/124
- 스카버러 통제: https://apnews.com/article/fd2db4e0e2f0c1dd3cf3c0ff14a58ad7
- 국기 출처와 라이선스: assets/vendor/political-flags/NOTICE

KAS 원본 범위는 76.777351–77.800346E / 35.110442–35.647799N,
SPI는 73.588036–73.057424W / 49.759959–49.272754S이다.
이 bounding box만으로 실효지배 경계를 확정할 수 없으므로 통째로 합치거나
임의의 직선으로 나누지 않는다. 정확한 경계 자료 검증 후 후속 변경한다.

## 구현 계약

네 섬은 대상 국가의 기존 polygon과 겹치지 않는 별도 polygon으로 합성한다.
원본 객체/좌표는 변경하지 않고 새 MultiPolygon을 생성한다. source ID는 새 목록에서
제거하며 dirty-country 집합에 원본과 목적지를 모두 등록해 GPU patch 및 delta 저장에 반영한다.
기존 국가 mesh 자산, 수계, project schema와 앱 버전은 바꾸지 않는다.

## 구현 구조 변경 (2026-11-07, `work/optimization`)

국가·속령 관계 46건과 영토 합성 예외 4건의 데이터 소유자는
`assets/data/builtin-world/display-policy-v1.json`이다. 생성기는
`tools/gis/builtin-display-policy.mjs`의 검증을 거쳐 이 파일을 읽는다.
`builtin-subunits.js`와 `builtin-territory-policy.js`는 국가 식별자·
관할국 목록을 내장하지 않는 순수 처리기로 전환됐다.

새로 생성되는 내장지도 프로젝트는 속령 관계를
`properties.metadata.builtinSubunit`에, 실제 적용된 영토 합성 예외와
그 주권 주장·출처 데이터를 `properties.metadata.builtinTerritoryDisplay`에
보존한다. 이 정보는 새로운 지리 경계 판정이 아니라 표시 정책의 기록이다.
기존 외부 라이브러리 국가 좌표·원본 지명·원본 하천은 수정하지 않는다.

회귀 검사: `tests/unit/document/builtin-subunits.test.mjs`와
`tests/unit/document/builtin-territory-policy.test.mjs`.
내장지도 생성 자산은 별도 원본 검증 및 짝지어진 데이터 게시 후 갱신해야 한다.

## 네 객체 제외 정정 계약 (2026-11-12)

KAB/BJN/SER/PGA는 활성 국가 목록, 단독 lineage, 선택 목록, 표시 정책,
압축 객체 정보 및 현재 지도 패킷에서 제거한다. 외부 GIS 원본, 과거 보고서,
Git 복구 이력과 다른 객체가 사용하는 공유 좌표 자산은 삭제하지 않는다.

KAZ의 현재 표시만 기존 KAB 영역을 포함하도록 복원하며 과거 구간과 임대 사실,
필요한 출처 표기는 보존한다. BJN/SER는 각 표시 층의 COL에 이미 포함되어 있는지
검증하고 누락된 층에만 같은 층의 섬 형상을 포함한다.

PGA의 오래된 NE 12개 polygon은 승인된 Spratly 10개 배분과 동일한 목록이 아니다.
이를 재배분하거나 실제 웨이크섬 및 UMI를 수정하지 않는다. 기존에 승인된 10개
섬의 수령국과 현재 source 좌표를 유지하며, 없는 표시 층에만 추가한다.

각 표시 층의 기존 형상 차이를 보존한다. 원본 source 전체를 runtime에 승격하거나
전체 GIS를 재생성하지 않고, 선택 영역과 관련 참조만 수정한다. source, 내장 객체,
현재 지도, PCG, mesh, preview와 색인의 짝지어진 검증이 끝나기 전에는 일부만
활성화하지 않는다. 선택적 cache를 분리할 때도 지원되는 대체 표시 경로를 검증한다.
