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
  const invalid=Buffer.from(frames[0].bytes);invalid.writeUInt32LE(4099,8);
  const dimensions=spawnSync(process.execPath,['tools/gis/physical-webp-encoder.mjs'],{input:invalid,timeout:10000});
  assert.notEqual(dimensions.status,0);assert.equal(dimensions.stdout.length,0);
});
test('physical generator saves native WebP without overwriting and retains RGBA pixels',
  {skip:!binary||!process.env.PANDO_PHYSICAL_PYTHON},t=>{
    const root=mkdtempSync(join(tmpdir(),'pando-physical-webp-'));t.after(()=>rmSync(root,{recursive:true}));
    const script="import base64,importlib.util,json,pathlib,sys;from PIL import Image;s=importlib.util.spec_from_file_location('physical','tools/build-physical-data.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);r=json.load(open('tests/fixtures/physical-gutter-composite-oracle.json'));v=r['cases'][0];box=v['box'];w=box[2]-box[0]+2;h=box[3]-box[1]+2;im=Image.frombytes('RGBA',(w,h),base64.b64decode(v['expected']));p=pathlib.Path(sys.argv[1]);e=m.PhysicalWebpEncoder();e.__enter__();e.save(im,p);before=p.read_bytes();exec('try:\\n e.save(im,p)\\n raise AssertionError(\\\"overwrite accepted\\\")\\nexcept FileExistsError:\\n pass');assert p.read_bytes()==before;e.__exit__(None,None,None);sys.stdout.buffer.write(Image.open(p).convert('RGBA').tobytes())";
    const p=spawnSync(process.env.PANDO_PHYSICAL_PYTHON,['-c',script,join(root,'candidate.webp')],{timeout:20000});
    assert.equal(p.status,0,String(p.stderr));assert.deepEqual(p.stdout,Buffer.from(fixture.cases[0].expected,'base64'));
  });
test('physical terrain candidate matches the original miniature pipeline and refuses replacement',
  {skip:!binary||!process.env.PANDO_PHYSICAL_PYTHON||!process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY},async t=>{
    const root=mkdtempSync(join(tmpdir(),'pando-physical-mini-'));t.after(()=>rmSync(root,{recursive:true}));
    const oracle=JSON.parse(readFileSync('tests/fixtures/physical-build-mini-oracle.json','utf8'));
    const script=String.raw`
import base64, hashlib, importlib.util, json, pathlib, sys
from PIL import Image
root=pathlib.Path(sys.argv[1]); source=root/'source'; source.mkdir()
inputs=root/'input'; (inputs/'hydro').mkdir(parents=True)
oracle=json.loads(pathlib.Path('tests/fixtures/physical-build-mini-oracle.json').read_text(encoding='utf-8'))
for key,name in [('gray','GRAY_HR_SR_OB.tif'),('land','HYP_HR_SR.tif'),('ocean','HYP_HR_SR_OB_DR.tif')]:
    Image.frombytes('RGB',(oracle['width'],oracle['height']),base64.b64decode(oracle['inputs'][key])).save(source/name)
countries=inputs/'countries.geojson'; countries.write_text(json.dumps(oracle['countries']),encoding='utf-8')
(inputs/'hydro'/'lakes_base.geojson').write_text(json.dumps(oracle['lakes']),encoding='utf-8')
before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()}
spec=importlib.util.spec_from_file_location('physical','tools/build-physical-data.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
arguments=dict(source_size=(4,2),level_widths=(4,),tile_size=2)
manifest=module.build_terrain(source,root/'output',countries,**arguments)
assert manifest['levels']==[dict(id=0,width=4,height=2,columns=2,rows=1,tileSize=2)]
output=root/'output'/'terrain'/'v0.12.6'/'0'/'0-0.webp'; saved=output.read_bytes()
try:
    module.build_terrain(source,root/'output',countries,**arguments)
    raise AssertionError('existing output accepted')
except FileExistsError:
    pass
assert output.read_bytes()==saved
assert before=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()}
`;
    const p=spawnSync(process.env.PANDO_PHYSICAL_PYTHON,['-c',script,root],{timeout:60000});
    assert.equal(p.status,0,String(p.stderr));
    for(const tile of oracle.tiles){
      const decoded=await readNativeRawWebp(readFileSync(join(root,'output','terrain','v0.12.6','0',`${tile.column}-0.webp`)));
      assert.equal(decoded.width,4);assert.equal(decoded.height,4);
      assert.deepEqual(decoded.data,Buffer.from(tile.rgba,'base64'));
    }
  });
