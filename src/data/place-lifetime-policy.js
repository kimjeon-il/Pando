import {temporalMonthEnd} from "../document/temporal.js";

const schema='pando-place-urban-lifetimes-v1';
const validDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [year,month,day]=value.split('-').map(Number);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return year>0&&month>=1&&month<=12&&day>=1&&day<=days[month-1];
};
const startOf=interval=>interval.fromDate||(
  Number.isInteger(interval.fromYear)?String(interval.fromYear).padStart(4,'0')+'-01-01':null);
const endOf=interval=>interval.untilDateExclusive||(
  Number.isInteger(interval.untilYear)?String(interval.untilYear).padStart(4,'0')+'-01-01':null);
const validBoundary=interval=>{
  if(interval.fromDate!==undefined&&!validDate(interval.fromDate))return false;
  if(interval.untilDateExclusive!==undefined&&!validDate(interval.untilDateExclusive))return false;
  for(const y of [interval.fromYear,interval.untilYear])
    if(y!==undefined&&(!Number.isInteger(y)||y<1||y>9999))return false;
  if(interval.fromYear!==undefined&&interval.fromDate!==undefined)return false;
  if(interval.untilYear!==undefined&&interval.untilDateExclusive!==undefined)return false;
  const start=startOf(interval),end=endOf(interval);
  return (start!==null||end!==null)&&(!start||!end||start<end);
};

/** External editorial evidence: city-label eligibility, not settlement existence. */
export function validatePlaceUrbanLifetimes(value){
  if(value?.schema!==schema||value.schemaVersion!==1
    ||typeof value.sourceReviewRevision!=='string'||!/^[a-f0-9]{40}$/.test(value.sourceReviewRevision)
    ||!Array.isArray(value.entries)||value.entries.length>20000)
    throw new TypeError('Invalid external place-lifetime catalog');
  const seen=new Set();
  for(const entry of value.entries){
    if(entry?.source!=='geonames'||typeof entry.sourceId!=='string'||!/^[1-9]\d*$/.test(entry.sourceId)
      ||seen.has(entry.sourceId)||!['reviewed','verified','provisional'].includes(entry.status)
      ||entry.scope!=='urban-city-label-not-settlement-existence'
      ||typeof entry.sourceReviewFile!=='string'
      ||!/^reports\/places\/tier1-major-cities-batch[-\w]*\.json$/.test(entry.sourceReviewFile)
      ||!Array.isArray(entry.intervals)||entry.intervals.length>32)
      throw new TypeError('Invalid or duplicate external place-lifetime entry');
    seen.add(entry.sourceId);
    let lastEnd=null,index=0;
    for(const interval of entry.intervals){
      if(!interval||typeof interval!=='object'||!validBoundary(interval))throw new TypeError('Invalid urban lifetime interval');
      const start=startOf(interval),end=endOf(interval);
      if(index++>0&&(!lastEnd||!start||start<lastEnd))
        throw new TypeError('Overlapping urban lifetime intervals');
      lastEnd=end;
    }
  }
  return value;
}

export function indexPlaceUrbanLifetimes(value){
  return new Map(validatePlaceUrbanLifetimes(value).entries.map(row=>[row.source+':'+row.sourceId,row]));
}

/** No evidence is not evidence of absence; do not infer dates from GeoNames. */
export function placeUrbanLabelActiveAtMonth(place,month,index){
  if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month))return !String(month||'').startsWith('-');
  const evidence=index?.get(place?.source+':'+place?.sourceId);
  // Provisional editorial history is insufficient to assert a city absent.
  if(!evidence||evidence.status==='provisional'||!evidence.intervals.length)return true;
  const date=temporalMonthEnd(month).canonical;
  return evidence.intervals.some(interval=>{
    const start=startOf(interval),end=endOf(interval);
    return (!start||date>=start)&&(!end||date<end);
  });
}
