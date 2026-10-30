import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export const terrainDemCheckSources=Object.freeze(['tools/cpp/terrain-dem-check/CMakeLists.txt','tools/cpp/terrain-dem-check/check.cpp']);
export async function checkNativeDemTile({tile,reference,left,top,west,shadeStep=4,excludeNorth=false,excludeSouth=false},
  {root=rootDefault,directory=resolve(root,'build-native/terrain-dem-check/artifact'),signal}={}){
  signal?.throwIfAborted();const {width,height,data}=tile||{};
  if(![width,height].every(value=>Number.isSafeInteger(value)&&value>=3&&value<=16384)||width*height>16777216||
    !(data instanceof Uint8Array)||data.length!==width*height*4)throw Error('Valid DEM tile pixels required');
  if(!Number.isInteger(shadeStep)||shadeStep<1||shadeStep>255||typeof excludeNorth!=='boolean'||typeof excludeSouth!=='boolean')
    throw Error('Invalid DEM shade settings');
  if(reference!==undefined&&(!reference||reference.width!==width||reference.height!==height||!(reference.data instanceof Uint8Array)||reference.data.length!==data.length))
    throw Error('Matching DEM reference tile required');
  for(const [name,value,length] of [['left',left,height*4],['top',top,width*4],['west',west,height*4]])
    if(value!==undefined&&(!(value instanceof Uint8Array)||value.length!==length))throw Error('Invalid DEM '+name+' gutter');
  const flags=(reference?1:0)|(left?2:0)|(top?4:0)|(west?8:0)|(excludeNorth?16:0)|(excludeSouth?32:0);
  const header=Buffer.alloc(24);header.write('PDTCHK01');header.writeUInt32LE(width,8);header.writeUInt32LE(height,12);
  header.writeUInt32LE(flags,16);header.writeUInt32LE(shadeStep,20);
  const executable=process.platform==='win32'?'pando-terrain-dem-check.exe':'pando-terrain-dem-check';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-dem-check',executable,sourceFiles:terrainDemCheckSources});
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:65536,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native DEM tile check failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});
    for(const part of [header,data,reference?.data,left,top,west])if(part)child.stdin.write(part);child.stdin.end();
  });
  signal?.throwIfAborted();if(JSON.parse(output)?.verified!==true)throw Error('Invalid native DEM tile verification result');return true;
}

const samples=new Set(['0,0','21,5','42,10','3,17']);
function halfEven(value){const lower=Math.floor(value),fraction=value-lower;return lower+(fraction>0.5||(fraction===0.5&&lower%2!==0)?1:0);}
function column(tile,x){const output=Buffer.alloc(tile.height*4);for(let y=0;y<tile.height;y++)
  output.set(tile.data.subarray((y*tile.width+x)*4,(y*tile.width+x)*4+4),y*4);return output;}
export async function verifyTerrainDemLevel({level,readTile,readReference,sourceSample,shadeStep=4},options={}){
  options.signal?.throwIfAborted();const {id,width,height,columns,rows,tileSize}=level||{};
  if(!Number.isSafeInteger(id)||id<0||![width,height,columns,rows,tileSize].every(value=>Number.isSafeInteger(value)&&value>0)||
    width>1000000||height>1000000||tileSize>16382||columns*rows>1000000||columns!==Math.ceil(width/tileSize)||rows!==Math.ceil(height/tileSize)||
    typeof readTile!=='function'||(readReference!==undefined&&typeof readReference!=='function'))throw Error('Valid DEM level and tile readers required');
  const assets=[];let total=0,maximum=0,previousRow=new Map();
  for(let row=0;row<rows;row++){let previousRight,westInterior;const nextRow=new Map();
    for(let col=0;col<columns;col++){
      options.signal?.throwIfAborted();const tile=await readTile(col,row),expectedWidth=Math.min(tileSize,width-col*tileSize)+2,
        expectedHeight=Math.min(tileSize,height-row*tileSize)+2;
      if(!tile||tile.width!==expectedWidth||tile.height!==expectedHeight||!(tile.encoded instanceof Uint8Array)||!tile.encoded.length||tile.encoded.length>32*1024*1024)
        throw Error('DEM tile size or encoded source differs');
      const reference=readReference?await readReference(col,row):undefined;
      if(col===0)westInterior=column(tile,1);
      await checkNativeDemTile({tile,reference,left:previousRight,top:previousRow.get(col),west:col===columns-1?westInterior:undefined,
        shadeStep,excludeNorth:row===0,excludeSouth:row===rows-1},options);
      previousRight=column(tile,tile.width-1);nextRow.set(col,Buffer.from(tile.data.subarray((tile.height-1)*tile.width*4)));
      if(id===5&&samples.has(`${col},${row}`)){
        if(typeof sourceSample!=='function')throw Error('DEM original elevation sampler required');
        const source=await sourceSample(col*tileSize,row*tileSize),offset=(tile.width+1)*4;
        if(!Number.isFinite(source)||tile.data[offset]*256+tile.data[offset+1]-12000!==halfEven(source))
          throw Error('DEM elevation differs from source');
      }
      const size=tile.encoded.length;total+=size;maximum=Math.max(maximum,size);
      assets.push({path:`${id}/${col}-${row}.webp`,bytes:size,sha256:createHash('sha256').update(tile.encoded).digest('hex')});
    }
    previousRow=nextRow;
  }
  return {level:id,tiles:assets.length,bytes:total,maxTileBytes:maximum,assets};
}
