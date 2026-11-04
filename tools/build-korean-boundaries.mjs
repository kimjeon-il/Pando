#!/usr/bin/env node
// Curated source orchestration. Boolean geometry and winding remain C++ owned.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {sharedCalculationCore} from "../shared/frontend/js/modules/temporal.js";
import {clippingOperationWithPrecisionRetry} from "./gis/polygon-clipping-calculation.js";
import {readTerritorialSource,entityFileName,territorialSourceRoot} from './territorial-entity-sources.mjs';
import {withLibraryOutputs} from './library-data.mjs';
import {normalizeTerritorialLibraryEntity} from './gis/territorial-library.js';

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
function boundaryPaths(geometry,start,end,through) {
  const candidates=polygons(geometry).flatMap(p=>p).filter(ring=>ring.some(p=>same(p,start))&&ring.some(p=>same(p,end)));
  assert.equal(candidates.length,1,'Shared boundary endpoints must identify one ring');
  const ring=candidates[0],open=ring.slice(0,-1),first=open.findIndex(p=>same(p,start));
  const rotated=[...open.slice(first),...open.slice(0,first)],last=rotated.findIndex(p=>same(p,end));
  const direct=rotated.slice(0,last+1),rest=[...rotated.slice(last),rotated[0]],selected=direct.some(p=>same(p,through));
  assert.ok((selected?direct:rest).some(p=>same(p,through)),'Boundary witness missing');
  return {ring,rotated,last,direct,rest,selected};
}
export function readBoundaryChain(geometry,start,end,through) {
  const p=boundaryPaths(geometry,start,end,through);return structuredClone(p.selected?p.direct:p.rest.toReversed());
}
export function replaceBoundaryChain(geometry,start,end,replacement,through) {
  const result=structuredClone(geometry),{ring,rotated,last,direct,selected}=boundaryPaths(result,start,end,through);
  let next=selected?[...replacement,...rotated.slice(last+1)]:[...direct.slice(0,-1),...replacement.toReversed()];
  const originalStart=ring[0],retainedStart=next.findIndex(p=>same(p,originalStart));
  if(retainedStart>0){if(same(next[0],next.at(-1)))next.pop();next=[...next.slice(retainedStart),...next.slice(0,retainedStart)];}
  if(!same(next[0],next.at(-1)))next.push([...next[0]]);
  ring.splice(0,ring.length,...next);return normalize(result);
}

function lineBetween(points,start,end) {
  const first=nearest(points,start),last=nearest(points,end);
  const ordered=points.slice(Math.min(first,last),Math.max(first,last)+1);
  if(first>last)ordered.reverse();
  return [start,...ordered,end];
}

