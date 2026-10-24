#!/usr/bin/env node
// Curated source orchestration. Boolean geometry and winding remain C++ owned.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {sharedCalculationCore} from '../assets/js/modules/temporal.js';
import {clippingOperationWithPrecisionRetry} from '../assets/js/modules/polygon-clipping-calculation.js';
import {updateTerritorialSource,readTerritorialSource} from './territorial-entity-sources.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize=geometry=>sharedCalculationCore.normalizePolygonGeometry(geometry);
const polygons=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
const operation=(method,...geometries)=>normalize({type:'MultiPolygon',coordinates:
  clippingOperationWithPrecisionRetry(method,...geometries.map(polygons))});
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const distance=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;
const nearest=(points,point)=>points.reduce((best,p,i)=>distance(p,point)<distance(points[best],point)?i:best,0);

// A source boundary is shared verbatim by its two counterpart rings. This
// replaces only that explicit chain; it never guesses ownership by polygon order.
export function replaceBoundaryChain(geometry,start,end,replacement,through) {
  const result=structuredClone(geometry);
  const candidates=polygons(result).flatMap(p=>p).filter(ring=>ring.some(p=>same(p,start))&&ring.some(p=>same(p,end)));
  assert.equal(candidates.length,1,'Shared boundary endpoints must identify one ring');
  const ring=candidates[0];
  const open=ring.slice(0,-1);
  const first=open.findIndex(p=>same(p,start));
  const rotated=[...open.slice(first),...open.slice(0,first)];
  const last=rotated.findIndex(p=>same(p,end));
  const direct=rotated.slice(0,last+1);
  const rest=[...rotated.slice(last),rotated[0]];
  const selected=direct.some(p=>same(p,through));
  const next=selected?[...replacement,...rotated.slice(last+1)]:[...direct.slice(0,-1),...replacement.toReversed()];
  if(!same(next[0],next.at(-1)))next.push([...next[0]]);
  assert.ok((selected?direct:rest).some(p=>same(p,through)),'Boundary witness missing');
  ring.splice(0,ring.length,...next);
  return normalize(result);
}

function lineBetween(points,start,end) {
  const first=nearest(points,start),last=nearest(points,end);
  const ordered=points.slice(Math.min(first,last),Math.max(first,last)+1);
  if(first>last)ordered.reverse();
  return [start,...ordered,end];
}

export function buildKoreanBoundaryGeometry(countries,lines) {
  const base=id=>countries.features.find(f=>f.id===id).geometry;
  const sino=lines.features.find(f=>f.properties.CC1_GENC3==='CHN'&&f.properties.CC2_GENC3==='PRK');
  const mdl=lines.features.find(f=>f.properties.CC1_GENC3==='PRK'&&f.properties.CC2_GENC3==='KOR');
  assert.equal(mdl.properties.STATUS,'Other Line of International Separation');
  assert.equal(sino.properties.STATUS,'International Boundary');
  const start=[128.14425,41.754713],end=[128.597556,42.027126],through=[128.054643,41.998316];
  const paektu=lineBetween(sino.geometry.coordinates,start,end);
  const north=replaceBoundaryChain(base('PRK'),start,end,paektu,through);
  const china=replaceBoundaryChain(base('CHN'),start,end,paektu,through);
  // Preserve the existing Han-estuary allocation and all island components.
  // Only the contiguous mainland chain east of the estuary is replaced by MDL.
  const southRing=polygons(base('KOR'))[0][0];
  const northRing=polygons(north)[0][0];
  const shared=southRing.filter(p=>northRing.some(q=>same(p,q)));
  const west=shared[nearest(shared,mdl.geometry.coordinates[0])];
  const east=shared[nearest(shared,mdl.geometry.coordinates.at(-1))];
  const witness=shared.reduce((best,p)=>distance(p,[127.5,38.3])<distance(best,[127.5,38.3])?p:best,shared[0]);
  const militaryLine=lineBetween(mdl.geometry.coordinates,west,east);
  const southMdl=replaceBoundaryChain(base('KOR'),west,east,militaryLine,witness);
  const northMdl=replaceBoundaryChain(north,west,east,militaryLine,witness);
  // Latitude 38 is exact; modern coastline/island outlines are explicitly
  // retained derivatives, not claimed as period coastal reconstruction.
  const southParts=polygons(southMdl),northParts=polygons(northMdl);
  const peninsula=operation('union',{type:'Polygon',coordinates:southParts[0]},
    {type:'Polygon',coordinates:northParts[0]});
  const southMask={type:'Polygon',coordinates:[[[120,30],[135,30],[135,38],[120,38],[120,30]]]};
  const northMask={type:'Polygon',coordinates:[[[120,38],[135,38],[135,45],[120,45],[120,38]]]};
  const northernIslands=northParts.slice(1);
  const preSouthIslands=northernIslands.filter(p=>p[0].every(point=>point[1]<38));
  const preNorthIslands=northernIslands.filter(p=>!preSouthIslands.includes(p));
  const southMain=operation('intersection',peninsula,southMask);
  const northMain=operation('intersection',peninsula,northMask);
  return {southMdl,northMdl,china,
    south38:normalize({type:'MultiPolygon',coordinates:[...polygons(southMain),...southParts.slice(1),...preSouthIslands]}),
    north38:normalize({type:'MultiPolygon',coordinates:[...polygons(northMain),...preNorthIslands]})};
}

