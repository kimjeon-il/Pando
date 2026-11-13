import test from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/rendering/workers/canvas-terrain-dem-core.js';
const core=globalThis.PandoLabCanvasTerrainDem;
function dem(){return new Uint8ClampedArray([0,750,2500,6500].flatMap(h=>[(h+12000)>>8,(h+12000)&255,212,255]));}
function api(){assert.equal(typeof core.rasterizeInterpolatedTriangle,'function','actual destination-pixel numerical rasterizer exists');return core.rasterizeInterpolatedTriangle;}
const source=[[0,0],[2,0],[0,2]],destination=[[0,0],[8,0],[0,8]];

test('numerical Canvas samples fractional heights at destination pixel centers, not precolored pixels',()=>{
  const raster=api(),sampler=core.createInterpolatedSampler({dem:dem(),width:2,height:2});
  const blocks=[...raster({sample:sampler,source,destination,viewportWidth:8,viewportHeight:8,blockRows:2})];
  assert.ok(blocks.length>0);
  let compared=0;
  for(const block of blocks)for(let y=0;y<block.height;y++)for(let x=0;x<block.width;x++){
    const at=(y*block.width+x)*4;if(!block.rgba[at+3])continue;
    const expected=new Uint8ClampedArray(4);
    sampler((block.x+x+0.5)/4-0.5,(block.y+y+0.5)/4-0.5,expected);
    assert.deepEqual([...block.rgba.subarray(at,at+4)],[...expected]);compared++;
  }
  assert.ok(compared>20);
});

test('numeric rasterization is viewport bounded and cooperatively chunked',()=>{
  const raster=api();let sampled=0;
  const sample=(_x,_y,out,at)=>{sampled++;out.set([20,30,40,255],at);};
  const blocks=[...raster({sample,source,destination:[[-1000,-1000],[5000,-1000],[-1000,5000]],viewportWidth:32,viewportHeight:20,blockRows:4})];
  assert.ok(blocks.every(b=>b.height<=4&&b.width<=32&&b.x>=0&&b.y>=0));
  assert.ok(blocks.every(b=>b.rgba.byteLength<=128*1024));
  assert.equal(sampled,32*20);
  assert.deepEqual([...raster({sample,source,destination:[[90,90],[100,90],[90,100]],viewportWidth:32,viewportHeight:20})],[]);
  assert.equal(sampled,32*20,'offscreen triangles do not sample');
});

test('two adjacent numerical triangles cover a quad without cracks or differing seam colors',()=>{
  const raster=api(),sample=core.createInterpolatedSampler({dem:dem(),width:2,height:2});
  const painted=new Map();
  for(const [src,dst] of [[source,destination],[[[2,0],[2,2],[0,2]],[[8,0],[8,8],[0,8]]]]){
    for(const block of raster({sample,source:src,destination:dst,viewportWidth:8,viewportHeight:8}))
      for(let y=0;y<block.height;y++)for(let x=0;x<block.width;x++){
        const at=(y*block.width+x)*4;if(!block.rgba[at+3])continue;
        const key=(block.y+y)*8+block.x+x,color=[...block.rgba.subarray(at,at+4)];
        if(painted.has(key))assert.deepEqual(color,painted.get(key));painted.set(key,color);
      }
  }
  assert.equal(painted.size,64);
});

test('optional unshaded natural pigment is composited once and never affects ocean or monochrome',()=>{
  const pixels=new Uint8ClampedArray([100,150,80,255,100,150,80,255,100,150,80,255,100,150,80,255]);
  const options={dem:dem(),width:2,height:2,x:0.3,y:0.4};
  const naturalSurface={data:pixels,width:2,height:2,mixWeight:1};
  const color=core.sampleInterpolated({...options,naturalSurface});
  assert.ok(Math.abs(color[0]-100)<=1&&Math.abs(color[1]-150)<=1&&Math.abs(color[2]-80)<=1);
  for(const channel of ['ocean','political'])assert.deepEqual(core.sampleInterpolated({...options,channel,naturalSurface}),core.sampleInterpolated({...options,channel}));
  const dark=core.sampleInterpolated({...options,naturalSurface,theme:'dark'});
  assert.ok(dark[0]<color[0]&&dark[1]<color[1]);
});

test('invalid source water cannot leak black or blue color into the physical-land mask',()=>{
  const options={dem:dem(),width:2,height:2,x:0.5,y:0.5};
  const invalid={data:new Uint8ClampedArray(16),width:2,height:2,mixWeight:0.65};
  assert.deepEqual(core.sampleInterpolated({...options,naturalSurface:invalid}),core.sampleInterpolated(options));
  invalid.data.set([10,60,160,255],0);
  assert.deepEqual(core.sampleInterpolated({...options,naturalSurface:invalid}),core.sampleInterpolated(options));
});


