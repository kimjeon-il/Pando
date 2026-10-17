# 현행 라이브러리 유럽 국가 존속기간 공란 1차 조사 — 1801년 이후 27개

> 보고서 ID: `GEO-LIFE-004` · 상태: `investigating` · 지도 반영: `not-applied` · 조사일/원문 최종 수정: 2026-10-15  
> 조사 기준: `work/gis` `691ec5d8184f840aa87477d2d340dfbf0fa5d7b9`, `assets/data/territorial-entities/generated/v2/index.json`의 `world:natural-earth-5.1.1`  
> 출처: 아래 국가별 공식 문헌·정부/의회/외교·기록기관 공개 자료. **보고서·색인만 수정.**

## 기간 하한과 선정 방법

- 조사·구현의 **최초 시점은 1801-01-01**(포함), 이번 조사 기준 종료 시점은 2026-10-15이다. **1801년 이전의 건국·왕조·국경 변천은 조사하지 않는다.** 1801년 당시 해당 국가가 독립국·종속국·기타 정치체였는지만 간단히 구분한다.
- **1801년부터 표시해야 한다는 요구는 그날 국가가 건국됐다는 의미가 아니다.** 1801년에 이미 있던 국가는 실제 건국 연월일을 임의로 만들어 `lifetime.validFrom=1801-01-01`로 쓰지 않는다. 임시 조회 하한과 사실상의 성립일을 분리한다.
- 현행 스냅샷에 속하고 `entityKind=general`, `parentEntityId=""`, `lifetime.validFrom=null` 및 `validTo=null`인 국가·지역 중 **이미 A–D 조사에 포함되지 않은 유럽 및 유럽·아시아 횡단국(조지아·러시아·튀르키예) 27개**를 선정했다. 최신 색인은 객체 총 **281개**, 최상위 양끝 공란 **117개**이다. 기존 A–D 보고서의 조사 당시 284/121개와 기준 시점이 다르다.
- 독립 선언, 국제 승인, 국가·법적 정체성, 실효적 주권, 합병 및 점령을 서로 다른 사건으로 기록한다. 국왕 교체·헌법·정권·국명 접미부 변경만으로 새 국가가 탄생했다고 간주하지 않는다.
- 원문에서 확인한 연/월/일 정밀도를 넘겨 가상의 월일을 생성하지 않는다. 구력·신력의 혼동 가능성이 있는 독립운동기 날짜는 해당 사실에 맞게 제한한다.
- **국가 존재기간과 현대 지도 국경의 유효기간은 독립된 문제**다. 이번 연구는 영토 변경을 추적·검증하지 않는다. 이미 기간이 입력된 다른 유럽 국가도 재조사하지 않는다.

## 판정 요약

| 1차 상태 | 의미 | 건수 |
| --- | --- | ---: |
| 기준일 존속 | 1801년부터 존재하던 독립국으로 확인, 건국일 소급조사 제외 | 5 |
| 사건일 근거 | 1801년 이후 창설·주권·독립 사건의 날짜 근거 확보 | 9 |
| 비연속 검토 | 피병합·주권 통치 공백·이후 재독립 등 구간 검토 | 9 |
| 정체성 검토 | 동군연합·종속국·연방 승계·법적 국가 동일성 검토 | 4 |
| **합계** | **27개 조사, 기간 데이터 적용은 없음** | **27** |

## 27개 전수 표

