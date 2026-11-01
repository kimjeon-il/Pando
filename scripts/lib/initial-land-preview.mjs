import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {topology} from 'topojson-server';
import {feature} from 'topojson-client';
import {presimplify,quantile,simplify} from 'topojson-simplify';

// Derived output only. Neither the source coast nor any Core state is changed.
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const ALGORITHM='physical-land-preview-v1-topo10';
const previewCache=new Map();
function inspectLand(geometry) {
 if(geometry?.type!=='MultiPolygon'||!Array.isArray(geometry.coordinates)||!geometry.coordinates.length)
   throw new TypeError('Initial land preview requires a MultiPolygon.');
 let count=0;
 for(const polygon of geometry.coordinates){
  if(!Array.isArray(polygon)||!polygon.length)throw new TypeError('Empty physical-land polygon.');
  for(const ring of polygon){
   if(!Array.isArray(ring)||ring.length<4)throw new TypeError('Invalid physical-land ring.');
   const first=ring[0],last=ring.at(-1);
   if(!Array.isArray(first)||!Array.isArray(last)||first[0]!==last[0]||first[1]!==last[1])
     throw new TypeError('Open physical-land ring.');
   if(ring.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))
     throw new TypeError('Invalid physical-land coordinate.');
   count+=ring.length;
  }
 }
 return count;
}
function signedArea(ring){
 let value=0;
 for(let i=1;i<ring.length;i++)value+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];
 return value/2;
}
function admissibleRing(candidate,original){
 if(!Array.isArray(candidate)||candidate.length<4
   ||candidate[0]?.[0]!==candidate.at(-1)?.[0]
   ||candidate[0]?.[1]!==candidate.at(-1)?.[1])return false;
 if(candidate.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))return false;
 if(new Set(candidate.slice(0,-1).map(p=>p.join(','))).size<3)return false;
 const sourceArea=signedArea(original),outputArea=signedArea(candidate);
 if(!Number.isFinite(outputArea)||Math.abs(outputArea)<1e-12||Math.sign(outputArea)!==Math.sign(sourceArea))
   return false;
 if(Math.abs(sourceArea)>1&&Math.abs(outputArea-sourceArea)/Math.abs(sourceArea)>0.12)return false;
 return true;
}
// topojson.quantile orders weights descending; 0.10 keeps roughly the top 10%, not 90%.
export function simplifyInitialLandGeometry(source,{quantileFraction=0.10}={}){
 const sourceCoordinateCount=inspectLand(source);
 if(!(quantileFraction>=0&&quantileFraction<1))throw new RangeError('Invalid preview simplification quantile.');
 const prepared=presimplify(topology({land:source}));
 const reduced=simplify(prepared,quantile(prepared,quantileFraction));
 const candidate=feature(reduced,reduced.objects.land).geometry;
 if(candidate?.type!=='MultiPolygon'||candidate.coordinates.length!==source.coordinates.length)
   throw new Error('Preview simplification changed the island count.');
 let protectedRings=0;
 const coordinates=source.coordinates.map((polygon,i)=>{
  const result=candidate.coordinates[i];
  if(result?.length!==polygon.length)throw new Error('Preview simplification changed holes.');
  return polygon.map((ring,j)=>{
   if(admissibleRing(result[j],ring))return result[j];
   protectedRings+=1;
   return ring;
  });
 });
 const geometry={type:'MultiPolygon',coordinates};
 const coordinateCount=inspectLand(geometry);
 if(coordinateCount>sourceCoordinateCount)throw new Error('Preview simplification expanded the source geometry.');
 return{geometry,sourceCoordinateCount,coordinateCount,polygonCount:coordinates.length,
   ringCount:coordinates.reduce((n,polygon)=>n+polygon.length,0),protectedRings,quantileFraction};
}
export function createInitialLandPreviewAsset(stored,sourceAsset){
 if(!Buffer.isBuffer(stored)||sourceAsset?.encoding!=='gzip'
   ||sourceAsset?.sha256!==sha256(stored)||sourceAsset.compressedBytes!==stored.byteLength)
   throw new Error('Pinned physical land integrity validation failed.');
 const key=sourceAsset.sha256+':'+String(sourceAsset.decodedBytes)+':'+ALGORITHM;
 if(previewCache.has(key))return previewCache.get(key);
 const decoded=gunzipSync(stored);
 if(decoded.length!==sourceAsset.decodedBytes)throw new Error('Pinned physical land decoded size mismatch.');
 const original=JSON.parse(decoded.toString('utf8'));
 const result=simplifyInitialLandGeometry(original);
 const payload=Buffer.from(JSON.stringify(result.geometry));
 const bytes=gzipSync(payload,{level:9,mtime:0});
 const spec=Object.freeze({url:'assets/data/physical-land/preview/v1/'+sha256(bytes).slice(0,24)+'.json.gz',
   encoding:'gzip',compressedBytes:bytes.length,decodedBytes:payload.length,sha256:sha256(bytes),
   sourceSha256:sourceAsset.sha256,algorithm:ALGORITHM,
   coordinateCount:result.coordinateCount,sourceCoordinateCount:result.sourceCoordinateCount,
   polygonCount:result.polygonCount,ringCount:result.ringCount});
 const output=Object.freeze({spec,bytes,metrics:result});
 previewCache.set(key,output);
 return output;
}
