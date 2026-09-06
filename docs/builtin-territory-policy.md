# 기본 정치체 표시 정책 (2026-09-06)

새 기본 프로젝트와 기본 지도 초기화에만 적용한다. canonical 원본 258개 feature는
변경하지 않으며 기존 저장 프로젝트의 국가 geometry와 사용자 편집을 재분류하지 않는다.

| 원본 공간 ID | 새 기본 표시 |
| --- | --- |
| PGA | 미국 하위단위 웨이크섬 |
| BRI | 브라질 국토에 포함 |
| BJN, SER | 콜롬비아 국토에 포함 |
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