test('Canvas respects sparse coverage edges but never feathers an uploaded natural neighbour',()=>{
  const width=130,height=4,elevation=750,encoded=elevation+12000;
  const dem=new Uint8ClampedArray(width*height*4);
  const natural=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<dem.length;i+=4){
    dem.set([encoded>>8,encoded&255,212,255],i);
    natural.set([210,80,50,255],i);
  }
  const params={dem,width,height,theme:'light',channel:'land'};
  const base={...params,naturalSurface:{data:natural,width,height,mixWeight:0.65}};
  const faded={...params,naturalSurface:{...base.naturalSurface,fadeEdges:[1,0,0,0]}};
  const plain=core.sampleInterpolated({...params,x:0.5,y:1});
  assert.deepEqual(core.sampleInterpolated({...faded,x:0.5,y:1}),plain,
    'uncovered west tile boundary must exactly retain the DEM palette');
  const middle=core.sampleInterpolated({...faded,x:31.5,y:1});
  const unfeathered=core.sampleInterpolated({...base,x:31.5,y:1});
  assert.notDeepEqual(middle,plain);
  assert.notDeepEqual(middle,unfeathered);
  assert.deepEqual(core.sampleInterpolated({...faded,x:80.5,y:1}),
    core.sampleInterpolated({...base,x:80.5,y:1}),
    'natural color must remain unmodified away from the missing boundary');
  assert.deepEqual(core.sampleInterpolated({...params,x:31.5,y:1,
      naturalSurface:{...base.naturalSurface,fadeEdges:[0,0,0,0]}}),
    unfeathered,'present neighbours disable the internal fade');
  assert.throws(()=>core.createInterpolatedSampler({...params,
    naturalSurface:{...base.naturalSurface,fadeEdges:[1,2,0,0]}}),/edge flags/);
});


test('single-owner top-left raster edges prevent overlapping triangle pixels and fill every pixel',()=>{
  const quad=[
    {src:[[0,0],[2,0],[0,2]],dst:[[0,0],[8,0],[0,8]]},
    {src:[[2,0],[2,2],[0,2]],dst:[[8,0],[8,8],[0,8]]},
  ];
  const count=new Uint8Array(64);
  for(const {src,dst} of quad)
    for(const block of api()({sample:(_x,_y,out,offset)=>out.set([17,61,93,255],offset),
      source:src,destination:dst,viewportWidth:8,viewportHeight:8,blockRows:4}))
      for(let y=0;y<block.height;y++)for(let x=0;x<block.width;x++){
        if(!block.rgba[(y*block.width+x)*4+3])continue;
        count[(y+block.y)*8+x+block.x]++;
      }
  assert.ok(count.every(value=>value===1),'one shared triangle must own each diagonal edge pixel');
  for(const {src,dst} of quad){
    const forward=[...api()({sample:()=>{},source:src,destination:dst,viewportWidth:8,viewportHeight:8})];
    const reversed=[...api()({sample:()=>{},source:[...src].reverse(),destination:[...dst].reverse(),
      viewportWidth:8,viewportHeight:8})];
    assert.deepEqual(forward.map(block=>block.pixels),reversed.map(block=>block.pixels),
      'winding direction must not create cracks or double-painted pixels');
  }
});


test('PCHIP screen-pixel fast cubic preserves original exact integer-height palette outputs',()=>{
  const heights=[-50,0,1,128,255,256,257,500,749,750,751,1499,1500,1501,
    2499,2500,2501,3499,3500,3501,4499,4500,4501,6499,6500,7250];
  for(const theme of ['light','dark'])for(const shade of [0,80,180,212,255])
    for(const height of heights){
      const encoded=height+12000;
      const dem=new Uint8ClampedArray(16);
      for(let offset=0;offset<dem.length;offset+=4)
        dem.set([encoded>>8,encoded&255,shade,255],offset);
      const expected=core.convertTile({dem,width:2,height:2,theme}).land;
      const actual=core.sampleInterpolated({dem,width:2,height:2,x:0.3,y:0.7,theme,channel:'land'});
      const delta=Math.max(...actual.slice(0,3).map((value,i)=>Math.abs(value-expected[i])));
      assert.ok(delta<=1,`height=${height}, shade=${shade}, theme=${theme}, delta=${delta}`);
    }
});
