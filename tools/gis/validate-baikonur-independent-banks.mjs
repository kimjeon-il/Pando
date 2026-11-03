/** Baikonur independently surveyed riverbank replacement gate.
 * A satellite water mask is NOT a treaty border: candidates must carry an
 * independent historic bank interpretation and be checked against 31 anchors.
 * Read-only validation. Never rewrites country polygons or removes OSM credit.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {ANCHORS,UNRESOLVED_BANKS,decimalDegrees} from './baikonur-official-reference.mjs';
import {verifyBaikonurLeaseExclusionSource,EFFECTIVE_DATE} from './verify-baikonur-lease-exclusions.mjs';
const error=(msg)=>{throw Error(msg);};
const check=(v,msg)=>{if(!v)error(msg);};
const sha=v=>createHash('sha256').update(v).digest('hex');
const sq=(a,b)=>((a[0]-b[0])*Math.cos((a[1]+b[1])*Math.PI/360))**2+(a[1]-b[1])**2;
const meters=(a,b)=>Math.sqrt(sq(a,b))*111195;
const eq=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const orientation=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const crosses=(a,b,c,d)=>{
  if(eq(a,c)||eq(a,d)||eq(b,c)||eq(b,d))return false;
  const u=orientation(a,b,c),v=orientation(a,b,d),w=orientation(c,d,a),x=orientation(c,d,b);
  return u*v<0&&w*x<0;
};
const pointOn=(p,a,b,tol=1e-10)=>{
  if(Math.abs(orientation(a,b,p))>tol)return false;
  return p[0]>=Math.min(a[0],b[0])-tol&&p[0]<=Math.max(a[0],b[0])+tol
    &&p[1]>=Math.min(a[1],b[1])-tol&&p[1]<=Math.max(a[1],b[1])+tol;
};
const contains=(p,ring)=>{
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if(pointOn(p,a,b))return true;
    if((a[1]>p[1])!==(b[1]>p[1])
      &&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
};
const anchors=ANCHORS.map(([lat,lon])=>[decimalDegrees(lon),decimalDegrees(lat)]);
const pairs=UNRESOLVED_BANKS.map(pair=>pair.join('-'));
const parsePoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)
  &&p[0]>62&&p[0]<65&&p[1]>45&&p[1]<47;
const requireSource=(s,label)=>{
  check(s&&typeof s==='object',label+' evidence missing');
  check(typeof s.url==='string'&&/^https:\/\//.test(s.url)&&
    !/openstreetmap|overpass/i.test(s.url),label+' must be an independent HTTPS source');
  check(typeof s.sha256==='string'&&/^[a-f0-9]{64}$/.test(s.sha256),
    label+' must have an immutable content SHA-256');
};
export function validateBaikonurBankCandidate(candidate,{
  endpointToleranceMeters=30,exclusionPolygons=verifyBaikonurLeaseExclusionSource().features,referenceDate=EFFECTIVE_DATE
}={}){
  check(candidate?.type==='FeatureCollection'&&Array.isArray(candidate.features),
    'Candidate must be GeoJSON FeatureCollection');
  check(candidate.properties?.openStreetMapDataUsed===false,
    'OSM-free provenance must be explicitly established');
  check(candidate.properties?.originalDatumVerified===true,
    'Treaty datum and coordinate transformation remain unverified');
  check(candidate.properties?.historicBankInterpretationVerified===true,
    'Present-day water edge is not a verified historic treaty bank');
  check(candidate.properties?.bankSide==='right',
    'Treaty specifies right bank; orientation must be independently confirmed');
  check(candidate.properties?.referenceDate===referenceDate,
    'Candidate historic legal validity date mismatch');
  check(referenceDate>=EFFECTIVE_DATE,
    'The 2020-amended lease exclusions cannot be used for an earlier legal epoch');
  const requiredExclusions=['1-1','1-2','1-3','1-4','tyuratam','akay'];
  const actualExclusions=exclusionPolygons.map(row=>String(row.properties?.plot||''));
  check(exclusionPolygons.length===requiredExclusions.length
    &&new Set(actualExclusions).size===requiredExclusions.length
    &&requiredExclusions.every(label=>actualExclusions.includes(label)),
    'All six official lease exclusions must be geometrically supplied');
  check(candidate.properties?.amendment2019ExclusionsApplied===true,
    'All effective exclusions and shared border topology must be accounted for');
  check(candidate.properties?.topologyWithKazakhstanVerified===true,
    'Kazakhstan and leased polygon must share one exact edge');
  check(candidate.properties?.roadAndRailExclusionsVerified===true,
    'The unbounded road and rail lease exclusions are not yet verified');
  check(candidate.properties?.riverFlowDirectionVerified===true,
    'Flow direction must be checked independently');
  check(Array.isArray(candidate.properties?.sourceEvidence)&&
    candidate.properties.sourceEvidence.length>=2,'Two independent evidence records required');
  candidate.properties.sourceEvidence.forEach((source,i)=>requireSource(source,'Source '+i));
  check(candidate.properties.sourceEvidence.some(s=>s.kind==='official-treaty')
    &&candidate.properties.sourceEvidence.some(s=>s.kind==='independent-survey'
      ||s.kind==='public-domain-satellite'),
    'Treaty plus independent measured shoreline evidence required');
  check(Number.isFinite(endpointToleranceMeters)&&endpointToleranceMeters>0
    &&endpointToleranceMeters<=30,'Endpoint tolerance cannot exceed 30 m');
  const found=new Set(),metrics=[];
  for(const feature of candidate.features){
    const pair=String(feature.properties?.treatyPointPair||'');
    check(pairs.includes(pair)&&!found.has(pair),'Unexpected or duplicate bank pair: '+pair);
    found.add(pair);
    const coords=feature.geometry?.coordinates;
    check(feature.geometry?.type==='LineString'&&Array.isArray(coords)
      &&coords.length>=3&&coords.every(parsePoint),'Invalid bank line geometry: '+pair);
    const [from,to]=pair.split('-').map(Number);
    const start=meters(coords[0],anchors[from-1]);
    const end=meters(coords.at(-1),anchors[to-1]);
    check(start<=endpointToleranceMeters&&end<=endpointToleranceMeters,
      'Candidate endpoints do not meet treaty anchors: '+pair);
    let length=0;
    for(let i=1;i<coords.length;i++){
      const segment=meters(coords[i-1],coords[i]);
      check(segment>0.01&&segment<3000,'Degenerate or unsupported riverbank segment: '+pair);
      length+=segment;
    }
    check(length>50,'Candidate bank is implausibly short: '+pair);
    for(let i=0;i<coords.length-1;i++)
      for(let j=i+2;j<coords.length-1;j++)
        check(!crosses(coords[i],coords[i+1],coords[j],coords[j+1]),
          'Self-intersecting riverbank: '+pair);
    for(const exclusion of exclusionPolygons){
      const ring=exclusion?.geometry?.coordinates?.[0];
      check(Array.isArray(ring)&&ring.length>=4&&ring.every(parsePoint),
        'Invalid independently verified exclusion polygon');
      for(let i=0;i<coords.length-1;i++){
        const a=coords[i],b=coords[i+1],
          mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
        check(!contains(a,ring)&&!contains(mid,ring)&&!contains(b,ring),
          'Bank enters a leased-out exclusion: '+pair);
        for(let j=0;j<ring.length-1;j++)
          check(!crosses(a,b,ring[j],ring[j+1]),
            'Bank crosses a leased-out exclusion boundary: '+pair);
      }
    }
    metrics.push({pair,points:coords.length,lengthMeters:Math.round(length),
      startErrorMeters:Math.round(start*100)/100,endErrorMeters:Math.round(end*100)/100});
  }
  check(found.size===2,'Both independently surveyed Syr Darya bank reaches are required');
  const bytes=Buffer.from(JSON.stringify(candidate));
  return {
    schema:'pando-baikonur-independent-bank-review-v1',
    status:'STRUCTURAL_REVIEW_ONLY_NOT_LEGAL_GEOMETRY',
    geometrySha256:sha(bytes),bankCount:2,treatyAnchorCount:31,
    osmDataUsed:false,referenceDate,metrics,
    publicationAuthorized:false,
    warning:'Structural checks alone cannot certify source authenticity, legal epoch shoreline, geodetic datum, transport corridor exclusions or Kazakhstan shared-border topology. Never publish or remove OSM credit from this receipt.',
  };
}
export function main(argv=process.argv.slice(2)){
  check(argv.length===2&&argv[0]==='--candidate','Usage: --candidate FILE');
  return validateBaikonurBankCandidate(JSON.parse(readFileSync(resolve(argv[1]),'utf8')));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(main(),null,2));}
  catch(e){console.error(e.stack);process.exitCode=1;}
}
