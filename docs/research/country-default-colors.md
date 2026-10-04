# 국가 고유 기본색 확정표

확정일: 2026-10-04. 기본 객체 207개와 역사 라이브러리의 최상위 일반 객체 11개를 대상으로 한다. 214개에 색을 지정하고 4개는 미지정으로 둔다.

값의 기준 파일은 [country-default-colors.json](./country-default-colors.json)이다. 이 문서의 표는 해당 JSON에서 생성했다. `pnpm build:country-default-colors`로 앱이 사용하는 표시 자료를 생성한다.

앱은 지정색이 없는 국가에 이 기본색을 적용하고, 지정색 초기화 시 기본색으로 돌아간다. 저장된 사용자 지정색은 유지한다. 국가색 표시를 끄면 기본색과 지정색 모두 숨겨 기존 지도·지형 표현을 사용한다. 미지정 네 지역과 새로 만든 국가는 색을 부여하지 않는다. 하위단위는 기존 상위 색상 상속 규칙을 따른다. 라이브러리 객체는 원본 library ID로 기본색을 결정하므로 이름을 바꿔도 색이 유지된다.

## 적용 기준

- 사용자가 확정한 색과 미지정 지시를 우선한다.
- 기본 국가의 기존 HOI4 1936 MapChart 참조색을 유지하고, 없는 국가는 Millennium Dawn 정치지도 color로 보충한다.
- 역사 국가에는 해당 역사 객체에 대응하는 참조색만 사용한다. 현대 러시아와 소련, 체코와 체코슬로바키아는 별개다.
- color_ui와 게임 렌더링의 채도·명도 보정은 적용하지 않는다.
- null은 고유색 미지정이며 회색이나 임의의 대체색을 넣지 않는다.
- 하위단위의 독립 색상은 이번 국가 기본색 확정 범위에 포함하지 않는다.

## 사용자 지정색

| 객체 | 색상 |
|---|---|
| 유엔 키프로스 완충 지대 | `#009EDB` |
| 쿡 제도 | `#496A9C` |
| 니우에 | `#E2C65A` |
| 동독 | `#8B1A1A` |
| 동프로이센·서프로이센·북슐레스비히 | `#003153` |

남극, 비르 타윌, 시아첸 빙하, 사우던 파타고니안 아이스 필드는 고유색을 지정하지 않는다.

## 출처

