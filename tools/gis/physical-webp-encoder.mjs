// Source-bound lossless image encoding for physical tiles, framed over one stream.
import {encodeNativeWebpLossless} from '../map-image/native-resample.mjs';

const iterator=process.stdin[Symbol.asyncIterator]();let pending=Buffer.alloc(0),ended=false;
async function take(size,allowEnd=false){
  const parts=[];let remaining=size;
  while(remaining){
    if(!pending.length&&!ended){const next=await iterator.next();ended=next.done;if(!ended)pending=Buffer.from(next.value);}
    if(!pending.length&&ended){if(allowEnd&&remaining===size)return null;throw Error('Truncated physical WebP stream');}
    const n=Math.min(remaining,pending.length);parts.push(pending.subarray(0,n));pending=pending.subarray(n);remaining-=n;
  }
  return Buffer.concat(parts,size);
}
async function write(bytes){await new Promise((accept,reject)=>process.stdout.write(bytes,error=>error?reject(error):accept()));}
try{
  if(process.argv.length!==2)throw Error('Physical WebP encoder takes framed input only');
  for(;;){
    const header=await take(16,true);if(header===null)break;
    if(header.toString('ascii',0,8)!=='PWEBP001')throw Error('Invalid physical WebP header');
    const width=header.readUInt32LE(8),height=header.readUInt32LE(12),pixels=width*height;
    if(!width||!height||width>4098||height>4098||pixels>16777216)throw Error('Invalid physical WebP dimensions');
    const data=await take(pixels*4),encoded=await encodeNativeWebpLossless({width,height,data});
    if(encoded.data.length>pixels*5+1048576)throw Error('Physical WebP output exceeds budget');
    const size=Buffer.alloc(4);size.writeUInt32LE(encoded.data.length);await write(size);await write(encoded.data);
  }
}catch(error){console.error('physical-webp-encoder: '+error.message);process.exitCode=1;}
