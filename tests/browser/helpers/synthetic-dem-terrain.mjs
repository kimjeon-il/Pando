import {deflateSync} from 'node:zlib';
import {TERRAIN_DEM_VERSION} from "../../../src/data/terrain-manifest.js";

const crc32=bytes=>{
  let value=0xffffffff;
  for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=value>>>1^((value&1)?0xedb88320:0);}
  return (value^0xffffffff)>>>0;
};

function solidPng(width,height){
  const chunk=(type,data)=>{
    const name=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);
    size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([name,data])));
    return Buffer.concat([size,name,data,checksum]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const stride=width*4+1,raw=Buffer.alloc(stride*height);
  for(let x=0;x<width;x++)raw.set([46,224,128,255],1+x*4);
  for(let y=1;y<height;y++)raw.copy(raw,y*stride,0,stride);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

export function syntheticDemManifest(){
  return {version:TERRAIN_DEM_VERSION,representation:'dem-relief-v1',crs:'EPSG:4326',extent:[-180,-90,180,90],
    gutter:1,tileFormat:'lossless WebP RGBA',registration:'cell-center',sourceGridOrigin:[-180,90],
    sourceResolutionDegrees:[1/120,1/120],elevation:{decode:'R*256+G-12000',biasMeters:12000,spacingMeters:1,validEncodedRange:[0,65535]},
    channels:{r:'encoded elevation high byte',g:'encoded elevation low byte',b:'precomputed hillshade',a:'255'},
    shade:{azimuthDegrees:315,altitudeDegrees:45,ambient:.42,diffuse:.58,polarFallbackDegrees:89.5},
    tint:{url:`terrain/v${TERRAIN_DEM_VERSION}/tint.webp`,width:4,height:2},assetsSha256:'a'.repeat(64),sources:[],
    urlTemplate:`terrain/v${TERRAIN_DEM_VERSION}/{level}/{column}-{row}.webp`,
    levels:Array.from({length:6},(_,id)=>({id,width:1350*2**id,height:675*2**id,tileSize:1024,
      columns:Math.ceil(1350*2**id/1024),rows:Math.ceil(675*2**id/1024)}))};
}

export async function routeSyntheticDem(surface){
  const manifest=syntheticDemManifest(),images=new Map();
  await surface.route('**/terrain/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/manifest.json'))return route.fulfill({json:manifest});
    const match=path.match(/\/(\d+)\/(\d+)-(\d+)\.webp$/);
    let width=manifest.tint.width,height=manifest.tint.height;
    if(match){
      const level=manifest.levels[Number(match[1])];
      if(!level)throw new Error(`Unexpected DEM level in ${path}`);
      width=Math.min(level.tileSize,level.width-Number(match[2])*level.tileSize)+2;
      height=Math.min(level.tileSize,level.height-Number(match[3])*level.tileSize)+2;
    }else if(!path.endsWith('/tint.webp'))throw new Error(`Unexpected DEM asset ${path}`);
    if(width<1||height<1)throw new Error(`Invalid DEM tile ${path}`);
    const key=`${width}x${height}`;
    if(!images.has(key))images.set(key,solidPng(width,height));
    await route.fulfill({contentType:'image/png',body:images.get(key)});
  });
  return manifest;
}