- [HOI4 1936 MapChart 프리셋](https://www.mapchart.net/txt/mapchartSave__hearts_of_iron_iv_provinces__1936.txt): 참조색이며 게임 원본 RGB와 완전 일치하는지는 미확인.
- [Millennium Dawn 원본](https://github.com/MillenniumDawn/Millennium-Dawn/blob/ec95c501d9488c4bc407463c0f09bdd9747943ad/common/countries/colors.txt): 정치지도용 color를 사용하며 color_ui는 사용하지 않음.
- [Cold War: Iron Curtain 원본](https://github.com/Cold-War-Iron-Curtain-Dev-Team/ColdWarIronCurtain/blob/fa8ab452d2650932a02f13f555abb01b7d3447b7/Cold%20War%20Iron%20Curtain/common/countries/colors.txt): DDR의 color = rgb { 139 26 26 }.
- [유엔 색상 자료](https://www.un.org/sites/un2.un.org/files/2020/03/un75_logo_guidelines_oct_2019.pdf)와 [프로이센 블루](https://www.colorhexa.com/003153).
- 소스 커밋·SHA-256·객체 대응은 JSON에 기록했다. 기존 국가 형상·분류·계층·표시 설정은 변경하지 않았다.

## 기본 객체

| 객체 ID | 이름 | 기본색 | 출처 | 소스 객체 / 태그 |
|---|---|---|---|---|
| IDN | 인도네시아 | `#FFB25F` | HOI4 1936 참조 | Dutch East Indies |
| MYS | 말레이시아 | `#FF4979` | HOI4 1936 참조 | British Malaya |
| CHL | 칠레 | `#CA828B` | HOI4 1936 참조 | Chile |
| BOL | 볼리비아 | `#FFEAB1` | HOI4 1936 참조 | Bolivian Republic |
| PER | 페루 | `#FFF6FF` | HOI4 1936 참조 | Peru |
| ARG | 아르헨티나 | `#BDCCFF` | HOI4 1936 참조 | Argentina |
| CYP | 키프로스 | `#E6E6E6` | Millennium Dawn | Cyprus / CYP |
| IND | 인도 | `#C80A0A` | HOI4 1936 참조 | British Raj |
| CHN | 중화인민공화국 | `#CC3333` | HOI4 1936 참조 | Chinese Soviet Republic |
| ISR | 이스라엘 | `#0038B8` | Millennium Dawn | Israel / ISR |
| PSX | 팔레스타인 | `#B3CDE3` | HOI4 1936 참조 | Mandatory Palestine |
| LBN | 레바논 | `#FB8072` | HOI4 1936 참조 | Lebanese Republic |
| ETH | 에티오피아 | `#C3A5F5` | HOI4 1936 참조 | Ethiopia |
| SDS | 남수단 | `#FCDD09` | Millennium Dawn | South Sudan / SSU |
| SOM | 소말리아 | `#4189DD` | Millennium Dawn | Somalia / SOM |
| KEN | 케냐 | `#BB0000` | Millennium Dawn | Kenya / KEN |
| MWI | 말라위 | `#CE1126` | Millennium Dawn | Malawi / MLW |
| TZA | 탄자니아 | `#65ACB6` | Millennium Dawn | Tanzania / TNZ |
| SYR | 시리아 | `#FDBF6F` | HOI4 1936 참조 | Republic of Syria |
| SOL | 소말릴란드 | `#DF0000` | Millennium Dawn | Somaliland / SML |
| FRA | 프랑스 | `#4993FF` | HOI4 1936 참조 | France |
| SUR | 수리남 | `#B40A2D` | Millennium Dawn | Suriname / SUR |
| GUY | 가이아나 | `#FCD116` | Millennium Dawn | Guyana / GUY |
| KOR | 대한민국 | `#003478` | Millennium Dawn | Korea / KOR |
| PRK | 조선민주주의인민공화국 | `#A50000` | Millennium Dawn | North Korea / NKO |
| MAR | 모로코 | `#C1272D` | Millennium Dawn | Morocco / MOR |
| SAH | 서사하라 | `#6B9B7F` | Millennium Dawn | Sahrawi / SHA |
| CRI | 코스타리카 | `#927A30` | HOI4 1936 참조 | Costa Rica |
| NIC | 니카라과 | `#92B2BF` | HOI4 1936 참조 | Nicaragua |
| COG | 콩고 공화국 | `#DC241F` | Millennium Dawn | Congo / CNG |
| COD | 콩고 민주 공화국 | `#B9A087` | HOI4 1936 참조 | Belgian Congo |
| BTN | 부탄 | `#AC7A58` | HOI4 1936 참조 | Bhutan |
| UKR | 우크라이나 | `#005AB9` | Millennium Dawn | Ukraine / UKR |
| BLR | 벨라루스 | `#8E9B52` | Millennium Dawn | Belarus / BLR |
| NAM | 나미비아 | `#AFFF70` | Millennium Dawn | Namibia / NAM |
| ZAF | 남아프리카 공화국 | `#BE96FA` | HOI4 1936 참조 | South Africa |
| OMN | 오만 | `#A65628` | HOI4 1936 참조 | Sultanate of Muscat and Oman |
| UZB | 우즈베키스탄 | `#4372B8` | Millennium Dawn | Uzbekistan / UZB |
| KAZ | 카자흐스탄 | `#6EAAB2` | Millennium Dawn | Kazakhstan / KAZ |
| TJK | 타지키스탄 | `#6FAA74` | Millennium Dawn | Tajikistan / TAJ |
| LTU | 리투아니아 | `#FFFF9B` | HOI4 1936 참조 | Lithuania |
| BRA | 브라질 | `#62BD52` | HOI4 1936 참조 | Second Brazilian Republic |
| URY | 우루과이 | `#ABBE99` | HOI4 1936 참조 | Uruguay |
| MNG | 몽골 | `#5A771D` | HOI4 1936 참조 | Mongolia |
| RUS | 러시아 | `#3A9915` | Millennium Dawn | Russia / SOV |
| CZE | 체코 | `#6E63A2` | Millennium Dawn | Czech Republic / CZE |
| DEU | 독일 | `#525252` | HOI4 1936 참조 | German Reich |
| EST | 에스토니아 | `#63CDFE` | HOI4 1936 참조 | Estonia |
| LVA | 라트비아 | `#7B7CB8` | HOI4 1936 참조 | Latvia |
| NOR | 노르웨이 | `#623C3C` | HOI4 1936 참조 | Norway |
| SWE | 스웨덴 | `#2EADFF` | HOI4 1936 참조 | Sweden |
| FIN | 핀란드 | `#FFFFFF` | HOI4 1936 참조 | Finland |
| VNM | 베트남 | `#F7EC14` | Millennium Dawn | Vietnam / VIE |
| KHM | 캄보디아 | `#724735` | Millennium Dawn | Cambodia / CBD |
| LUX | 룩셈부르크 | `#8ADBA2` | HOI4 1936 참조 | Luxembourg |
| ARE | 아랍에미리트 | `#808080` | Millennium Dawn | United Arab Emirates / UAE |
| BEL | 벨기에 | `#FBDF0A` | HOI4 1936 참조 | Belgium |
| GEO | 조지아 | `#FFECEC` | Millennium Dawn | Georgia / GEO |
| MKD | 북마케도니아 | `#E97300` | Millennium Dawn | Macedonia / FYR |
| ALB | 알바니아 | `#C23B85` | HOI4 1936 참조 | Albania |
| AZE | 아제르바이잔 | `#00B9E4` | Millennium Dawn | Azerbaijan / AZE |
| KOS | 코소보 | `#3974D3` | Millennium Dawn | Kosovo / KOS |
| TUR | 튀르키예 | `#C7E9B4` | HOI4 1936 참조 | Turkey |
| ESP | 에스파냐 | `#FFFF79` | HOI4 1936 참조 | Spain |
| LAO | 라오스 | `#D71F26` | Millennium Dawn | Laos / LAO |
| KGZ | 키르기스스탄 | `#FF8400` | Millennium Dawn | Kyrgyzstan / KYR |
| ARM | 아르메니아 | `#FF6400` | Millennium Dawn | Armenia / ARM |
| DNK | 덴마크 | `#C79679` | HOI4 1936 참조 | Denmark |
| LBY | 리비아 | `#00A651` | Millennium Dawn | Libya / LBA |
| TUN | 튀니지 | `#E70013` | Millennium Dawn | Tunisia / TUN |
| ROU | 루마니아 | `#FFFF77` | HOI4 1936 참조 | Romania |
| HUN | 헝가리 | `#FFA47F` | HOI4 1936 참조 | Kingdom of Hungary |
| SVK | 슬로바키아 | `#EE1C25` | Millennium Dawn | Slovakia / SLO |
| POL | 폴란드 | `#FF7789` | HOI4 1936 참조 | Poland |
| IRL | 아일랜드 | `#68CF75` | HOI4 1936 참조 | Ireland |
| GBR | 영국 | `#FF4879` | HOI4 1936 참조 | United Kingdom |
| GRC | 그리스 | `#79EBFF` | HOI4 1936 참조 | Kingdom of Greece |
| ZMB | 잠비아 | `#198A00` | Millennium Dawn | Zambia / ZAM |
| SLE | 시에라리온 | `#0072C6` | Millennium Dawn | Sierra Leone / SIE |
| GIN | 기니 | `#009460` | Millennium Dawn | Guinea / GUI |
| LBR | 라이베리아 | `#CDAFFF` | HOI4 1936 참조 | Liberia |
| CAF | 중앙아프리카 공화국 | `#D21034` | Millennium Dawn | Central African Republic / CAR |
| SDN | 수단 | `#007229` | Millennium Dawn | Sudan / SUD |
| DJI | 지부티 | `#12AD2B` | Millennium Dawn | Djibouti / DJI |
| ERI | 에리트레아 | `#EA0437` | Millennium Dawn | Eritrea / ERI |
| AUT | 오스트리아 | `#FFFEFF` | HOI4 1936 참조 | Austria |
| IRQ | 이라크 | `#E79481` | HOI4 1936 참조 | Iraq |
| ITA | 이탈리아 | `#56A552` | HOI4 1936 참조 | Italy |
| CHE | 스위스 | `#C15151` | HOI4 1936 참조 | Switzerland |
| IRN | 이란 | `#5C927E` | HOI4 1936 참조 | Iran |
| NLD | 네덜란드 | `#FFB35F` | HOI4 1936 참조 | Netherlands |
| LIE | 리히텐슈타인 | `#210EC4` | Millennium Dawn | Liechtenstein / LIC |
| CIV | 코트디부아르 | `#F77F00` | Millennium Dawn | Cote D'Ivoire / CDI |
| SRB | 세르비아 | `#C6363C` | Millennium Dawn | Serbia / SER |
| MLI | 말리 | `#C1AB08` | Millennium Dawn | Mali / MAL |
| SEN | 세네갈 | `#E31B23` | Millennium Dawn | Senegal / SEN |
| NGA | 나이지리아 | `#E15505` | Millennium Dawn | Nigeria / NIG |
| BEN | 베냉 | `#FCD116` | Millennium Dawn | Benin / BEN |
| AGO | 앙골라 | `#AF0000` | Millennium Dawn | Angola / AGL |
| HRV | 크로아티아 | `#171796` | Millennium Dawn | Croatia / CRO |
| SVN | 슬로베니아 | `#005DA4` | Millennium Dawn | Slovenia / SLV |
| QAT | 카타르 | `#8D1B3D` | Millennium Dawn | Qatar / QAT |
| SAU | 사우디아라비아 | `#DEF7C6` | HOI4 1936 참조 | Saudi Arabia |
| BWA | 보츠와나 | `#75AADB` | Millennium Dawn | Botswana / BOT |
| ZWE | 짐바브웨 | `#DE2010` | Millennium Dawn | Zimbabwe / ZIM |
| PAK | 파키스탄 | `#006400` | Millennium Dawn | Pakistan / PAK |
| BGR | 불가리아 | `#329A00` | HOI4 1936 참조 | Bulgaria |
| THA | 태국 | `#D7F0C8` | HOI4 1936 참조 | Siam |
| SMR | 산마리노 | `#5EB6E4` | Millennium Dawn | San Marino / SMA |
| HTI | 아이티 | `#AB6F72` | HOI4 1936 참조 | Haiti |
| DOM | 도미니카 공화국 | `#BEA0F0` | HOI4 1936 참조 | Dominican Republic |
| TCD | 차드 | `#D7C448` | Millennium Dawn | Chad / CHA |
| KWT | 쿠웨이트 | `#B3DE69` | HOI4 1936 참조 | Sheikhdom of Kuwait |
| SLV | 엘살바도르 | `#FABE78` | HOI4 1936 참조 | El Salvador |
| GTM | 과테말라 | `#473070` | HOI4 1936 참조 | Guatemala |
| TLS | 동티모르 | `#7607C8` | Millennium Dawn | East Timor / TIM |
| BRN | 브루나이 | `#AAAA32` | Millennium Dawn | Brunei / BRU |
| MCO | 모나코 | `#962C03` | Millennium Dawn | Monaco / MNC |
| DZA | 알제리 | `#006233` | Millennium Dawn | Algeria / ALG |
| MOZ | 모잠비크 | `#007168` | Millennium Dawn | Mozambique / MOZ |
| SWZ | 에스와티니 | `#3E5EB9` | Millennium Dawn | Swaziland / SWA |
| BDI | 부룬디 | `#CE1126` | Millennium Dawn | Burundi / BUR |
| RWA | 르완다 | `#20603D` | Millennium Dawn | Rwanda / RWA |
| MMR | 미얀마 | `#DECBE4` | HOI4 1936 참조 | British Burma |
| BGD | 방글라데시 | `#006951` | Millennium Dawn | Bangladesh / BAN |
| AND | 안도라 | `#FF5A00` | Millennium Dawn | Andorra / ADO |
| AFG | 아프가니스탄 | `#53D0D9` | HOI4 1936 참조 | Afghanistan |
| MNE | 몬테네그로 | `#D3AE3B` | Millennium Dawn | Montenegro / MNT |
| BIH | 보스니아헤르체고비나 | `#FECB00` | Millennium Dawn | Bosnia / BOS |
| UGA | 우간다 | `#C1AB08` | Millennium Dawn | Uganda / UGA |
| CUB | 쿠바 | `#8B40A6` | HOI4 1936 참조 | Cuba |
| HND | 온두라스 | `#809141` | HOI4 1936 참조 | Honduras |
| ECU | 에콰도르 | `#FFBE7F` | HOI4 1936 참조 | Ecuador |
| COL | 콜롬비아 | `#FFF375` | HOI4 1936 참조 | Colombia |
| PRY | 파라과이 | `#4696FA` | HOI4 1936 참조 | Republic of Paraguay |
| PRT | 포르투갈 | `#33965B` | HOI4 1936 참조 | Portugal |
| MDA | 몰도바 | `#B77000` | Millennium Dawn | Moldova / MLV |
| TKM | 투르크메니스탄 | `#CA3745` | Millennium Dawn | Turkmenistan / TRK |
| JOR | 요르단 | `#FFFFB3` | HOI4 1936 참조 | Emirate of Transjordan |
| NPL | 네팔 | `#C8AAFA` | HOI4 1936 참조 | Nepal |
| LSO | 레소토 | `#00209F` | Millennium Dawn | Lesotho / LES |
| CMR | 카메룬 | `#007A5E` | Millennium Dawn | Cameroon / CAM |
| GAB | 가봉 | `#FCD116` | Millennium Dawn | Gabon / GAB |
| NER | 니제르 | `#008751` | Millennium Dawn | Niger / NGR |
| BFA | 부르키나파소 | `#EF2B2D` | Millennium Dawn | Burkina Faso / BFA |
| TGO | 토고 | `#006A4E` | Millennium Dawn | Togo / TOG |
| GHA | 가나 | `#CE1126` | Millennium Dawn | Ghana / GAH |
| GNB | 기니비사우 | `#FCD116` | Millennium Dawn | Guinea Bissau / GUB |
| USA | 미국 | `#57A1FF` | HOI4 1936 참조 | United States |
| CAN | 캐나다 | `#9B3E33` | HOI4 1936 참조 | Dominion of Canada |
| MEX | 멕시코 | `#86C66C` | HOI4 1936 참조 | Mexico |
| BLZ | 벨리즈 | `#CE1126` | Millennium Dawn | Belize / BLZ |
| PAN | 파나마 | `#9E8ADD` | HOI4 1936 참조 | Panama |
| VEN | 베네수엘라 | `#ACBE99` | HOI4 1936 참조 | Venezuela |
| PNG | 파푸아뉴기니 | `#3C4678` | Millennium Dawn | Papua New Guinea / PAP |
| EGY | 이집트 | `#C09300` | Millennium Dawn | Egypt / EGY |
| YEM | 예멘 | `#905D5D` | HOI4 1936 참조 | Yemen |
| MRT | 모리타니 | `#00A651` | Millennium Dawn | Mauritania / MAU |
| GNQ | 적도기니 | `#009BC9` | Millennium Dawn | Equatorial Guinea / EGU |
| GMB | 감비아 | `#0C1C8C` | Millennium Dawn | Gambia / GAM |
| VAT | 바티칸 시국 | `#C1AB08` | Millennium Dawn | Holy See / HLS |
| CYN | 북키프로스 | `#F91313` | Millennium Dawn | Northern Cyprus / NCY |
| CNM | 유엔 키프로스 완충 지대 | `#009EDB` | 유엔 블루 | UN blue |
| KAS | 시아첸빙하 | **미지정** | 사용자 지시 |  |
| SPI | 남부파타고니아빙원 | **미지정** | 사용자 지시 |  |
| BRT | 비르타윌 | **미지정** | 사용자 지시 |  |
| ATA | 남극 | **미지정** | 사용자 지시 |  |
| AUS | 오스트레일리아 | `#49BB7E` | HOI4 1936 참조 | Australia |
| FJI | 피지 | `#5AAAD2` | Millennium Dawn | Fiji / FIJ |
| NZL | 뉴질랜드 | `#B99BEB` | HOI4 1936 참조 | New Zealand |
| MDG | 마다가스카르 | `#FC3D32` | Millennium Dawn | Madagascar / MAD |
| PHL | 필리핀 | `#B496E6` | HOI4 1936 참조 | Philippines |
| LKA | 스리랑카 | `#FFB700` | Millennium Dawn | Sri Lanka / SRI |
| BHS | 바하마 | `#00ABC9` | Millennium Dawn | Bahamas / BAH |
| TWN | 중화민국 | `#DFE5A0` | HOI4 1936 참조 | China |
| JPN | 일본 | `#FEE8C8` | HOI4 1936 참조 | Japan |
| ISL | 아이슬란드 | `#C79779` | HOI4 1936 참조 | Iceland |
| SYC | 세이셸 | `#00FAAA` | Millennium Dawn | Seychelles / SEY |
| KIR | 키리바시 | `#D48CBF` | Millennium Dawn | Kiribati / KIR |
| MHL | 마셜제도 | `#D03645` | Millennium Dawn | Marshall Islands / MAR |
| TTO | 트리니다드토바고 | `#511D53` | Millennium Dawn | Trinidad / TRI |
| GRD | 그레나다 | `#BED264` | Millennium Dawn | Grenada / GRA |
| VCT | 세인트빈센트그레나딘 | `#8CDCD2` | Millennium Dawn | St.Vincent and the Grenadines / STV |
| BRB | 바베이도스 | `#1432C8` | Millennium Dawn | Barbados / BAR |
| LCA | 세인트루시아 | `#3C78B4` | Millennium Dawn | St.Lucia / STL |
| DMA | 도미니카 연방 | `#777A69` | Millennium Dawn | Dominica / DMI |
| ATG | 앤티가바부다 | `#CEC0AF` | Millennium Dawn | Antigua and Barbuda / ANT |
| KNA | 세인트키츠네비스 | `#5CACD7` | Millennium Dawn | St.Kitts and Nevis / STK |
| JAM | 자메이카 | `#7FB61D` | Millennium Dawn | Jamaica / JAM |
| MUS | 모리셔스 | `#141478` | Millennium Dawn | Mauritius / MRT |
| COM | 코모로 | `#F0820A` | Millennium Dawn | Comoros / COM |
| STP | 상투메프린시페 | `#12F3B2` | Millennium Dawn | Sao Tome / SAO |
| CPV | 카보베르데 | `#44D299` | Millennium Dawn | Cape Verde / VER |
| MLT | 몰타 | `#A00000` | Millennium Dawn | Malta / MLT |
| SGP | 싱가포르 | `#FFFFFF` | Millennium Dawn | Singapore / SIN |
| COK | 쿡제도 | `#496A9C` | 직접 확정 | 쿡 제도 추천색 |
| TON | 통가 | `#9882BF` | Millennium Dawn | Tonga / TON |
| WSM | 사모아 | `#CB6D14` | Millennium Dawn | Samoa / SAM |
| SLB | 솔로몬제도 | `#B45000` | Millennium Dawn | Solomon Islands / SOL |
| TUV | 투발루 | `#166D57` | Millennium Dawn | Tuvalu / TUL |
| MDV | 몰디브 | `#C8D26E` | Millennium Dawn | Maldives / MLD |
| NRU | 나우루 | `#403515` | Millennium Dawn | Nauru / NAU |
| FSM | 미크로네시아 연방 | `#28C878` | Millennium Dawn | Micronesian Federation / MIC |
| VUT | 바누아투 | `#AA8FC0` | Millennium Dawn | Vanuatu / VAN |
| NIU | 니우에 | `#E2C65A` | 직접 확정 | 니우에 추천색 |
| PLW | 팔라우 | `#7B5714` | Millennium Dawn | Palau / PAU |
| BHR | 바레인 | `#475139` | Millennium Dawn | Bahrain / BHR |

## 역사 국가

| 객체 ID | 이름 | 기본색 | 출처 | 소스 객체 / 태그 |
|---|---|---|---|---|
| historical-country:czechoslovakia | 체코슬로바키아 | `#46D8CB` | HOI4 1936 참조 | Czechoslovakia |
| historical-country:soviet-union | 소련 | `#A3101F` | HOI4 1936 참조 | Soviet Union |
| historical-country:ukraine | 우크라이나 | `#005AB9` | Millennium Dawn | Ukraine / UKR |
| historical-country:yugoslavia | 유고슬라비아 | `#5E5EA4` | HOI4 1936 참조 | Yugoslavia |
| historical-country:sudan | 수단 | `#007229` | Millennium Dawn | Sudan / SUD |
| historical-country:indonesia | 인도네시아 | `#FFB25F` | HOI4 1936 참조 | Dutch East Indies |
| historical-country:east-prussia | 동프로이센주 | `#003153` | 프로이센 블루 | Prussian blue |
| historical-country:deutsche-demokratische-republik | 독일 민주공화국 | `#8B1A1A` | Cold War: Iron Curtain | East Germany / DDR |
| historical-country:nagorno-karabakh | 나고르노카라바흐 | `#E68C14` | Millennium Dawn | Artsakh / NKR |
| historical-country:west-prussia | 서프로이센주 | `#003153` | 프로이센 블루 | Prussian blue |
| historical-country:north-schleswig | 북슐레스비히 | `#003153` | 프로이센 블루 | Prussian blue |
