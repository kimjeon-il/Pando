import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';

const fixture=JSON.parse(readFileSync('tests/fixtures/physical-gutter-composite-oracle.json','utf8'));
const binary=process.env.PANDO_MAP_IMAGE_ARTIFACT;
function frame(row){
  const width=row.box[2]-row.box[0]+2,height=row.box[3]-row.box[1]+2;
  const header=Buffer.alloc(16);header.write('PWEBP001');header.writeUInt32LE(width,8);header.writeUInt32LE(height,12);
  const expected=Buffer.from(row.expected,'base64');return {width,height,expected,bytes:Buffer.concat([header,expected])};
}
test('physical WebP stream preserves all RGBA pixels and frame boundaries',{skip:!binary},async()=>{
  const frames=fixture.cases.map(frame),transparent=Buffer.from([200,10,50,0,100,99,2,1,0,50,10,255]),header=Buffer.alloc(16);
  header.write('PWEBP001');header.writeUInt32LE(3,8);header.writeUInt32LE(1,12);
  frames.push({width:3,height:1,expected:transparent,bytes:Buffer.concat([header,transparent])});
  const input=Buffer.concat(frames.map(row=>row.bytes));
  const p=spawnSync(process.execPath,['tools/gis/physical-webp-encoder.mjs'],{input,maxBuffer:2*1024*1024,timeout:20000});
  assert.equal(p.status,0,String(p.stderr));let offset=0;
  for(let i=0;i<frames.length;i++){
    assert.ok(offset+4<=p.stdout.length);const size=p.stdout.readUInt32LE(offset);offset+=4;
    assert.ok(size>12&&offset+size<=p.stdout.length);
    const decoded=await readNativeRawWebp(p.stdout.subarray(offset,offset+size));offset+=size;
    assert.equal(decoded.width,frames[i].width);assert.equal(decoded.height,frames[i].height);
    assert.deepEqual(decoded.data,frames[i].expected);
  }
  assert.equal(offset,p.stdout.length);
  const bad=spawnSync(process.execPath,['tools/gis/physical-webp-encoder.mjs'],{input:frames[0].bytes.subarray(0,-1),timeout:10000});
  assert.notEqual(bad.status,0);assert.equal(bad.stdout.length,0);
});
test('physical generator saves native WebP without overwriting and retains RGBA pixels',
  {skip:!binary||!process.env.PANDO_PHYSICAL_PYTHON},t=>{
    const root=mkdtempSync(join(tmpdir(),'pando-physical-webp-'));t.after(()=>rmSync(root,{recursive:true}));
    const script="import base64,importlib.util,json,pathlib,sys;from PIL import Image;s=importlib.util.spec_from_file_location('physical','tools/build-physical-data.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);r=json.load(open('tests/fixtures/physical-gutter-composite-oracle.json'));v=r['cases'][0];box=v['box'];w=box[2]-box[0]+2;h=box[3]-box[1]+2;im=Image.frombytes('RGBA',(w,h),base64.b64decode(v['expected']));p=pathlib.Path(sys.argv[1]);e=m.PhysicalWebpEncoder();e.__enter__();e.save(im,p);before=p.read_bytes();exec('try:\\n e.save(im,p)\\n raise AssertionError(\\\"overwrite accepted\\\")\\nexcept FileExistsError:\\n pass');assert p.read_bytes()==before;e.__exit__(None,None,None);sys.stdout.buffer.write(Image.open(p).convert('RGBA').tobytes())";
    const p=spawnSync(process.env.PANDO_PHYSICAL_PYTHON,['-c',script,join(root,'candidate.webp')],{timeout:20000});
    assert.equal(p.status,0,String(p.stderr));assert.deepEqual(p.stdout,Buffer.from(fixture.cases[0].expected,'base64'));
  });
