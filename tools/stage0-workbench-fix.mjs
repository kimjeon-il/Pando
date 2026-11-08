import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {libraryCheckout,decodeArchiveEntry} from './data/library-context.mjs';
const path='src/rendering/country-mesh-codec.js';let source=readFileSync(path,'utf8');
const helper=String.raw`// Native boundary rows use exact doubles; keep those out of JSON metadata.
function packBoundarySegments(part) {
  const rows=part.segments,coordinates=new Float64Array(rows.length*4),owners=new Uint32Array(rows.length);
  const groups=[],byGroup=new Map();
  rows.forEach((row,index)=>{
    if(!row||Object.keys(row).sort().join(',')!=='end,ownerIds,start'
      ||![row.start,row.end].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))
      ||!Array.isArray(row.ownerIds)||!row.ownerIds.length||row.ownerIds.some(id=>typeof id!=='string'||!id))
      throw new Error('Invalid native prepared boundary segment');
    coordinates.set([...row.start,...row.end],index*4);
    const key=JSON.stringify(row.ownerIds);let group=byGroup.get(key);
    if(group===undefined){group=groups.length;groups.push([...row.ownerIds]);byGroup.set(key,group);}
    owners[index]=group;
  });
  const packed={...part,segments:{coordinates,owners,groups}};
  if(part.outlineOverrides)packed.outlineOverrides=packBoundarySegments(part.outlineOverrides);
  return packed;
}
function unpackBoundarySegments(part) {
  const packed=part?.segments,coordinates=packed?.coordinates,owners=packed?.owners,groups=packed?.groups;
  if(!(coordinates instanceof Float64Array)||!(owners instanceof Uint32Array)||coordinates.length!==owners.length*4
    ||!Array.isArray(groups)||groups.some(group=>!Array.isArray(group)||!group.length||group.some(id=>typeof id!=='string'||!id)))
    throw new Error('Invalid packed prepared boundary segments');
  const segments=new Array(owners.length);
  for(let i=0;i<owners.length;i++){
    if(owners[i]>=groups.length)throw new Error('Invalid packed boundary owner');
    const values=coordinates.subarray(i*4,i*4+4);
    if(!values.every(Number.isFinite))throw new Error('Invalid packed boundary coordinate');
    segments[i]={start:[values[0],values[1]],end:[values[2],values[3]],ownerIds:[...groups[owners[i]]]};
  }
  const unpacked={...part,segments};
  if(part.outlineOverrides)unpacked.outlineOverrides=unpackBoundarySegments(part.outlineOverrides);
  return unpacked;
}

`;
function change(before,after){if(!source.includes(before))throw Error('Reviewed codec patch marker absent');source=source.replace(before,after);}
change('/** Scene-specific binary envelope: typed arrays remain typed, no coordinate JSON. */',helper+'/** Scene-specific binary envelope: typed arrays remain typed, no coordinate JSON. */');
change('const payload=visit(scene),metadata=','const payload=visit({...scene,boundaryPacket:packBoundarySegments(scene.boundaryPacket)}),metadata=');
change("throw new Error('Prepared country scene size limit');","throw new Error('Prepared country scene size limit: '+JSON.stringify({metadataBytes:metadata.byteLength,arrayCount:arrays.length,totalBytes:total}));");
change('const scene=visit(metadata.payload);validatePreparedScene(scene,expectedIdentity);','const scene=visit(metadata.payload);scene.boundaryPacket=unpackBoundarySegments(scene.boundaryPacket);validatePreparedScene(scene,expectedIdentity);');
writeFileSync(path,source);
const test='tests/unit/rendering/prepared-country-scene.test.mjs';
writeFileSync(test,readFileSync(test,'utf8')+String.raw`
test('boundary coordinates and repeated ownership are binary without changing exact native rows',()=>{
  const scene=packageFixture(),n=1000,part=scene.boundaryPacket;
  part.segments=Array.from({length:n},(_,i)=>({start:[0.123456789012345+i*1e-9,0],end:[0.5,1],ownerIds:['A']}));
  part.startsEnds=Float32Array.from(part.segments.flatMap(row=>[...row.start,...row.end]));
  part.chainPhase=new Float32Array(n);
  const raw=codec.encodePreparedCountryScene(scene);
  assert.ok(new Uint32Array(raw)[2]<16000,'coordinate rows must not be copied into JSON metadata');
  assert.deepEqual(codec.decodePreparedCountryScene(raw,identity).boundaryPacket.segments,part.segments);
  part.segments[0].start[0]=NaN;
  assert.throws(()=>codec.encodePreparedCountryScene(scene),/boundary segment|coordinate/i);
});
`);
// Another task stored a catalog-only descendant. Admit it only after proving
// every non-template field (especially all geometry descriptors) is unchanged.
const root=process.cwd(),checkout=libraryCheckout(root),configPath='config/library-data.json';
const config=JSON.parse(readFileSync(configPath,'utf8')),expected='c370d4f95e27c6b777239de58d3170171d7379db';
if(config.revision!==expected){
  if(config.revision!=='0e06e120ddf7ad0c8cd6b72a8dd599efef2c9098')throw Error('Review newer paired library revision before retry');
  execFileSync('git',['fetch','--no-tags','origin',expected],{cwd:checkout,stdio:'pipe'});
  const archive=JSON.parse(execFileSync('git',['show',expected+':archive/index.json'],{cwd:checkout,encoding:'utf8',maxBuffer:32*1024*1024}));
  const name='assets/data/builtin-world/generated/v1/index.json';
  const before=JSON.parse(readFileSync(name,'utf8')),after=JSON.parse(decodeArchiveEntry(checkout,archive.files[name],expected,{fetch:true}));
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
  console.log('PAIRED_CATALOG_CHANGES',JSON.stringify(changed));
  if(changed.some(key=>key!=='template'))throw Error('Concurrent catalog change exceeds reviewed template-only scope');
  console.log('PAIRED_TEMPLATE_BEFORE',JSON.stringify(before.template));console.log('PAIRED_TEMPLATE_AFTER',JSON.stringify(after.template));
  config.revision=expected;writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
  execFileSync(process.execPath,['tools/data/library-data.mjs'],{stdio:'inherit'});
}
