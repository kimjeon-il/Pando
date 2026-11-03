/** Non-OSM cadastral reference checks for six explicit Baikonur lease exclusions.
 *
 * The 2017 Chelyabinsk protocol, effective 2020-01-22, identifies four
 * separately numbered return plots and the previously excluded Tyuratam and
 * Akay settlement parcels. Roads/railway are excluded too, but their corridor
 * widths are NOT specified and no road/rail polygon may be inferred here.
 *
 * ONLY coordinate/area/topology QA. Not a geodetic datum transformation,
 * legally surveyed border or approved runtime map replacement.
 */
import {baikonur2019Exclusions,parseOfficialFractionalDms}
  from './baikonur-2019-exclusions.mjs';
import {baikonurReference} from './baikonur-official-reference.mjs';

export const OFFICIAL_2017_ANNEX='https://old.adilet.zan.kz/rus/docs/P1700000697';
export const OFFICIAL_2019_RATIFICATION='https://old.adilet.zan.kz/rus/docs/Z1900000282';
export const EFFECTIVE_DATE='2020-01-22';
const KAZAKH_PARLIAMENT_AREA_KM2=116;
export const SETTLEMENT_PARCELS=Object.freeze({
  tyuratam:[
    ['45 39 25','63 18 00'],['45 39 25','63 19 30'],
    ['45 38 50','63 18 30'],['45 38 40','63 18 10'],
  ],
  akay:[
    ['45 36 30','63 15 25'],['45 36 30','63 16 20'],
    ['45 35 50','63 16 20'],['45 35 50','63 15 25'],
  ],
});
const ensure=(truth,message)=>{if(!truth)throw Error(message);};
const areaKm2=(ring)=>{
  // Spherical polygon integral; independent of projection and length units.
  const r=6371.0088,rad=Math.PI/180;
  let s=0;
  for(let i=0;i<ring.length-1;i++){
    const [x1,y1]=ring[i],[x2,y2]=ring[i+1];
    s+=(x2-x1)*rad*(Math.sin(y1*rad)+Math.sin(y2*rad));
  }
  return Math.abs(s)*r*r/2;
};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
// Treaty anchors are rounded to 8 decimal places, amended plots to 9.
// Their common nodes can therefore be 0.3 mm apart; those are not crossings.
// This 5 cm tolerance is for float serialization ONLY, never a legal survey tolerance.
const distToSegmentMeters=(p,a,b)=>{
  const cos=Math.cos((p[1]+a[1]+b[1])*Math.PI/540),
    ax=a[0]*cos*111195,ay=a[1]*111195,
    bx=b[0]*cos*111195,by=b[1]*111195,
    px=p[0]*cos*111195,py=p[1]*111195,
    dx=bx-ax,dy=by-ay,denom=dx*dx+dy*dy;
  const t=denom?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/denom)):0;
  return Math.hypot(px-ax-t*dx,py-ay-t*dy);
};
const segCross=(a,b,c,d)=>{
  const u=cross(a,b,c),v=cross(a,b,d),w=cross(c,d,a),x=cross(c,d,b);
  if(!(u*v<0&&w*x<0))return false;
  // Real crossing inside both segments persists, but digitized common edges
  // must not be flagged solely due to 8-vs-9 digit coordinate rounding.
  return !([distToSegmentMeters(a,c,d),distToSegmentMeters(b,c,d),
    distToSegmentMeters(c,a,b),distToSegmentMeters(d,a,b)]
    .some(distance=>distance<=0.05));
};
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
function testRing(ring,label){
  ensure(Array.isArray(ring)&&ring.length>=4&&ring.every(p=>
    Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)),label+' invalid ring');
  ensure(same(ring[0],ring.at(-1)),label+' unclosed');
  for(let i=0;i<ring.length-1;i++)for(let j=i+2;j<ring.length-1;j++){
    if(i===0&&j===ring.length-2)continue;
    ensure(!segCross(ring[i],ring[i+1],ring[j],ring[j+1]),label+' self intersection');
  }
  const area=areaKm2(ring);
  ensure(area>0.001&&area<100,label+' implausible area');
  return area;
}
export function verifyBaikonurLeaseExclusionSource(){
  const prior=baikonur2019Exclusions();
  ensure(prior.features.length===4&&prior.properties?.unresolvedPlots?.length===0,
    'Four 2020 official return plots are incomplete');
  const items=prior.features.map(row=>structuredClone(row));
  for(const [name,rows] of Object.entries(SETTLEMENT_PARCELS)){
    const coords=rows.map(([lat,lon])=>[
      parseOfficialFractionalDms(lon),parseOfficialFractionalDms(lat)]);
    items.push({
      type:'Feature',id:'baikonur-treaty-settlement-exclusion-'+name,
      properties:{kind:'official-settlement-lease-exclusion',plot:name,
        sourceUrl:OFFICIAL_2017_ANNEX,effectiveDate:EFFECTIVE_DATE,
        geometryStatus:'research-only-unvalidated-datum'},
      geometry:{type:'Polygon',coordinates:[[...coords,coords[0]]]},
    });
  }
  const areas=[],crossings=[],intersections=[];
  const straights=baikonurReference().features.filter(x=>
    x.properties.kind==='treaty-straight-segment');
  for(const row of items){
    const ring=row.geometry.coordinates[0];
    const km2=testRing(ring,row.id);
    areas.push({plot:row.properties.plot,points:ring.length-1,
      approxSqKm:Math.round(km2*1000)/1000});
    for(let i=0;i<ring.length-1;i++){
      const a=ring[i],b=ring[i+1];
      for(const line of straights){
        const [c,d]=line.geometry.coordinates;
        if(segCross(a,b,c,d))crossings.push({
          plot:row.properties.plot,straight:line.id,edge:i+1});
      }
    }
  }
  // The official four returned parcels, not the older Tyuratam/Akay areas,
  // must agree with Parliament's reported 11.6k hectares (approx 116 km²).
  const returned=areas.filter(x=>/^1-[1-4]$/.test(x.plot));
  const returnArea=returned.reduce((sum,x)=>sum+x.approxSqKm,0);
  ensure(Math.abs(returnArea-KAZAKH_PARLIAMENT_AREA_KM2)<1.5,
    'Four returned plots disagree with Kazakhstan Senate area reference');
  ensure(!crossings.length,'Exclusion ring crosses a 1994 treaty straight boundary');
  // Exclusion rings must not intersect each other.
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const a=items[i].geometry.coordinates[0],b=items[j].geometry.coordinates[0];
    for(let m=0;m<a.length-1;m++)for(let n=0;n<b.length-1;n++){
      if(segCross(a[m],a[m+1],b[n],b[n+1]))intersections.push([items[i].id,items[j].id,m,n]);
    }
  }
  ensure(!intersections.length,'Official exclusion boundaries intersect each other');
  return {
    type:'FeatureCollection',
    properties:{
      schema:'pando-baikonur-official-exclusion-review-v1',
      sourceUrls:[OFFICIAL_2017_ANNEX,OFFICIAL_2019_RATIFICATION],
      effectiveDate:EFFECTIVE_DATE,
      coordinateDatumVerified:false,
      geometryForRuntime:false,
      roadsAndRailwaysExclusionDigitized:false,
      rightBankSegmentsIndependentlySurveyed:false,
      returnedPlotsAreaSqKm:Math.round(returnArea*1000)/1000,
      senateApproxReturnSqKm:KAZAKH_PARLIAMENT_AREA_KM2,
      excludedSettlementParcels:['tyuratam','akay'],
      areaMethod:'spherical geographic approximation on transcribed DMS vertices',
      note:'2019 ratification is not the effective date; the 2017 protocol took effect on 2020-01-22',
    },
    diagnostics:{perPlot:areas,crossings,intersections},
    features:items,
  };
}
