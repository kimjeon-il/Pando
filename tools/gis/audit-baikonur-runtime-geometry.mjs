/** Read-only actual KAB/KAZ released polygon coordinate QA.
 * Hydrate the exact pinned data revision before execution. No file writes.
 * Uses local equirectangular metre distances solely for *diagnosis*.
 */
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ANCHORS,decimalDegrees} from './baikonur-official-reference.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
const meters=(p,a,b)=>{
  const lat=(p[1]+a[1]+b[1])/3*Math.PI/180;
  const cos=Math.cos(lat),scale=111195;
  const x=(p[0]-a[0])*cos*scale,y=(p[1]-a[1])*scale;
  const dx=(b[0]-a[0])*cos*scale,dy=(b[1]-a[1])*scale,
    length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,(x*dx+y*dy)/length)):0;
  return Math.hypot(x-dx*t,y-dy*t);
};
const edge=(a,b)=>JSON.stringify([a,b]);
const ringEdges=ring=>ring.slice(1).map((point,i)=>[ring[i],point]);
const polygons=geometry=>geometry.type==='Polygon'?[geometry.coordinates]
  :geometry.type==='MultiPolygon'?geometry.coordinates:[];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const reads=(root,id)=>{
  const path=resolve(root,'state-'+id+'.json.gz');
  const entity=JSON.parse(gunzipSync(readFileSync(path)));
  check(Array.isArray(entity.geometryVersions)&&entity.geometryVersions.length>0,
    'Missing released GIS geometry '+id);
  return entity;
};
export function auditBaikonurRuntimeGeometry({kab,kaz}){
  check(kab?.entityId==='state:KAB'&&kaz?.entityId==='state:KAZ',
    'Incorrect paired geometry source');
  const k=kab.geometryVersions.at(-1).geometry,
    z=kaz.geometryVersions.at(-1).geometry;
  check(k?.type==='Polygon'&&z?.type==='MultiPolygon','Expected exact released KAB/KAZ geometry types');
  const kabRings=polygons(k)[0],kazRings=polygons(z).flat();
  check(kabRings.length===4&&kazRings.length>=9,'Released country polygon schema unexpected');
  const byEdge=new Set(kazRings.flatMap(ring=>ringEdges(ring).map(([a,b])=>edge(a,b))));
  const allKAB=kabRings.flatMap(ring=>ringEdges(ring));
  let paired=0,unpaired=0,unpairedExterior=0,exactDuplicates=0;
  const unpairedSamples=[];
  for(const [a,b] of allKAB){
    if(same(a,b))exactDuplicates++;
    // Paired country geometry is expected to have the reverse shared edge.
    if(byEdge.has(edge(b,a))||byEdge.has(edge(a,b)))paired++;
    else{
      unpaired++;
      if(unpairedSamples.length<5)unpairedSamples.push([a,b]);
    }
  }
  const exteriorEdges=ringEdges(kabRings[0]);
  for(const [a,b] of exteriorEdges)
    if(!byEdge.has(edge(b,a))&&!byEdge.has(edge(a,b)))unpairedExterior++;
  const official=ANCHORS.map(([lat,lon])=>[decimalDegrees(lon),decimalDegrees(lat)]);
  const deviations=official.map((point,i)=>{
    const nearest=Math.min(...exteriorEdges.map(([a,b])=>meters(point,a,b)));
    return {treatyPoint:i+1,distanceToDisplayedOuterBoundaryMeters:
      Math.round(nearest*100)/100};
  });
  const bounds=[...allKAB.flat()].reduce((b,p)=>[
    Math.min(b[0],p[0]),Math.min(b[1],p[1]),
    Math.max(b[2],p[0]),Math.max(b[3],p[1]),
  ],[Infinity,Infinity,-Infinity,-Infinity]);
  check(exactDuplicates===0,'Released KAB shape contains zero-length serialized edges');
  return {
    schema:'pando-baikonur-released-geometry-diagnostic-v1',
    currentKabVersion:kab.geometryVersions.at(-1).versionId,
    currentKazVersion:kaz.geometryVersions.at(-1).versionId,
    geometrySourceId:kab.sourceInfo.sourceId,
    osmdDerived:/osm/i.test(kab.sourceInfo.sourceId),
    kabRings:kabRings.length,
    kabRingVertexCounts:kabRings.map(x=>x.length-1),
    kazRingCount:kazRings.length,
    totalKabBoundaryEdges:allKAB.length,
    pairedCountryEdges:paired,unpairedCountryEdges:unpaired,
    unpairedOuterBoundaryEdges:unpairedExterior,
    unpairedSamples,
    bbox:bounds,
    treatyPointDeviation:{
      pointCount:deviations.length,
      under30m:deviations.filter(x=>x.distanceToDisplayedOuterBoundaryMeters<=30).length,
      under100m:deviations.filter(x=>x.distanceToDisplayedOuterBoundaryMeters<=100).length,
      under1000m:deviations.filter(x=>x.distanceToDisplayedOuterBoundaryMeters<=1000).length,
      maxMeters:Math.max(...deviations.map(x=>x.distanceToDisplayedOuterBoundaryMeters)),
      worst:deviations.sort((a,b)=>b.distanceToDisplayedOuterBoundaryMeters-a.distanceToDisplayedOuterBoundaryMeters).slice(0,8),
    },
    meta: {
      dateBoundariesNotReplaced:true,
      official2020ExclusionsNotFullyReconstructed:true,
      rightBankUnverified:true,
      revisedGeometryPublished:false,
    },
  };
}
export function main(argv=process.argv.slice(2)){
  check(argv.length===2&&argv[0]==='--data-root','Use --data-root GENERATED_V2');
  return auditBaikonurRuntimeGeometry({
    kab:reads(argv[1],'KAB'),kaz:reads(argv[1],'KAZ')});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log('BAIKONUR_RELEASED_GEOMETRY='+JSON.stringify(main(),null,2));}
  catch(error){console.error(error.stack);process.exitCode=1;}
}