export function buildKoreanBoundaryGeometry(countries) {
  const base=id=>countries.features.find(f=>f.id===id).geometry;
  const north=normalize(base('PRK')),china=normalize(base('CHN'));
  const southMdl=normalize(base('KOR')),northMdl=north;
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

// Fixed pre-LSIB display baseline; original LSIB is evidence only, never output.
const BASELINE_SHA='985c34f55ace12be51580f420c6b691d03f48bf73c84a88aed65b7ae6cfc5d01';
const BASELINE_FILE='assets/data/countries-ne-5.1.1.geojson';
const RETIRED_FILE='tools/historical-library/sources/korea/lsib-11.4-korean-boundaries.geojson';
const ROLLBACK_REPORT='reports/borders/validation/korean-lsib-baseline-rollback-2026-11-04/README.md';
function baselineChains(countries,lines) {
  assert.equal(sha(countries),BASELINE_SHA,'Pinned pre-LSIB Natural Earth baseline changed');
  const base=id=>countries.features.find(f=>f.id===id).geometry;
  const start=[128.14425,41.754713],end=[128.597556,42.027126],through=[128.054643,41.998316];
  const sino=lines.features.find(f=>f.properties.CC1_GENC3==='CHN'&&f.properties.CC2_GENC3==='PRK');
  const mdl=lines.features.find(f=>f.properties.CC1_GENC3==='PRK'&&f.properties.CC2_GENC3==='KOR');
  const paektuRetired=lineBetween(sino.geometry.coordinates,start,end);
  const south=polygons(base('KOR'))[0][0],north=polygons(base('PRK'))[0][0];
  const shared=south.filter(p=>north.some(q=>same(p,q)));
  const west=shared[nearest(shared,mdl.geometry.coordinates[0])],east=shared[nearest(shared,mdl.geometry.coordinates.at(-1))];
  const witness=shared[nearest(shared,[127.5,38.3])],mdlRetired=lineBetween(mdl.geometry.coordinates,west,east);
  return {paektu:{start,end,baseline:readBoundaryChain(base('PRK'),start,end,through),retiredWitness:paektuRetired[Math.floor(paektuRetired.length/2)]},
    mdl:{start:west,end:east,baseline:readBoundaryChain(base('KOR'),west,east,witness),retiredWitness:mdlRetired[Math.floor(mdlRetired.length/2)]}};
}
function atBaseline(geometry,chain) {
  const edge=(a,b)=>[JSON.stringify(a),JSON.stringify(b)].sort().join('|');
  const edges=new Set(polygons(geometry).flatMap(p=>p).flatMap(ring=>ring.slice(1).map((p,i)=>edge(ring[i],p))));
  return chain.baseline.slice(1).every((p,i)=>edges.has(edge(chain.baseline[i],p)));
}
function restoreChain(geometry,chain) {
  return atBaseline(geometry,chain)?geometry:replaceBoundaryChain(geometry,chain.start,chain.end,chain.baseline,chain.retiredWitness);
}
function provenance(previous,scope) {
  return {...previous,sourceIds:[...new Set(['natural-earth-5.1.1',...(previous?.sourceIds||[]).filter(id=>id!=='dos-lsib-11.4')])],
    retiredModernSourceIds:[...new Set([...(previous?.retiredModernSourceIds||[]),'dos-lsib-11.4'])],
    sourceFile:BASELINE_FILE,retiredEvidenceFile:RETIRED_FILE,reconstructionScope:scope,
    displayBaselineSha256:BASELINE_SHA,
    lsibDirectReplacementRetirement:{date:'2026-11-04',baselineSha256:BASELINE_SHA,retiredSourceId:'dos-lsib-11.4',scope,report:ROLLBACK_REPORT},
    displayMeaning:'Pre-LSIB Natural Earth cartographic baseline; not a precise reconstruction of a treaty or surveyed historical boundary'};
}
const activeSource=id=>id.split('+').filter(value=>value!=='dos-lsib-11.4').join('+')||'natural-earth-5.1.1';
export function restoreChinesePaektuSource(entity,countries,lines,geometryVersionId) {
  if(!entity.geometryVersions.some(v=>v.versionId===geometryVersionId&&v.validTo===null))throw Error('Missing open Chinese display geometry');
  const chain=baselineChains(countries,lines).paektu;
  const geometryVersions=entity.geometryVersions.map(v=>v.versionId!==geometryVersionId?v:{...v,
    geometry:restoreChain(v.geometry,chain),sourceId:activeSource(v.sourceId),
    historicalProvenance:provenance(v.historicalProvenance,'Paektu pre-LSIB Natural Earth shared display baseline only; other Chinese borders and historical coverage unchanged')});
  const representative=geometryVersions.find(v=>v.versionId===geometryVersionId);
  return {...entity,geometryVersions,metadata:{...entity.metadata,directLsibRollbackReport:ROLLBACK_REPORT},
    sourceInfo:{...entity.sourceInfo,sourceId:activeSource(entity.sourceInfo.sourceId),
      title:'Natural Earth Chinese display geometry with other existing supplements preserved',geometrySha256:sha(representative.geometry)}};
}
export function buildKoreanBaselineSources({sources,countries,lines}) {
  const chains=baselineChains(countries,lines),updates=new Map();
  for(const code of ['KOR','PRK']){
    const entity=sources.get('state:'+code),north=code==='PRK';
    const expected=north?['state:PRK:38th-parallel-1948','state:PRK:armistice-1953','state:PRK:sino-korean-protocol-1964']:['state:KOR:38th-parallel-1948','state:KOR:armistice-1953'];
    assert.deepEqual(entity.geometryVersions.map(v=>v.versionId),expected,'Unexpected Korean phase structure requires a scoped review');
    const geometryVersions=entity.geometryVersions.map(v=>{
      let geometry=v.geometry;if(north)geometry=restoreChain(geometry,chains.paektu);
      const parallel=v.versionId.includes('38th-parallel');if(!parallel)geometry=restoreChain(geometry,chains.mdl);
      return {...v,geometry,sourceId:parallel?'korean-38th-parallel':'natural-earth-5.1.1-armistice-display-baseline',
        historicalProvenance:provenance(v.historicalProvenance,parallel?(north?'Existing 1948 38th-parallel phase retained; Paektu pre-LSIB NE display baseline restored':'Existing 1948 38th-parallel geometry and island allocation retained'):'Existing 1953/1964 phase dates retained; mutual land boundary uses pre-LSIB NE display baseline')};
    });
    const representative=geometryVersions.find(v=>v.versionId===entity.metadata.representativeGeometryVersionId)||geometryVersions.at(-1);
    updates.set(entity.entityId,{...entity,geometryVersions,metadata:{...entity.metadata,directLsibRollbackReport:ROLLBACK_REPORT},
      sourceInfo:{...entity.sourceInfo,sourceId:'natural-earth-5.1.1',title:'Natural Earth display baseline with retained Korean historical phase dates',geometrySha256:sha(representative.geometry)}});
  }
  const china=sources.get('state:CHN');updates.set(china.entityId,restoreChinesePaektuSource(china,countries,lines,china.metadata.representativeGeometryVersionId));
  return updates;
}
export function run({check=false}={}) {
  const countries=read(BASELINE_FILE),lines=read(RETIRED_FILE),evidence=read('tools/historical-library/sources/korea/provenance.json');
  assert.equal(sha(countries),evidence.base.contentSha256,'Pinned Natural Earth base changed');
  assert.equal(sha(lines),evidence.vector.contentSha256,'Retained original LSIB evidence changed');
  const sources=new Map(['KOR','PRK','CHN'].map(code=>{const id='state:'+code;return [id,readTerritorialSource(id)];}));
  const updates=buildKoreanBaselineSources({sources,countries,lines});
  const outputs=[...updates].map(([id,value])=>({id,value:normalizeTerritorialLibraryEntity(value),path:path.join(territorialSourceRoot,'countries',entityFileName(id))}));
  if(check)for(const row of outputs)assert.deepEqual(sources.get(row.id),row.value,'Stale Korean NE-baseline source: '+row.id);
  else withLibraryOutputs({paths:outputs.map(row=>row.path)},()=>{for(const row of outputs)fs.writeFileSync(row.path,JSON.stringify(row.value,null,2)+'\n');});
  console.log((check?'Checked':'Restored')+' pre-LSIB Korean display baseline for three source objects; all phase dates retained');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run({check:process.argv.includes('--check')});