// Re-running Korean reconstruction must preserve supplements on China's other
// borders. An already present Paektu chain is a no-op, including ring ordering.
export function refineChinesePaektuSource(entity,lines,sourceFile,geometryVersionId) {
  if(!entity.geometryVersions.some(version=>version.versionId===geometryVersionId&&version.validTo===null))throw new Error('Missing open Chinese display geometry');
  const sino=lines.features.find(f=>f.properties.CC1_GENC3==='CHN'&&f.properties.CC2_GENC3==='PRK');
  const start=[128.14425,41.754713],end=[128.597556,42.027126],through=[128.054643,41.998316];
  const chain=lineBetween(sino.geometry.coordinates,start,end).filter((p,i,a)=>!i||!same(p,a[i-1]));
  const edge=(a,b)=>[JSON.stringify(a),JSON.stringify(b)].sort().join('|');
  let changed=false;
  const geometryVersions=entity.geometryVersions.map(version=>{
    if(version.versionId!==geometryVersionId)return version;
    const edges=new Set(polygons(version.geometry).flatMap(p=>p).flatMap(ring=>ring.slice(1).map((p,i)=>edge(ring[i],p))));
    if(chain.slice(1).every((p,i)=>edges.has(edge(chain[i],p))))return version;
    changed=true;
    return {...version,sourceId:'natural-earth-5.1.1+dos-lsib-11.4',
      geometry:replaceBoundaryChain(version.geometry,start,end,chain,through),
      historicalProvenance:{evidenceStatus:'provisional',sourceIds:['natural-earth-5.1.1','dos-lsib-11.4'],
        reconstructionScope:'Paektu shared boundary only; no extension of Chinese historical coverage',sourceFile}};
  });
  if(!changed)return entity;
  const representative=geometryVersions.find(v=>v.versionId===entity.metadata.representativeGeometryVersionId);
  return {...entity,geometryVersions,sourceInfo:{...entity.sourceInfo,
    sourceId:'natural-earth-5.1.1+dos-lsib-11.4',geometrySha256:sha(representative.geometry)}};
}

