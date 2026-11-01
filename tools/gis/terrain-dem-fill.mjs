import {endianness} from 'node:os';
import {fillGdalDemTint} from './terrain-dem-source.mjs';

async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--fill-tint')throw Error('Usage: node terrain-dem-fill.mjs --fill-tint');
  if(endianness()!=='LE')throw Error('Native tint protocol requires a little-endian host');
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){
    size+=chunk.length;if(size>16+12000000*13)throw Error('Tint request exceeds bounds');chunks.push(chunk);
  }
  const request=Buffer.concat(chunks,size);
  if(size<16||request.subarray(0,8).toString('ascii')!=='PDTINT01')throw Error('Invalid tint request');
  const width=request.readUInt32LE(8),height=request.readUInt32LE(12),count=width*height;
  if(!width||width>30000||!height||height>16384||count>12000000||size!==16+count*13)throw Error('Invalid tint grid or request length');
  const rgb=new Float32Array(count*3);
  Buffer.from(rgb.buffer).set(request.subarray(16,16+count*12));
  const valid=request.subarray(16+count*12);
  process.stdout.write(await fillGdalDemTint({width,height,rgb,valid}));
}

main().catch(error=>{process.stderr.write(String(error.stack||error)+'\n');process.exitCode=1;});
