/** Reconstruct the human-readable GeoNames statistics section without replacing source notes. */
import { DETAIL_COUNTRIES, POLICY } from './geonames-policy.mjs';
import { table } from './geonames-review.mjs';

const fmt = n => Number(n).toLocaleString('en-US');
const tick = s => '\x60' + s + '\x60';
const items = object => Object.entries(object||{});
const get = (record,key) => record?.[key] || 0;
export function renderStatistics(stats) {
  const parts=['## 재생성 가능한 실측 통계','','### 원본과 무결성',''];
  for(const [name,metadata] of items(stats.sources)){
    parts.push('- ['+name+']('+metadata.url+'): 다운로드 '+tick(metadata.downloadedAt)
      +'; 서버 수정 '+tick(metadata.lastModified)+'; ZIP 내부 시각 '
      +tick(metadata.zipMemberTimestamp)+' (시간대 미표기); '+fmt(metadata.bytes)+' bytes.');
    parts.push('  SHA-256 '+tick(metadata.sha256)+'. GeoNames 원본, '+metadata.license+'.');
  }
  const primary=stats.primary,total=stats.totals;
  parts.push('', '주 원본: '+tick(stats.primarySource)+'. alternateNames는 후보 파일에서 생략했다.', '',
    table(['지표','건수'],[
      ['원본 전체',primary.rawRows],['featureClass P',primary.featureClassPRows],
      ['최종 후보',total.totalKept],['인구 ≥1M',total.population1mPlus],
      ['인구 ≥100k (1M 포함)',total.population100kPlus],
      ['인구 50k–99,999',get(total.populationBuckets,'50k-99k')],
      ['저인구 행정중심',total.under50kAdminSeats],
    ]),
    '', '### 최종 feature code / 인구 구간 / 모드','',
    table(['featureCode','최종 건수'],items(total.featureCodes)),'',
    table(['populationBucket','건수'],items(total.populationBuckets)),'',
    table(['preliminaryDisplayMode','건수'],items(total.displayModes)),
    '', '### 제외한 P 코드 (주 원본)','',table(['code','건수'],items(primary.excludedPCodes)),
    '', '### 모든 원본 국가 코드별 후보 수','',
    '국가 코드와 종속 영토 코드를 그대로 사용한다. 후보가 0인 코드도 대조 원본에 있으면 표시한다.','',
    table(['countryCode','최종 후보'],items(stats.countryCounts)),
    '', '### 6개 국가 상세','',
    table(['country','totalKept','50k+','100k+','under50kAdmin','PPLC','PPLG','PPLA','PPLA2'],
      items(stats.countryDetails).map(([code,data])=>[code,data.totalKept,data.population50kPlus,
        data.population100kPlus,data.under50kAdminSeats,
        ...Object.keys(POLICY.adminReasons).map(key=>get(data.featureCodes,key))]))
  );
  for(const [code,data] of items(stats.countryDetails)){
    parts.push('', '#### '+code+': 인구 상위 30','',
      table(['ID','이름','코드','인구','admin1 / admin2'],data.top30.map(row=>[
        row.geonameId,row.name,row.featureCode,row.population,row.admin1Code+' / '+row.admin2Code])),
      '', '#### '+code+': 저인구 행정중심 표본','',
      '가장 작은 6개 + 5만에 가장 가까운 6개(중복 ID 제외). 전수 판정이 아닌 검토 표본이다.','',
      table(['ID','이름','코드','인구'],data.under50kAdminSamples.map(row=>[
        row.geonameId,row.name,row.featureCode,row.population])));
    parts.push('','인구 1천 미만 행정중심 '+fmt(data.under1000AdminSeats)+'개 (인구 0/미상 포함).');
    if(code==='KR')parts.push('', '#### KR: 전체 후보 sanity check','',
      table(['ID','이름','코드','인구'],data.allRows.map(row=>[
        row.geonameId,row.name,row.featureCode,row.population])));
  }
  const audit=stats.audit;
  parts.push('','### 자동 과다수록 신호','',
    table(['신호','건수'],[
      ['이름에 구역/시설 키워드',audit.nameSignalCount],
      ['한국 미세 지명 접미사',audit.koreanMicroNameCount],
      ['정확히 같은 좌표의 복수 후보 그룹',audit.exactCoordinateClusterCount],
      ['해당 그룹 내 후보',audit.exactCoordinateCandidateCount],
      ['최대 그룹 크기',audit.largestExactCoordinateCluster],
      ['같은 국가·정규화 이름, 1km 내 ID 쌍',audit.nearSameNamePairCount],
      ['countryCode 없음',audit.missingCountryCodeCount],
      ['유지한 인구 0 후보',audit.zeroPopulationKeptCount],
    ]),
    '', '이름 신호는 오탐을 포함하며 POI/구역 확정 판정이 아니다. 모든 다른 ID는 그대로 남겼다.','',
    table(['ID','국가','이름','코드','인구'],audit.nameSignalSamples.map(row=>[
      row.geonameId,row.countryCode,row.name,row.featureCode,row.population])),
    '', '#### 한국 미세 지명 이름 신호 전체','',
    table(['ID','이름','코드','인구'],audit.koreanMicroNameRows.map(row=>[
      row.geonameId,row.name,row.featureCode,row.population])),
    '', '#### 한국 alternateNames 미세 지명 접미사 신호','',
    '원본 별칭만 감사에 사용한다. 후보에는 alternateNames를 복제하지 않으며, 이 신호도 자동 제외에 사용하지 않는다.',
    '대구·영동·구리·안동·하동처럼 정상 도시 이름의 끝 글자나 오래된 별칭도 걸리므로 미세 지명 확정 건수가 아니다.','',
    table(['ID','이름','코드','인구','별칭 신호'],auditPrimary(stats).map(row=>[
      row.geonameId,row.name,row.featureCode,row.population,row.matchedAliases.join(', ')])),
    '', '#### 근접 동명 ID 쌍 (최대 30)','',
    table(['국가','이름','IDs','거리 m'],audit.nearSameNamePairSamples.map(row=>[
      row.countryCode,row.name,row.ids,row.distanceMeters])));
  const supplement=stats.supplement;
  if(supplement){
    parts.push('','### allCountries 전체 원본 대조 (필터 변경 없음)','',
      '전체 '+fmt(supplement.rawRows)+'행, P '+fmt(supplement.featureClassPRows)+'행, 같은 정책의 유효 후보 '+fmt(supplement.eligibleCount)+'개.','',
      'cities500에 없는 유효 후보 '+fmt(supplement.eligibleMissingFromPrimary.length)
      +'개; 대조 원본에 없는 주 후보 '+fmt(supplement.primaryAbsentFromSupplement.length)
      +'개; 같은 ID의 내용 차이 '+fmt(supplement.changedPrimaryIds.length)+'개.','',
      table(['제외 코드','전체 제외','그중 인구 0'],items(supplement.excludedPCodes)
        .map(([code,count])=>[code,count,get(supplement.populationZeroExcludedByCode,code)])),
      '', '빈 인구 필드(P): '+fmt(Object.values(supplement.populationMissingByCode).reduce((a,b)=>a+b,0))+'행. 인구 0 전체와 구분한다.',
      '', '#### 전 국가별 제외 PPLA3 5만+ 감사 대상 수','',
      table(['국가','건수'],items(supplement.largeExcludedPPLA3Counts)),
      '', '#### 제외된 PPLA3 중 5만+ 표본','');
    for(const code of DETAIL_COUNTRIES)parts.push('**'+code+'**','',
      table(['ID','이름','인구'],(supplement.largeExcludedPPLA3Samples[code]||[])
        .map(row=>[row.geonameId,row.name,row.population])),'');
    parts.push('#### 인구 0으로 제외된 P 기록 표본 (6개 국가, 원본 ID 순 최대 12)','',
      '이 표본은 중요한 도시 확정 목록이 아니다. 특히 마을/리 레코드도 많아 인구 0만으로 전부 복원할 수 없다.','',
      table(['국가','ID','이름','코드'],DETAIL_COUNTRIES.flatMap(code=>
        (supplement.populationZeroSamples[code]||[]).map(row=>[
          code,row.geonameId,row.name,row.featureCode]))),
      '#### 고위도 일반 정착지: 1천 이상·5만 미만 제외 표본','',
      '절대 위도 ≥60°라는 검토 신호일 뿐, 유일한 중심지나 원격성의 증명이 아니다. 중심성 계산은 하지 않았다.','',
      table(['ID','국가','이름','인구','위도'],supplement.highLatitudeBelowThresholdSamples
        .map(row=>[row.geonameId,row.countryCode,row.name,row.population,row.latitude])));
  }else parts.push('','allCountries 대조 미수행: fetch-attempts의 실패 원인을 확인한다.');
  parts.push('','### 수집 실패 / 경고','',JSON.stringify(stats.fetchAttempts),'');
  return parts.join('\n');
}
const auditPrimary=stats=>stats.primary.koreanMicroAliasSignals;
