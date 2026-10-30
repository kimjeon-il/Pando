import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {composeNativeDiagnosticOverlays} from '../../tools/map-image/native-resample.mjs';

test('diagnostic overlays preserve Pillow channel order, known masks and truncation',async()=>{
  const width=4,height=3,pixels=width*height,original=Buffer.from(Array.from({length:pixels*3},(_,i)=>(i*7)&255));
  const known=Buffer.alloc(pixels*7,1);known[0]=0;known[3*pixels+11]=0;
  const active=Array.from({length:2},(_,p)=>Buffer.from(Array.from({length:pixels*7},(_,i)=>{
    const c=Math.floor(i/pixels),y=Math.floor((i%pixels)/width),x=i%width;return (c*3+y*2+x+p)%5<2?1:0;
  })));
  const result=await composeNativeDiagnosticOverlays({width,height,original,known,active});
  assert.equal(Buffer.concat(result).toString('hex'),'00bba0c02e189508bd9d09b59508bd9d0ab52dbba5c136312fbda7c13731c130199e0ebe0098299408bd9d09b52bb9a39d0ab52dbaa4c13631c12f19c13631c12f199609be9e0bb6');
  await assert.rejects(composeNativeDiagnosticOverlays({width,height,original,known,active:[]}),/panels/i);
  const invalid=Buffer.from(known);invalid[1]=2;
  await assert.rejects(composeNativeDiagnosticOverlays({width,height,original,known:invalid,active}),/binary/i);
});

test('diagnostic overlay matches frozen NumPy colors for every input byte',async()=>{
  const width=256,height=7,pixels=width*height;
  const original=Buffer.from(Array.from({length:pixels*3},(_,i)=>{const x=Math.floor(i/3)%width,y=Math.floor(i/(width*3)),c=i%3;return (x+c*83+y*11)%256;}));
  const known=Buffer.alloc(pixels*7,1);
  const active=Array.from({length:2},(_,p)=>Buffer.from(Array.from({length:pixels*7},(_,i)=>{
    const c=Math.floor(i/pixels),y=Math.floor((i%pixels)/width),x=i%width;return p===0?Number(c===y):Number((c+y+x)%3!==0);
  })));
  const result=await composeNativeDiagnosticOverlays({width,height,original,known,active});
  assert.equal(createHash('sha256').update(Buffer.concat(result)).digest('hex'),'82d6351e62b4fc509565e54a71a8ddc690edd90b7450059b48d73641633e8a89');
});
