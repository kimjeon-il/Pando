// Experimental adapter: verified COG windows to the existing image tile API.
// PNG serialization is deliberately included in C's measured CPU cost.
import {openVerifiedCog} from './verified-cog-reader.mjs';

const hex=bytes=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
const digest=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));

export async function openViewerCogTiles({url,cogManifest,tileManifest,tileSize,region='southwest-china',fetchFn=globalThis.fetch,
  maxChunkCacheBytes=32*1024*1024,maxTileCacheBytes=32*1024*1024}){
  if(cogManifest?.schema!=='pando-terrain-cog-viewer-fixture-v1'||
    tileManifest?.schema!=='pando-terrain-gutter-webp-v1'||cogManifest.sourceSha256!==tileManifest.sourceSha256||
    !Array.isArray(cogManifest.baseOrigin)||cogManifest.baseOrigin.length!==2||![512,1024].includes(tileSize)||
    (cogManifest.region||'southwest-china')!==region||!Number.isSafeInteger(maxTileCacheBytes)||maxTileCacheBytes<0)
    throw new TypeError('Invalid COG Viewer fixture identities');
  const records=tileManifest.records.filter(record=>record.tileSize===tileSize&&record.region===region),expected=tileSize===1024?4:16;
  if(records.length!==expected)throw Error('Incomplete COG Viewer tile inventory');
  const byKey=new Map();
  for(const record of records){
    const x=record.window[0]+record.offset[0],y=record.window[1]+record.offset[1];
    if(x%tileSize||y%tileSize||record.width!==tileSize+2||record.height!==tileSize+2||
      !/^[a-f0-9]{64}$/.test(record.rawSha256||''))throw Error('Invalid COG tile record');
    const key=`5/${x/tileSize}-${y/tileSize}.webp`;
    if(byKey.has(key))throw Error('Duplicate COG tile');byKey.set(key,{record,x,y});
  }
  const {tiff,statistics}=await openVerifiedCog({url,manifest:cogManifest,fetchFn,maxCacheBytes:maxChunkCacheBytes});
  const image=await tiff.getImage(0),cached=new Map(),counts={decodedTiles:0,reusedTiles:0,pngCacheBytes:0,tileEvictions:0,maxTileCacheBytes};
  return {statistics,counts,async readTile(key,{signal}={}){
    signal?.throwIfAborted();
    if(cached.has(key)){counts.reusedTiles++;const value=cached.get(key);cached.delete(key);cached.set(key,value);return value;}
    const entry=byKey.get(key);if(!entry)throw Error('COG tile is outside the selected regional fixture');
    const {record,x,y}=entry,[originX,originY]=cogManifest.baseOrigin;
    const left=x-originX-1,top=y-originY-1,right=left+record.width,bottom=top+record.height;
    if(left<0||top<0||right>image.getWidth()||bottom>image.getHeight())throw Error('COG window lacks tile gutters');
    const rgb=await image.readRasters({window:[left,top,right,bottom],samples:[0,1,2],interleave:true,signal});
    if(rgb.length!==record.width*record.height*3)throw Error('Decoded COG tile length mismatch');
    const rgba=new Uint8ClampedArray(record.width*record.height*4);
    for(let src=0,dst=0;src<rgb.length;src+=3,dst+=4){rgba[dst]=rgb[src];rgba[dst+1]=rgb[src+1];rgba[dst+2]=rgb[src+2];rgba[dst+3]=255;}
    if(await digest(rgba)!==record.rawSha256)throw Error('Decoded COG tile differs from the Q1 reference');
    signal?.throwIfAborted();
    const surface=new OffscreenCanvas(record.width,record.height),context=surface.getContext('2d');
    if(!context)throw Error('PNG encoding context unavailable');
    context.putImageData(new ImageData(rgba,record.width,record.height),0,0);
    const png=await surface.convertToBlob({type:'image/png'});signal?.throwIfAborted();
    counts.decodedTiles++;
    if(png.size<=maxTileCacheBytes){
      if(cached.has(key)){counts.pngCacheBytes-=cached.get(key).size;cached.delete(key);}
      while(counts.pngCacheBytes+png.size>maxTileCacheBytes&&cached.size){
        const oldest=cached.keys().next().value;counts.pngCacheBytes-=cached.get(oldest).size;cached.delete(oldest);counts.tileEvictions++;
      }
      counts.pngCacheBytes+=png.size;cached.set(key,png);
    }
    return png;
  }};
}