| ID | 국가 | 1801년 당시 | 1801년 이후의 주요 사건 | 판정 | 후속 검토 및 주의 | 근거 |
| --- | --- | --- | --- | --- | --- | --- |
| `state:ESP` | 에스파냐 | 1801년 기존 독립국 | 1808년 침공 및 헌정 위기; 1812년 헌법; 1931년 제2공화국; 1978년 헌법 | 기준일 존속 | 1801을 건국일로 기록하지 않음. 침략·정권 교체는 별도 건국의 근거가 아님. | [1](https://www.senado.es/web/conocersenado/senadohistoria/periodosconstitucionales/index.html?lang=en) · [2](https://www.congreso.es/en/web/guest/cem/const1978) |
| `state:EST` | 에스토니아 | 독립국 부재 | 1918-02-24 독립; 1940년 소련 점령·병합; 1991-08-20 독립 회복 | 비연속 검토 | 독립 통치 공백과 기존 국가의 법적 동일성 주장을 구별. | [1](https://president.ee/en/republic-of-estonia/declaration-of-independence/) · [2](https://www.riigikogu.ee/pressiteated/taasiseseisvumine/) |
| `state:FRA` | 프랑스 | 1801년 기존 독립국 | 1940년 패전·비시체제; 1944-08-09 공화국 적법성 회복령; 1958-10-04 제5공화국 헌법 | 기준일 존속 | 1944년 법령은 공화국의 법적 계속성을 명시. 정권 및 헌정 변동을 신국가 성립으로 보지 않음. | [1](https://www.legifrance.gouv.fr/affichTexte.do?cidTexte=LEGITEXT000006071212) · [2](https://francearchives.gouv.fr/fr/pages_histoire/39662) |
| `state:GBR` | 영국 | 1801-01-01 연합왕국 성립 | 1801-01-01 대브리튼·아일랜드 연합 발효; 1922년 아일랜드 자유국 분리; 1927년 국명 정비 | 사건일 근거 | 1801 성립과 1922·1927 분리·국명 변경을 구별. 이전 대브리튼 왕국의 성립사는 범위 밖. | [1](https://www.parliament.uk/about/living-heritage/evolutionofparliament/legislativescrutiny/parliamentandireland/collections/ireland/act-of-union-1800/) · [2](https://commonslibrary.parliament.uk/research-briefings/cbp-10649/) |
| `state:GEO` | 조지아 | 현행 통일 독립국 부재 | 1918-05-26 독립공화국; 1921년 소련 침공·독립 통치 상실; 1991-04-09 독립 회복 | 비연속 검토 | 1991년 법령은 1918년 독립법을 계승함. 소련기의 법적 계속성과 실효통치 공백을 분리. | [1](https://archive.gov.ge/en/sakartvelos-damoukideblobis-aghdgena-1) · [2](https://davlogsais.archive.gov.ge/en/sakartelos-pirveli-demokratiuli-respublika) |
| `state:GRC` | 그리스 | 독립국 부재 | 1821년 독립전쟁; 1822년 에피다우로스 독립선언; 1830-02-03 런던의정서로 독립 승인 | 사건일 근거 | 독립 선언과 국제 승인은 별개. 초기 혁명기 행사일의 구력·신력 변환은 추가 검증. | [1](https://www.hellenicparliament.gr/en/Enimerosi/Grafeio-Typou/Deltia-Typou/?press=70d34b1e-e219-4578-8917-acf50127e34c) · [2](https://200years.mfa.gr/en/international-treaties-en/) |
| `state:HRV` | 크로아티아 | 독립국 부재 | 1991-06-25 독립 결정; 3개월 유예; 1991-10-08 국가·법적 관계 최종 단절; 1992-01-15 국제승인 확대 | 사건일 근거 | 1991-06-25 의회 결정과 10-08 효력 및 대외 승인을 구별. | [1](https://www.sabor.hr/en/about-parliament/history/important-dates/25-june-independence-day) · [2](https://mvep.gov.hr/croatia-observing-28th-anniversary-of-int-l-recognition/196578) |
| `state:HUN` | 헝가리 | 합스부르크 군주국 구성 왕국 | 1849년 독립운동; 1867년 이중군주제; 1918-10-17 오스트리아로부터 독립 선언, 11-16 공화국; 1989년 체제전환 | 정체성 검토 | 1801년 왕국의 법적 지위·1867년 자치·1918년 완전한 대외 독립을 구별. 1989는 신국가 건국일 아님. | [1](https://history.state.gov/countries/hungary) · [2](https://ww1.habsburger.net/en/chapters/dual-monarchy-two-states-single-empire) |
| `state:ISL` | 아이슬란드 | 덴마크와 결합된 지역 | 1918-12-01 주권을 가진 아이슬란드 왕국; 1944-06-17 동군연합 종료 및 공화국 출범 | 사건일 근거 | 1918 주권 국가 성립과 1944 공화정 전환을 분리. | [1](https://www.government.is/library/01-Ministries/Ministry-for-Foreign-Affairs/PDF-skjol/Diplomatic-Handbook/Diplomatic%20Handbook%20WEB_09-2-22.pdf) · [2](https://history.state.gov/countries/iceland) |
| `state:KOS` | 코소보 | 독립국 부재 | 2008-02-17 독립 선언; 2010-07-22 국제사법재판소 권고적 의견 | 사건일 근거 | 국제사법재판소는 선언 자체의 국제법 위반이 없다고 판단했을 뿐, 국가성·보편적 승인을 판정하지 않음. | [1](https://www.icj-cij.org/node/101885) · [2](https://www.un.org/sg/en/content/former-secretary-general/press-events/2008-02-17/statement-the-secretary-general-the-press-following-security-council-consultations-kosovo) |
| `state:LIE` | 리히텐슈타인 | 기존 신성로마제국 구성 제후국 | 1806년 라인동맹 가입·주권 획득; 1815년 독일연방 가입; 1866년 독일연방 해체; 1921년 헌법 | 사건일 근거 | 국가 최초 성립은 1801 이전이므로 미조사. 1806년 주권 획득 사건의 일자 효력은 추가 대조. | [1](https://www.liechtensteinusa.org/history) · [2](https://germanhistorydocs.org/en/the-holy-roman-empire-1648-1815/the-founding-of-the-confederation-of-the-rhine-rheinbund-on-july-12-1806-1806) |
| `state:LTU` | 리투아니아 | 독립국 부재 | 1918-02-16 독립; 1940년 소련 점령; 1990-03-11 독립 재건 | 비연속 검토 | 1990년 원법은 1918년 국가 독립법이 법적 효력을 상실하지 않았다고 명시. 주권행사 중단 별도 기록. | [1](https://e-seimas.lrs.lt/rs/legalact/TAD/TAIS.50850/) · [2](https://www.lrs.lt/sip/portal.show?p_r=37685&p_t=270453) |
| `state:LUX` | 룩셈부르크 | 프랑스 행정구역 | 1815년 대공국 지위; 1839-04-19 런던조약에 따른 독립 주권국; 1867년 중립 보장; 1890년 네덜란드와 동군연합 종료 | 사건일 근거 | 정부가 1839-04-19을 독립 주권국 기준으로 명시. 1815·1867·1890과 혼동 금지. | [1](https://gouvernement.lu/en/systeme-politique.html) · [2](https://sip.gouvernement.lu/dam-assets/publications/brochure-livre/minist-etat/sip/brochure/a-propos/A_propos_Histoire/a-propos-histoire-en.pdf) |
| `state:LVA` | 라트비아 | 독립국 부재 | 1918-11-18 독립; 1940년 점령; 1990-05-04 독립 회복 선언; 1991-08-21 이행기간 종료 | 비연속 검토 | 법적 계속성 주장과 실효적 독립 회복을 구별. 1990과 1991의 법적 효력 차이 유지. | [1](https://likumi.lv/doc.php?id=75539&lang=en) · [2](https://www.at.gov.lv/en/par-augstako-tiesu/vesture/latvijas-republikas-augstaka-tiesa/neatkaribas-atjaunosana) |
| `state:MCO` | 모나코 | 프랑스 병합 상태 | 1814년 주권·독립 회복, 1815년 재확인; 1861년 프랑스-모나코 조약 | 비연속 검토 | 1801년 독립국 부재; 1814년 재독립과 1861년 주권 재확인을 구별. 앞선 시대는 조사 제외. | [1](https://history.state.gov/countries/monaco) · [2](https://www.gouv.mc/en/government-institutions/history-and-heritage/periods/inventing-monte-carlo-years-1860-to-1920/new-alliance-with-france) |
| `state:MKD` | 북마케도니아 | 독립국 부재 | 1991-09-08 국민투표; 1991-09-17 의회 독립·주권국 성립 선언; 1991-11-17 헌법; 2019년 개명 | 사건일 근거 | 의회 기록은 국민투표가 자문적이고 9월17일 선언이 공식 정치·법률적 성립 행위임을 명시. | [1](https://www.sobranie.mk/content/%D0%9F%D0%B0%D1%80%D0%BB%D0%B0%D0%BC%D0%B5%D0%BD%D1%82%D0%B0%D1%80%D0%B5%D0%BD%20%D0%B8%D0%BD%D1%81%D1%82%D0%B8%D1%82%D1%83%D1%82/%D0%98%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%98%D0%B0%20%D0%BD%D0%B0%20%D0%BF%D0%B0%D1%80%D0%BB%D0%B0%D0%BC%D0%B5%D0%BD%D1%82%D0%B0%D1%80%D0%B8%D0%B7%D0%B0%D0%BC_ENG.pdf) · [2](https://www.sobranie.mk/the-constitution-of-the-republic-ofmacedonia-ns_article-constitution-of-the-republic-of-north-macedonia) |
| `state:MNE` | 몬테네그로 | 정치체 존재, 국제법상 지위 미판정 | 1878-07-13 독립 국제 승인; 1918년 독립 상실·남슬라브 통합국 편입; 2006-05-21 국민투표; 2006-06-03 재독립 선언 | 비연속 검토 | 독립국 실효 기간은 1878~1918 및 2006~현재 후보. 1918년 정확한 종료일은 추가 법률검증. | [1](https://www.gov.me/en/digital-museum/13-july-symbol-of-montenegrin-statehood) · [2](https://pace.coe.int/files/11480/html) |
| `state:NLD` | 네덜란드 | 프랑스 영향하 바타비아 공화국 | 1806년 홀란트 왕국; 1810년 프랑스 병합; 1813-12-02 주권군주 선포; 1815-03-16 네덜란드 왕국 왕위 수락 | 비연속 검토 | 1810~1813년 주권 단절. 바타비아 공화국·홀란트 왕국·네덜란드 왕국의 동일성 및 1813/1814 외교적 복권은 별도 판정. | [1](https://www.royal-house.nl/topics/history/history-of-the-kingdom-of-the-netherlands) · [2](https://history.state.gov/countries/netherlands) |
| `state:NOR` | 노르웨이 | 덴마크 왕가와 결합한 왕국 | 1814-05-17 헌법·국왕 선출; 1814-11-04 스웨덴과 동군연합(노르웨이 헌정 존속); 1905-06-07 연합 해소; 1905-10-26 스웨덴 승인 | 정체성 검토 | 1814 이후 독립 국가의 법적 계속성과 동군연합하 외교주권 제한을 구별. 1905를 무조건 최초 국가 성립으로 단정 금지. | [1](https://www.stortinget.no/en/In-English/About-the-Storting/historical-highlights/milestones-in-norways-democratic-history/) · [2](https://www.regjeringen.no/en/the-government/previous-governments/historiske-artikler/offices/the-establishing-of-the-norwegian-state/id410040/) |
| `state:POL` | 폴란드 | 독립국 부재 | 1918-11-11 독립국 재출현; 1939년 독일·소련의 침공과 점령; 망명정부 계속; 1945년 전후 정부 교체; 1989년 민주화 | 비연속 검토 | 1918년 성립 확인. 1939년 국가 법적 소멸을 자동 판정하지 말고 망명정부의 국가 계속성 심사. | [1](https://instytutpolski.pl/telaviv/en/2020/11/10/11-of-november-polands-independence-day-4/) · [2](https://www.theholocaustexplained.org/polish-government-in-exile/) |
| `state:PRT` | 포르투갈 | 1801년 기존 독립국 | 1807년 외세 침입·왕실 이전; 1910-10-05 공화정 선포; 1974-04-25 혁명·민주화; 1976년 헌법 | 기준일 존속 | 기존 국가의 정권·헌정 변화이지 자동 신국가 성립 아님. 1801년은 건국일이 아님. | [1](https://portugal.gov.pt/gc25/governo/governos-anteriores/chefes-do-governo-desde-1821) · [2](https://diariodarepublica.pt/dr/geral/en/relevant-legislation/constitution-of-the-portuguese-republic) |
| `state:ROU` | 루마니아 | 통일 루마니아 부재 | 1859년 몰다비아·왈라키아 정치연합; 1862년 루마니아 국명·정부 통합; 1877년 독립 선언; 1878년 국제승인; 1881년 왕국 | 정체성 검토 | 자치 종속 통일국 성립과 독립 주권국 성립은 다른 시점. 1859·1862·1877·1878 중 기준 선택 유보. | [1](https://history.state.gov/countries/romania) · [2](https://www.gov.me/cyr/clanak/crna-gora-i-rumunija-dva-trenutka-nezavisnosti-jedno-trajno-partnerstvo) |
| `state:RUS` | 러시아 | 러시아 제국 | 1917년 제국 붕괴; 1922년 소련 성립(러시아 소비에트 공화국 구성); 1991-12-25 러시아연방의 소련 국제적 권리·의무 승계 | 정체성 검토 | 제국·구성공화국·소련·연방을 한 무중단 주권국으로 자동 연결할 수 없음. UN 법적 승계는 국경·시대별 동일성 증거가 아님. | [1](https://www.un.org/en/about-us/member-states/russian-federation) · [2](https://history.state.gov//countries/russia) |
| `state:SMR` | 산마리노 | 1801년 기존 독립 공화국 | 1862-03-22 이탈리아와 양자 협정; 이후 국가 존속 | 기준일 존속 | 1862년 조약일은 건국일이 아니며 1801년 이전 건국은 조사 제외. | [1](https://www.esteri.sm/pub2/EsteriSM/en/dettaglio_accordi.html?idaccordo=e9422ac8-63a2-4999-a581-bb227524726a) · [2](https://ambsanmarino.esteri.it/it/italia-e-san-marino/) |
| `state:SRB` | 세르비아 | 오스만 통치하 지역 | 1804년 이후 독립운동; 1829~1833년 자치 확대; 1878년 베를린회의 독립 승인; 1918년 남슬라브 왕국 편입; 2006-06-05 세르비아 단독국 지위 선언 | 비연속 검토 | 1878~1918 독립국과 2006~현재 구간을 분리 검토. 유고슬라비아 및 세르비아-몬테네그로 국가연합 승계 법리를 확인해야 함. | [1](https://mfa.gov.rs/en/ministry/history) · [2](https://digitallibrary.un.org/record/1129731?ln=en) |
| `state:SWE` | 스웨덴 | 1801년 기존 독립국 | 1809년 헌정개편; 1814~1905년 노르웨이와 동군연합; 1905년 해소; 20세기 헌정변경 | 기준일 존속 | 국가연합·헌법 변경은 스웨덴 국가 자체의 소멸·재탄생과 다름. | [1](https://www.kungahuset.se/english/the-monarchy-of-sweden) · [2](https://www.riksdagen.se/en/how-the-riksdag-works/democracy/the-constitution/) |
| `state:TUR` | 튀르키예 | 오스만 제국 | 1920-04-23 앙카라 대국민의회 개원; 1922-11-01 술탄제 폐지; 1923-07-24 로잔조약; 1923-10-29 공화국 선포 | 사건일 근거 | 1923년 공화국 출범일은 확인. 오스만 국가의 법적 승계·기본 국명 정체성은 별도 검토. | [1](https://www.ktb.gov.tr/EN-103934/1923.html) · [2](https://www.mfa.gov.tr/turkiye-cumhuriyeti-disisleri-bakanligi-tarihcesi.en.mfa) |

## 공통 미결 사항

1. **1801년에 이미 존재한 국가는 건국일 미상 처리**: `ESP`, `FRA`, `PRT`, `SMR`, `SWE`는 연속성 판단과 실제 건국일 조사 분리. `HUN`, `LIE`는 복합군주국·제후국의 법적 주권 개념을 먼저 심사. 1801년이 역사상 실제 건국일인 `GBR`와 구별해야 함.
2. **점령은 반드시 법적 소멸이 아님**: `EST`, `LTU`, `LVA`, `GEO`, `POL`, `FRA`의 실효 통치·법적 계속성을 별도 축으로 보존. 현 데이터 구조에서 단일 `lifetime` 및 형상 유효기간만으로는 둘을 혼동할 수 있음.
3. **동군연합과 주권 획득**: `NOR`의 1814~1905 스웨덴 동군연합, `HUN`의 1867~1918 오스트리아-헝가리 체제, `LIE`의 1806년 주권 획득은 동일한 병합·독립 개념이 아님.
4. **복수 독립 시기**: `MNE`의 1878~1918/2006~, `SRB`의 1878~1918/2006~, `MCO`의 1814년 독립 회복, `NLD`의 1810년대 프랑스 병합과 회복은 실제 법적 단절일·정체성 추가 판정 필요. `POL`은 1939년 점령 기간에도 망명정부 존재를 고려.
5. **국명 및 승계·국제적 승인**: `RUS`와 소련, `TUR`와 오스만 제국, `ROU`의 통합/주권 획득, `KOS`의 선언·승인 문제를 독립된 심사 대상으로 유지.
6. **정확한 성립일 선택**: `HRV` 1991-06-25 vs 10-08, `MKD` 1991-09-08 vs 09-17, `GRC` 1822 선언 vs 1830 승인, `ISL` 1918 독립 vs 1944 공화국을 자동 단일값으로 환원하지 않음.

## 증거 수준, 데이터 반영 및 검증

- 출처는 각 국가 2개씩 링크했다. 단, `GEO`·`MKD` 등 동일 기관 자료 2개를 제시한 경우가 있고, 일부는 외교 연혁·보조 기록이라 **독립 2차 사료의 엄격한 교차검증 완료를 의미하지 않는다**. 국가별 원법령 효력과 학술적 주권 정의에 관한 추가 검증이 필요하다.
- 이번 조사에서는 공개 기관 문헌·기록과 색인을 읽고, 선정 27개 중복 및 판정 수를 검산했다. `1801`을 임의 건국일로 변환하지 않았고, 별도 국가의 형상·날짜도 수정하지 않았다.
- **수정 파일**: 이 문서 및 `reports/README.md` 보고서 색인 **뿐**. `assets/data/` 국가 데이터·객체 `lifetime`, 웹/Qt 앱 코드, `main`, GitHub Pages 변경 없음.
- **미실행**: 국가별 원문 법률의 최종 법적 동일성 판정, 모든 사료 독립 2중 검증, 1801 이전 역사 조사, 역사 경계 디지타이징, GIS 비교·앱 빌드·웹 회귀 테스트, 기간 입력 및 배포.
- 후속: 상태가 미확정인 국가의 결정 기준을 승인받은 뒤 **1801년 이후의 화면·자료 적용 계획을 별도 수립**한다. A–D 기존 문헌에 적힌 1801년 이전 연혁은 이번 구현 범위 밖이며 자동 승계하지 않는다.

## 관련 문서

- [GEO-LIFE-001 A–D 32개 조사](country-lifetime-a-d-2026-10-13.md) — 중복 대상 제외.
- [GEO-023 이전 90개 국가기간 근거](verified-entity-lifetimes.md).
- [통합 보고서 색인](../README.md).
