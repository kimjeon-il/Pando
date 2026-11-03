/** Reconstruct a treaty-only Baikonur polygon from independently derived banklines.
 * No OSM geometry or fallback straight river edges are permitted.
 * This is a research candidate until the Kazakhstan shared edge, datum,
 * legal exclusions and time-specific topology are independently checked.
 */
import {createHash} from 'node:crypto';
import {ANCHORS,decimalDegrees,UNRESOLVED_BANKS} from './baikonur-official-reference.mjs';
import {baikonur2019Exclusions} from './baikonur-2019-exclusions.mjs';
const ensure=(x,m)=>{if(!x)throw Error(m);};
const anchor=n=>[decimalDegrees(ANCHORS[n-1][1]),decimalDegrees(ANCHORS[n-1][0])];
const angle=p=>[p[0]*111320*Math.cos(45.7*Math.PI/180),p[1]*111320];
const isPoint=x=>Array.isArray(x)&&x.length===2&&x.every(Number.isFinite)
  &&x[0]>62&&x[0]<65&&x[1]>45&&x[1]<47;
const distance=(a,b)=>{
  const dx=(a[0]-b[0])*111320*Math.cos(((a[1]+b[1])/2)*Math.PI/180),
    dy=(a[1]-b[1])*111320;
  return Math.hypot(dx,dy);
};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function reverse(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function crossing(a,b,c,d){
 const r1=reverse(a,b,c),r2=reverse(a,b,d),r3=reverse(c,d,a),r4=reverse(c,d,b);
 return ((r1>0&&r2<0)||(r1<0&&r2>0))
  &&((r3>0&&r4<0)||(r3<0&&r4>0));
}
export function polygonSelfCrossings(ring){
 let collisions=0;
 for(let i=0;i<ring.length-1;i++)for(let j=i+2;j<ring.length-1;j++){
   if(i===0&&j===ring.length-2)continue;
   if(crossing(ring[i],ring[i+1],ring[j],ring[j+1]))collisions++;
 }
 return collisions;
}
export function approximatePlanarAreaKm2(ring){
 let twice=0;
 for(let i=1;i<ring.length;i++){
  const [x1,y1]=angle(ring[i-1]),[x2,y2]=angle(ring[i]);
  twice+=x1*y2-x2*y1;
 }
 return Math.abs(twice)/2/1000000;
}
function bankLine(banks,from,to){
 const lines=banks.filter(x=>x.treatyPointPair?.[0]===from&&x.treatyPointPair?.[1]===to);
 ensure(lines.length===1,'Missing or duplicate independently reconstructed riverbank '+from+'→'+to);
 const item=lines[0],line=item.geometry?.coordinates||[];
 ensure(item.geometry?.type==='LineString'&&line.length>=5
   &&line.length<=15000&&line.every(isPoint),
 'Independent right bank line must have at least five valid geographic points');
 ensure(item.sourceClass==='independently-derived-USGS-Landsat-C2-L2'
   &&item.openStreetMapDataUsed===false
   &&Array.isArray(item.satelliteSceneIds)&&item.satelliteSceneIds.length>=2
   &&Array.isArray(item.waterMaskSha256)&&item.waterMaskSha256.length>=2
   &&item.waterMaskSha256.every(x=>/^[a-f0-9]{64}$/.test(x))
   &&item.rightBankDirectionVerified===true
   &&item.temporalBankConsistencyValidated===true,
 'Riverbank source, two epochs, right-side direction and temporal comparison are mandatory');
 ensure(distance(line[0],anchor(from))<1250&&distance(line.at(-1),anchor(to))<1250,
 'The independently derived waterbank does not meet the treaty anchors');
 let maxGap=0,length=0;
 for(let i=1;i<line.length;i++){const d=distance(line[i-1],line[i]);length+=d;maxGap=Math.max(d,maxGap);}
 ensure(maxGap<=2000 && length<=150000 && length>=distance(anchor(from),anchor(to))*.75,
 'Bank polyline has an unsafe shortcut, giant jump or implausible reach length');
 return {coords:line,
   stats:{treatyPointPair:[from,to],riverRouteLengthKm:Number((length/1000).toFixed(3)),
     anchorSnapMeters:[Number(distance(line[0],anchor(from)).toFixed(2)),
     Number(distance(line.at(-1),anchor(to)).toFixed(2))],
     maxPixelToPixelGapMeters:Number(maxGap.toFixed(2)),
     independentRasterSha256:item.waterMaskSha256,
     datedSatelliteSceneIds:item.satelliteSceneIds}};
}
export function makeBaikonurIndependentCandidate({bankFeatures,sourceRevision}){
 ensure(Array.isArray(bankFeatures)&&bankFeatures.length===2,
   'Both treaty riverbank reaches are mandatory');
 ensure(/^[a-f0-9]{40}$/.test(sourceRevision||''),
   'Candidate must be bound to one source revision');
 const first=bankLine(bankFeatures,17,18),last=bankLine(bankFeatures,31,1);
 const points=[anchor(1)];
 for(let n=1;n<=30;n++){
   if(n===17){points.push(...first.coords,anchor(18));}
   else points.push(anchor(n+1));
 }
 points.push(...last.coords,anchor(1));
 const ring=points.filter((p,i)=>i===0||distance(p,points[i-1])>.01);
 ensure(ring.length>31&&distance(ring[0],ring.at(-1))<.01,
   'Independent treaty reference must be a closed ring');
 const collisions=polygonSelfCrossings(ring),area=approximatePlanarAreaKm2(ring);
 ensure(collisions===0&&area>500&&area<25000,
   'The independently derived treaty polygon is self-intersecting or out of geographic scale');
 const exclusions=baikonur2019Exclusions();
 ensure(exclusions.features.length===4&&exclusions.properties.unresolvedPlots.length===0,
   '2019 official geometry exceptions are missing');
 const geom={type:'Polygon',coordinates:[ring]};
 const feature={type:'Feature',id:'state:KAB:independent-treaty-plot1-candidate',
   properties:{
     sourceClass:'treaty-official-anchors-and-independent-USGS-raster-banklines',
     sourceRevision,sourceUrls:[
       'https://old.adilet.zan.kz/rus/docs/U950002195_',
       'https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products',
     ],
     openStreetMapDataUsed:false,confidence:'research-provisional',
     geometryStatus:'REVIEW_ONLY_NOT_FOR_RUNTIME',
     originalCoordinateDatum:'not-survey-verified',
     bankReaches:[first.stats,last.stats],
     legalExclusionsApplied:false,
     kazakhstanSharedGeometryUpdated:false,
     geometrySha256:sha(geom),areaSquareKm:Number(area.toFixed(3)),
     pending:['independent 2019 lease-exclusion topology and road/rail carveouts',
       'Kazakhstan KAZ 1995–2006 and 2006–present shared-edge complement',
       'legal treaty coordinate datum and bankline season/survey interpretation',
       'source geometry dates and historical time-dependent review'],
   },geometry:geom};
 return {type:'FeatureCollection',features:[feature,...exclusions.features],
   properties:{status:'RESEARCH_ONLY_NOT_FOR_RUNTIME',
     featureCount:1+exclusions.features.length,
     noOpenStreetMapDataUsed:true,leaseLegalCompletion:false,
     widthOfSourceError:'Landsat 30 m and unsurveyed riverbank, not cadastral line',
     generation:'independent-satellite-and-official-treaty-anchors'}};
}
