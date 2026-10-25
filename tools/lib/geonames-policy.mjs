/** Canonical GeoNames candidate inclusion policy and read-only audits.
 * No modern code, name, population, or coordinates may approve historical city status.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipTextLines } from './geonames-zip.mjs';

export const BASE_URL = 'https://download.geonames.org/export/dump/';
export const LICENSE = 'CC BY 4.0';
export const POLICY = Object.freeze({
  adminReasons: { PPLC:'capital', PPLG:'capital', PPLA:'admin-seat-1', PPLA2:'admin-seat-2' },
  populationMinimum:50000,autoReviewMinimum:100000,millionMinimum:1000000,
});
export const DETAIL_COUNTRIES = ['KR','JP','CN','IN','US','BR'];
export const GENERATED_START = '<!-- geonames-statistics:start -->';
export const GENERATED_END = '<!-- geonames-statistics:end -->';
export const REVIEW_ACTIONS = new Set(['exclude','hold','retain','inclusion-review']);
const NAME_SIGNALS = /\b(neighbou?rhood|borough|suburb|district|ward|arrondissement|quarter|campus|airport|station|hospital|university|industrial zone)\b/iu;
const KR_MICRO_SIGNALS = /(?:[-\s](?:gu|eup|myeon|dong|ri)|[구읍면동리])$/iu;
const SMALL=1000, NEAR_METERS=1000;
const freshCounter=()=>new Map();
const add=(m,k,amount=1)=>m.set(k,(m.get(k)||0)+amount);
const tally=(rows,key)=>{const c=freshCounter();for(const row of rows)add(c,key(row));return sortedCounts(c);};
const sortedCounts=x=>Object.fromEntries([...x].sort(([a],[b])=>String(a).localeCompare(String(b),'en')));
const byValue=(rows,key)=>{const m=new Map();for(const row of rows){const k=key(row);if(!m.has(k))m.set(k,[]);m.get(k).push(row);}return m;};
export const largest=(rows,n)=>[...rows].sort((a,b)=>b.population-a.population||a.geonameId-b.geonameId).slice(0,n);
const keepSample=(groups,key,row,limit=30)=>groups.set(key,largest([...(groups.get(key)||[]),row],limit));
export async function fileHash(path) {
  const h=createHash('sha256');
  for await(const chunk of createReadStream(path))h.update(chunk);
  return h.digest('hex');
}
export function parseRow(line,context='row'){
  const fields=line.replace(/[\r\n]+$/u,'').split('\t');
  if(fields.length!==19)throw Error(context+': expected 19 columns, got '+fields.length);
  for(const i of [0,14])if(fields[i]!==''&&!/^-?\d+$/u.test(fields[i]))
    throw Error(context+': invalid numeric field');
  const record={
    geonameId:Number(fields[0]),name:fields[1],asciiName:fields[2],
    countryCode:fields[8],admin1Code:fields[10],admin2Code:fields[11],
    latitude:Number(fields[4]),longitude:Number(fields[5]),
    featureClass:fields[6],featureCode:fields[7],
    population:fields[14]?Number(fields[14]):0,timezone:fields[17],modificationDate:fields[18],
  };
  validateRecord(record,context);
  return [record,!fields[14]];
}
export function validateRecord(row,context='row'){
  if(!Number.isSafeInteger(row?.geonameId)||row.geonameId<=0||!row.name)
    throw Error(context+': invalid ID/name');
  for(const [field,limit] of [['latitude',90],['longitude',180]]) {
    if(typeof row[field]!=='number'||!Number.isFinite(row[field])||Math.abs(row[field])>limit)
      throw Error(context+': invalid '+field);
  }
  if(!Number.isSafeInteger(row.population)||row.population<0)throw Error(context+': negative population');
}
export function candidate(row){
  if(row.featureClass!=='P')return null;
  let reason=POLICY.adminReasons[row.featureCode];
  if(reason===undefined){
    if(row.featureCode!=='PPL'||row.population<POLICY.populationMinimum)return null;
    reason='population-50k';
  }
  const population=row.population;
  const bucket=population>=POLICY.millionMinimum?'1m-plus'
    :population>=POLICY.autoReviewMinimum?'100k-999k'
    :population>=POLICY.populationMinimum?'50k-99k':'under-50k-admin';
  return {...row,inclusionReason:reason,populationBucket:bucket,
    preliminaryDisplayMode:population>=POLICY.autoReviewMinimum?'auto-review':'search-only'};
}
export function validateCandidates(rows){
  const seen=new Set();
  for(const row of rows){
    validateRecord(row);
    if(JSON.stringify(candidate(row))!==JSON.stringify(row))
      throw Error('candidate '+row.geonameId+': violates canonical policy or derived fields');
    if(seen.has(row.geonameId))throw Error('duplicate candidate ID '+row.geonameId);
    seen.add(row.geonameId);
  }
}
export function summarize(rows){
  const buckets=tally(rows,r=>r.populationBucket);
  return {totalKept:rows.length,
    population50kPlus:rows.filter(x=>x.population>=POLICY.populationMinimum).length,
    population100kPlus:rows.filter(x=>x.population>=POLICY.autoReviewMinimum).length,
    population1mPlus:buckets['1m-plus']||0,
    under50kAdminSeats:buckets['under-50k-admin']||0,
    under1000AdminSeats:rows.filter(x=>x.population<SMALL&&x.inclusionReason!=='population-50k').length,
    featureCodes:tally(rows,r=>r.featureCode),populationBuckets:buckets,
    displayModes:tally(rows,r=>r.preliminaryDisplayMode)};
}
export async function* sourceRows(name,cache){
  const zip=join(cache,name+'.zip'),metadata=JSON.parse(readFileSync(join(cache,name+'.source.json'),'utf8'));
  if(await fileHash(zip)!==metadata.sha256)throw Error(zip+': snapshot checksum mismatch');
  let number=0;
  for await(const line of zipTextLines(zip,metadata.member))yield [++number,line];
}
export async function scanPrimary(name,cache){
  const kept=[],seen=new Set(),classes=new Map(),codes=new Map(),excluded=new Map(),
    countries=new Map(),samples=new Map(),signals=[];
  let rawRows=0,pRows=0,missingPopulation=0;
  for await(const [number,line] of sourceRows(name,cache)){
    rawRows++;
    const [row,missing]=parseRow(line,name+':'+number);
    add(classes,row.featureClass);add(countries,row.countryCode);
    if(row.featureClass==='P'){pRows++;add(codes,row.featureCode);if(missing)missingPopulation++;}
    const value=candidate(row);
    if(value){
      if(seen.has(row.geonameId))throw Error(name+':'+number+': duplicate geonameId '+row.geonameId);
      seen.add(row.geonameId);kept.push(value);
      if(row.countryCode==='KR'){
        const parts=line.split('\t')[3].split(',').filter(x=>KR_MICRO_SIGNALS.test(x));
        if(parts.length)signals.push({geonameId:row.geonameId,name:row.name,featureCode:row.featureCode,
          population:row.population,matchedAliases:parts.slice(0,4)});
      }
    } else if(row.featureClass==='P'){
      add(excluded,row.featureCode);
      if(row.featureCode==='PPLA3'&&row.population>=POLICY.populationMinimum)
        keepSample(samples,row.countryCode,row);
    }
  }
  return [kept,{rawRows,featureClassPRows:pRows,
    sourceFeatureClasses:sortedCounts(classes),sourcePCodes:sortedCounts(codes),
    excludedPCodes:sortedCounts(excluded),missingPopulationPRows:missingPopulation,
    sourceCountryRows:sortedCounts(countries),
    largeExcludedPPLA3Samples:Object.fromEntries([...samples].sort(([a],[b])=>a.localeCompare(b))),
    koreanMicroAliasSignals:signals}];
}
export function distanceMeters(a,b){
  const lat1=a.latitude*Math.PI/180,lat2=b.latitude*Math.PI/180;
  const dlat=lat2-lat1,dlon=(b.longitude-a.longitude)*Math.PI/180;
  const sine=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
  return 6371008.8*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,sine))));
}
export function auditKept(rows){
  const positions=byValue(rows,r=>JSON.stringify([r.countryCode,r.latitude,r.longitude]));
  const names=byValue(rows,r=>JSON.stringify([r.countryCode,
    (r.asciiName||r.name).normalize('NFKC').toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ').trim()]));
  const signals=rows.filter(r=>NAME_SIGNALS.test(r.name+' '+r.asciiName));
  const korean=rows.filter(r=>r.countryCode==='KR'&&KR_MICRO_SIGNALS.test(r.name));
  const colocated=[...positions.values()].filter(g=>g.length>1).map(g=>largest(g,g.length))
    .sort((a,b)=>b.length-a.length||a[0].geonameId-b[0].geonameId);
  const pairs=[];
  for(const group of names.values())for(let i=0;i<group.length;i++)
    for(let j=i+1;j<group.length;j++){
      const a=group[i],b=group[j],distance=distanceMeters(a,b);
      if(distance<=NEAR_METERS)pairs.push({
        ids:[a.geonameId,b.geonameId].sort((a,b)=>a-b),name:a.name,
        countryCode:a.countryCode,distanceMeters:Math.round(distance*100)/100,
      });
    }
  pairs.sort((a,b)=>a.distanceMeters-b.distanceMeters||
    a.ids[0]-b.ids[0]||a.ids[1]-b.ids[1]);
  return {nameSignalCount:signals.length,nameSignalSamples:largest(signals,40),
    koreanMicroNameCount:korean.length,koreanMicroNameRows:largest(korean,korean.length),
    exactCoordinateClusterCount:colocated.length,
    exactCoordinateCandidateCount:colocated.reduce((n,g)=>n+g.length,0),
    largestExactCoordinateCluster:Math.max(0,...colocated.map(g=>g.length)),
    exactCoordinateSamples:colocated.slice(0,15),
    nearSameNamePairCount:pairs.length,nearSameNamePairSamples:pairs.slice(0,30),
    missingCountryCodeCount:rows.filter(r=>!r.countryCode).length,
    missingCountryCodeSamples:rows.filter(r=>!r.countryCode).slice(0,10),
    zeroPopulationKeptCount:rows.filter(r=>r.population===0).length};
}
export async function scanSupplement(cache,primaryRows){
  const primary=new Map(primaryRows.map(r=>[r.geonameId,r])),eligible=new Set();
  const counts=new Map(),excluded=new Map(),zeroExcluded=new Map(),missing=new Map(),countryRows=new Map(),
    countryExcluded=new Map(),largePPLA3=new Map(),largePPLA3Counts=new Map(),zeroSamples=new Map();
  const highLatitude=[],newCandidates=[],changed=[];
  let rawRows=0,pRows=0;
  for await(const [number,line] of sourceRows('allCountries',cache)){
    rawRows++;
    if(number%2000000===0)console.log('allCountries: scanned '+number.toLocaleString('en')+' rows');
    const fields=line.split('\t');
    if(fields.length!==19)throw Error('allCountries:'+number+': expected 19 fields');
    add(countryRows,fields[8]);
    if(fields[6]!=='P')continue;
    pRows++;
    const [row,absent]=parseRow(line,'allCountries:'+number);
    add(counts,row.featureCode);if(absent)add(missing,row.featureCode);
    const value=candidate(row);
    if(value){
      if(eligible.has(row.geonameId))throw Error('allCountries:'+number+': duplicate eligible ID '+row.geonameId);
      eligible.add(row.geonameId);
      if(!primary.has(row.geonameId))newCandidates.push(value);
      else if(JSON.stringify(value)!==JSON.stringify(primary.get(row.geonameId)))changed.push(row.geonameId);
      continue;
    }
    const code=row.featureCode,country=row.countryCode;
    add(excluded,code);
    if(!countryExcluded.has(country))countryExcluded.set(country,new Map());
    add(countryExcluded.get(country),code);
    if(row.population===0){
      add(zeroExcluded,code);
      if(DETAIL_COUNTRIES.includes(country)&&['PPL','PPLA3','PPLA4','PPLA5'].includes(code))
        keepSample(zeroSamples,country,row,12);
    }
    if(code==='PPLA3'&&row.population>=POLICY.populationMinimum){
      add(largePPLA3Counts,country);keepSample(largePPLA3,country,row);
    }
    if(code==='PPL'&&row.population>=SMALL&&row.population<POLICY.populationMinimum&&Math.abs(row.latitude)>=60)
      highLatitude.push(row);
  }
  return {rawRows,featureClassPRows:pRows,eligibleCount:eligible.size,
    sourcePCodes:sortedCounts(counts),excludedPCodes:sortedCounts(excluded),
    sourceCountryRows:sortedCounts(countryRows),
    excludedByCountry:Object.fromEntries([...countryExcluded].sort(([a],[b])=>a.localeCompare(b))
      .map(([key,v])=>[key,sortedCounts(v)])),
    populationMissingByCode:sortedCounts(new Map([...missing].filter(([,v])=>v))),
    populationZeroExcludedByCode:sortedCounts(zeroExcluded),
    populationZeroSamples:Object.fromEntries([...zeroSamples].sort(([a],[b])=>a.localeCompare(b))),
    largeExcludedPPLA3Samples:Object.fromEntries([...largePPLA3].sort(([a],[b])=>a.localeCompare(b))),
    largeExcludedPPLA3Counts:sortedCounts(largePPLA3Counts),
    highLatitudeBelowThresholdSamples:highLatitude,
    eligibleMissingFromPrimary:largest(newCandidates,newCandidates.length),
    primaryAbsentFromSupplement:[...primary.keys()].filter(id=>!eligible.has(id)).sort((a,b)=>a-b),
    changedPrimaryIds:changed.sort((a,b)=>a-b)};
}
export { sortedCounts };
