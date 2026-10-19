# GEO-LIFE-008 — 남아메리카 국가 존속기간 1차 조사 (2026-10-20)

상태: investigating · 지도 반영: not-applied · 브랜치: work/gis
색인 검토: assets/data/territorial-entities/generated/v2/index.json, blob a26630cd820eb2ec05e1c87fb847aa8cdcf3dacf.
1801-01-01 이후만 조사. 선행 A–D 조사와 중복되는 국가는 제외. 본 회차 4개 국가 COL, PER, URY, VEN은 현재 최상위 일반객체이며 lifetime.validFrom과 validTo 모두 null.

| ID | 역사상 확인된 사건 | 1차 판정 |
| --- | --- | --- |
| state:COL 콜롬비아 | 1810-07-20 산타페 자치정부; 1819-08-07 보야카 전투; 1819 그란콜롬비아 수립; 1822 미국 승인; 1830 연방 해체 | 1810 지역 자치봉기와 독립국 성립 구별. 그란콜롬비아·신그라나다·현재 콜롬비아 국가 동일성 검토, 단일 날짜 유보 |
| state:PER 페루 | 1821-07-15 독립문서; 1821-07-28 독립 선포; 1824 주력 스페인군 격파; 1826-05-02 미국 승인; 1836~1839 페루-볼리비아 연합 | 선포·실효지배·대외승인·연합의 법적 성격 분리. 단일 날짜 유보 |
| state:URY 우루과이 | 1825-08-25 독립·연합법; 1828-08-27 예비평화협약; 1828-10-04 비준서 교환; 1830-07-18 헌법 선서; 1836-01-25 미국 승인 | 1825 오리엔탈주의 브라질 독립 선언은 동시에 리오데라플라타 연합주 결합 의사 포함. 1828-10-04 신국가 법적 성립 후보이나 협약 원문 대조 전 확정 유보 |
| state:VEN 베네수엘라 | 1811-07-05 제1공화국 독립 의결; 1819 그란콜롬비아 편입; 1830 분리 독립; 1835-02-28 미국 승인 | 제1공화국·그란콜롬비아·1830 별도 국가 간 단절과 정체성 판단 필요. 단일 날짜 유보 |

## 교차검증 출처
- 콜롬비아: https://www.archivogeneral.gov.co/dia-de-la-independencia-20-de-julio-de-1810 ; https://www.mintic.gov.co/portal/historico/w3-article-102203.html ; https://history.state.gov/countries/colombia
- 페루: https://archivoregional.regionarequipa.gob.pe/Recorrido%20Patrio/ ; https://bicentenario.gob.pe/exposiciones/independencia/historia2.html ; https://history.state.gov/countries/peru/1000
- 우루과이: https://www.gub.uy/ministerio-educacion-cultura/comunicacion/noticias/25-agosto-1825-declaratoria-independencia ; https://www.gub.uy/ministerio-educacion-cultura/comunicacion/noticias/25-agosto-fecha-para-celebrar-nuestra-historia-nuestro-patrimonio ; https://history.state.gov/countries/uruguay
- 베네수엘라: https://www.mincultura.gob.ve/noticias/hoy-venezuela-celebra-211-anos-de-su-declaracion-del-acta-de-la/ ; https://bibliofep.fundacionempresaspolar.org/dhv/entradas/a/acta-de-la-independencia/ ; https://history.state.gov/countries/venezuela

각 국가 별도 기관 자료 2개 이상 대조. 다만 모든 개별 사건의 원법령과 효력일을 두 독립 원본으로 검증한 것은 아니므로 validFrom 입력 승인 아님. 실제 데이터·지도 형상·코드·main·배포 변경 0건. GIS 지형·위상·최대 배율·테스트·빌드는 미검증.

**이전 차례:** 북아메리카(10/19 GEO-LIFE-007 로컬 문서 원격 등록 보류). **이번:** 남아메리카 4개국 1차. **다음:** 오세아니아. 북아메리카 007의 등록과 progress/README 정합성을 우선 복구할 것.