export function run({check=false}={}) {
  const countries=read('assets/data/countries-ne-5.1.1.geojson');
  const sourceFile='tools/historical-library/sources/korea/lsib-11.4-korean-boundaries.geojson';
  const lines=read(sourceFile);
  const geometries=buildKoreanBoundaryGeometry(countries,lines);
  const evidence=read('tools/historical-library/sources/korea/provenance.json');
  assert.equal(sha(countries),evidence.base.contentSha256,'Pinned Natural Earth base changed');
  assert.equal(sha(lines),evidence.vector.contentSha256,'Pinned Korean vector changed');
  const provenance=(phase,northern)=>({
    evidenceStatus:'provisional',sourceIds:['natural-earth-5.1.1','dos-lsib-11.4',...phase==='38th-parallel'?['ibs022-1963']:['korean-armistice-1953']],
    reconstructionScope:'Korean mutual land boundary; Paektu modern boundary refinement',
    coastline:'Modern Natural Earth outlines retained; period coastlines not reconstructed',
    ...(!northern?{unresolvedSegments:[]}:phase!=='sino-korean-protocol'?{
      unresolvedSegments:['Sino-Korean pre-settlement boundary; modern alignment retained as provisional context'],
      notice:'북중 국경 확정 이전의 북쪽 경계는 미복원 상태이며 현재 경계를 참고용으로 표시합니다.',
    }:{
      treatySigned:'1962-10-12',protocolEffective:'1964-03-20',
      notice:'1964-03-20은 북중 국경 확정일입니다. 확정 전후의 영토 차이는 미복원 상태입니다.',
      unresolvedSegments:['Period river-island allocation outside Paektu not independently digitized']}),
    independentPeriodScreenDeltaChecked:false,sourceFile,
  });
  const version=(id,from,to,geometry,phase)=>({versionId:id,validFrom:from,validTo:to,
    certainty:'medium',sourceId:phase==='38th-parallel'?'korean-38th-parallel':'dos-lsib-11.4',
    geometry,historicalProvenance:provenance(phase,id.startsWith('state:PRK:'))});
  const replacements=new Map([
    ['state:KOR',{from:'1948-08-15',geometry:geometries.southMdl,versions:[
      version('state:KOR:38th-parallel-1948','1948-08-15','1953-07-26',geometries.south38,'38th-parallel'),
      version('state:KOR:armistice-1953','1953-07-27',null,geometries.southMdl,'armistice')]}],
    ['state:PRK',{from:'1948-09-09',geometry:geometries.northMdl,versions:[
      version('state:PRK:38th-parallel-1948','1948-09-09','1953-07-26',geometries.north38,'38th-parallel'),
      version('state:PRK:armistice-1953','1953-07-27','1964-03-19',geometries.northMdl,'armistice'),
      version('state:PRK:sino-korean-protocol-1964','1964-03-20',null,geometries.northMdl,'sino-korean-protocol')]}],
  ]);
  for(const [entityId,value] of replacements){
    const update=entity=>({...entity,lifetime:{validFrom:value.from,validTo:null},geometryVersions:value.versions,
      sourceInfo:{...entity.sourceInfo,sourceId:'natural-earth-5.1.1+dos-lsib-11.4',
        title:'Natural Earth coastlines with US Department of State LSIB 11.4 Korean boundaries',geometrySha256:sha(value.geometry)},
      metadata:{...entity.metadata,historicalBoundaryEvidence:'provisional',boundaryEvidenceFile:'reports/borders/reconstruction/korea-boundaries-2026-10-21.md'}});
    if(check){
      const current=readTerritorialSource(entityId);
      assert.deepEqual(current,update(current),`Stale Korean source: ${entityId}`);
    }else updateTerritorialSource(entityId,update);
  }
  const selectedChina=read('assets/data/territorial-entities/source/views/world.json').selections.find(row=>row.entityId==='state:CHN');
  if(!selectedChina)throw new Error('Chinese world display selection is required');
  const updateChina=entity=>refineChinesePaektuSource(entity,lines,sourceFile,selectedChina.geometryVersionId);
  if(check){const current=readTerritorialSource('state:CHN');
    assert.deepEqual(current,updateChina(current),'Stale Chinese Paektu counterpart');}
  else updateTerritorialSource('state:CHN',updateChina);
  console.log(`${check?'Checked':'Built'} Korean government lifetimes, 38th-parallel/MDL phases and Sino-Korean protocol evidence (pre-settlement geometry unresolved)`);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run({check:process.argv.includes('--check')});
