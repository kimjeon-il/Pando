import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';

async function run(args){
  const child=spawn(process.execPath,[resolve('tools/qgis/native-bridge.mjs'),...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',value=>{stdout+=value;});child.stderr.on('data',value=>{stderr+=value;});
  const [code]=await once(child,'close');return {code,stdout,stderr};
}
async function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'pando-qgis-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const input=join(root,'input.geojson');writeFileSync(input,JSON.stringify({type:'FeatureCollection',features:[]}));
  const server=createServer(socket=>{
    let text='';socket.on('error',error=>{if(error.code!=='ECONNRESET')throw error;});
    socket.on('data',chunk=>{text+=chunk;if(!text.includes('\n'))return;
      const request=JSON.parse(text.slice(0,text.indexOf('\n')));assert.equal(request.token,'cli-test-token');
      let result;
      if(request.command==='status')result={transport:'pando-native-v1',qgis_version:'3.44.15'};
      else if(request.command==='canvas')result={extent:[10,20,30,40],crs:'EPSG:4326',width:800,height:600,scale:1000,rotation:0,magnification:1};
      else if(request.command==='project-crs'){assert.equal(request.crs,'EPSG:3857');result={crs:request.crs};}
      else if(request.command==='canvas-screenshot')result={mimeType:'image/png',data:'iVBORw0KGgo='};
      else if(request.command==='canvas-scale'){assert.equal(request.scale,2000);assert.equal(request.rotation,15);result={ok:true,scale:request.scale,rotation:request.rotation};}
      else if(request.command==='canvas-extent'){assert.deepEqual(request.bounds,[10,20,30,40]);assert.equal(request.sourceCrs,'EPSG:4326');result={extent:request.bounds,crs:'EPSG:4326'};}
      else if(request.command==='edit-status'){assert.equal(request.layer,'layer-1');result={id:request.layer,editable:true,modified:true,owned:true,canUndo:true,canRedo:false,undoSteps:1,pending:{added:1,deleted:0,changedAttributes:0,changedGeometries:0}};}
      else if(request.command==='zoom-to-layer'){assert.equal(request.layer,'layer-1');result={ok:true,id:request.layer};}
      else if(request.command==='transform'){
        assert.equal(request.sourceCrs,'EPSG:4326');assert.equal(request.targetCrs,'EPSG:3857');
        assert.deepEqual(request.points,[[-1,2]]);result={points:[[1,2]]};}
      else if(request.command==='project')result={title:'map',layer_count:1,layers:[{id:'layer-1'}]};
      else if(request.command==='layers'){assert.equal(request.offset,0);assert.equal(request.limit,10);
        result={layers:[{id:'layer-1',visible:true}],total_count:1,offset:0,limit:10};}
      else if(request.command==='schema'){assert.equal(request.layer,'layer-1');
        result={layer:'layer-1',fields:[{name:'source',type:'Map',length:0,precision:0}]};}
      else if(request.command==='set-visibility'){assert.equal(request.layer,'layer-1');assert.equal(request.visible,false);result={checked:false,visible:false};}
      else if(request.command==='remove-layer'){assert.ok(['layer-1','raster-1'].includes(request.layer));result={removed:true,id:request.layer};}
      else if(request.command==='algorithms'){assert.equal(request.search,'buffer');assert.equal(request.limit,2);result={algorithms:[{id:'native:buffer',name:'Buffer'}],hasMore:false};}
      else if(request.command==='features'){
        assert.equal(request.layer,'layer-1');assert.equal(request.offset,0);assert.equal(request.limit,1);
        result={features:[{fid:'1',attributesJson:JSON.stringify({source:{sequence:JSON.rawJSON('9007199254740993')}})}],hasMore:true,crs:'EPSG:4326'};
      }
      else if(request.command==='select'){assert.equal(request.layer,'layer-1');
        if(request.expression!==undefined){assert.equal(request.expression,'"name" = \'map\'');result={selected:1};}
        else{assert.deepEqual(request.fids,['1','9007199254740993']);result={selected:2};}}
      else if(request.command==='selection'){assert.equal(request.layer,'layer-1');result={fids:['1','9007199254740993'],count:2};}
      else if(request.command==='clear-selection'){assert.equal(request.layer,'layer-1');result={ok:true};}
      else if(['begin-edit','rollback-edit','commit-edit','undo-edit','redo-edit'].includes(request.command)){
        assert.equal(request.layer,'layer-1');result={ok:true};}
      else if(request.command==='set-attribute'){
        assert.equal(request.layer,'layer-1');assert.equal(request.fid,'1');
        assert.equal(request.field,'name');assert.equal(request.json,JSON.stringify('edited'));result={updated:true};}
      else if(request.command==='add-field'){assert.equal(request.layer,'layer-1');assert.equal(request.field,'label');assert.equal(request.fieldType,'string');result={added:true};}
      else if(request.command==='delete-field'){assert.equal(request.layer,'layer-1');assert.equal(request.field,'label');result={deleted:true};}
      else if(request.command==='rename-field'){assert.equal(request.field,'label');assert.equal(request.newField,'new_label');result={renamed:true};}
      else if(request.command==='set-geometry'){
        assert.equal(request.layer,'layer-1');assert.equal(request.fid,'1');
        assert.equal(request.wkt,'POINT (127 37)');result={updated:true};}
      else if(request.command==='delete-feature'){
        assert.equal(request.layer,'layer-1');assert.equal(request.fid,'-1');result={deleted:true};}
      else if(request.command==='add-feature'){
        assert.equal(request.layer,'layer-1');assert.equal(request.wkt,'POINT (127 37)');
        assert.equal(request.json,'{"name":"new","source":{"sequence":9007199254740993}}');result={fid:'-2'};}
      else if(request.command==='open'){assert.equal(request.path,input);result={id:'layer-1',feature_count:1,crs:'EPSG:4326'};}
      else if(request.command==='open-raster'){assert.equal(request.path,input);result={id:'raster-1',width:3,height:2,bands:1,crs:'EPSG:4326'};}
      else if(request.command==='raster-info'){assert.equal(request.layer,'raster-1');result={id:'raster-1',width:3,height:2,bands:1,crs:'EPSG:4326'};}
      else if(request.command==='raster-sample'){assert.equal(request.layer,'raster-1');assert.equal(request.x,10.5);assert.equal(request.y,19.5);assert.equal(request.band,1);result={valid:true,value:5,band:1};}
      else if(request.command==='export'){
        assert.equal(request.layer,'layer-1');writeFileSync(request.output,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',
          geometry:{type:'Point',coordinates:[127,37]},properties:{source:'{"schemaVersion":1,"sourceId":"map"}'}}]}),{flag:'wx'});
        result={output:request.output,features:1,crs:'EPSG:4326'};
      }else if(request.command==='buffer'){
        assert.equal(request.layer,'layer-1');assert.equal(request.distance,50);assert.equal(request.segments,5);
        writeFileSync(request.output,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[127,37],[128,37],[128,38],[127,37]]]},properties:{name:'buffer'}}]}),{flag:'wx'});
        result={output:request.output,features:1,crs:'EPSG:4326'};
      }else if(request.command==='clip'){
        assert.equal(request.layer,'layer-1');assert.equal(request.overlay,'overlay-1');
        writeFileSync(request.output,JSON.stringify({type:'FeatureCollection',features:[]}),{flag:'wx'});
        result={output:request.output,features:0,crs:'EPSG:4326'};
      }else throw Error('Unexpected command');
      socket.end(JSON.stringify({ok:true,result})+'\n');
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const config=join(root,'config.json');writeFileSync(config,JSON.stringify({host:'127.0.0.1',port:server.address().port,token:'cli-test-token'}));
  return {root,input,config};
}
test('native QGIS CLI exchanges status, opens a file and exports without overwriting',async t=>{
  const {root,input,config}=await fixture(t);
  const status=await run(['--config',config,'status']);assert.equal(status.code,0,status.stderr);
  assert.equal(JSON.parse(status.stdout).transport,'pando-native-v1');
  const canvas=await run(['--config',config,'canvas']);assert.equal(canvas.code,0,canvas.stderr);assert.deepEqual(JSON.parse(canvas.stdout).extent,[10,20,30,40]);
  const crs=await run(['--config',config,'project-crs','--target-crs','EPSG:3857']);assert.equal(crs.code,0,crs.stderr);assert.equal(JSON.parse(crs.stdout).crs,'EPSG:3857');
  assert.notEqual((await run(['--config',config,'project-crs'])).code,0);
  const screenshot=await run(['--config',config,'canvas-screenshot']);assert.equal(screenshot.code,0,screenshot.stderr);assert.equal(JSON.parse(screenshot.stdout).mimeType,'image/png');
  const scale=await run(['--config',config,'canvas-scale','--scale','2000','--rotation','15']);assert.equal(scale.code,0,scale.stderr);assert.equal(JSON.parse(scale.stdout).scale,2000);
  const extent=await run(['--config',config,'canvas-extent','--bounds','[10,20,30,40]','--source-crs','EPSG:4326']);assert.equal(extent.code,0,extent.stderr);assert.deepEqual(JSON.parse(extent.stdout).extent,[10,20,30,40]);
  assert.notEqual((await run(['--config',config,'canvas-extent','--bounds','[30,20,10,40]'])).code,0);
  const editStatus=await run(['--config',config,'edit-status','--layer','layer-1']);assert.equal(editStatus.code,0,editStatus.stderr);assert.equal(JSON.parse(editStatus.stdout).pending.added,1);
  assert.notEqual((await run(['--config',config,'canvas-scale','--scale','0'])).code,0);
  assert.notEqual((await run(['--config',config,'canvas','--scale','1000'])).code,0);
  assert.notEqual((await run(['normalize',input,'--output',join(root,'invalid.geojson'),'--rotation','15'])).code,0);
  const project=await run(['--config',config,'project']);assert.equal(project.code,0,project.stderr);assert.equal(JSON.parse(project.stdout).layer_count,1);
  const zoom=await run(['--config',config,'zoom-to-layer','--layer','layer-1']);assert.equal(zoom.code,0,zoom.stderr);assert.equal(JSON.parse(zoom.stdout).id,'layer-1');
  assert.notEqual((await run(['--config',config,'zoom-to-layer'])).code,0);
  const layers=await run(['--config',config,'layers','--offset','0','--limit','10']);assert.equal(layers.code,0,layers.stderr);
  assert.equal(JSON.parse(layers.stdout).layers[0].id,'layer-1');
  const invalidPage=await run(['--config',config,'layers','--limit','101']);assert.notEqual(invalidPage.code,0);
  const schema=await run(['--config',config,'schema','--layer','layer-1']);assert.equal(schema.code,0,schema.stderr);
  assert.equal(JSON.parse(schema.stdout).fields[0].name,'source');
  const missingLayer=await run(['--config',config,'schema']);assert.notEqual(missingLayer.code,0);
  const visibility=await run(['--config',config,'set-visibility','--layer','layer-1','--visible','false']);
  assert.equal(visibility.code,0,visibility.stderr);assert.equal(JSON.parse(visibility.stdout).visible,false);
  const invalidVisibility=await run(['--config',config,'set-visibility','--layer','layer-1','--visible','yes']);assert.notEqual(invalidVisibility.code,0);
  const removed=await run(['--config',config,'remove-layer','--layer','layer-1']);assert.equal(removed.code,0,removed.stderr);
  assert.equal(JSON.parse(removed.stdout).removed,true);
  const removedRaster=await run(['--config',config,'remove-layer','--layer','raster-1']);assert.equal(removedRaster.code,0,removedRaster.stderr);
  assert.equal(JSON.parse(removedRaster.stdout).id,'raster-1');
  assert.notEqual((await run(['--config',config,'remove-layer'])).code,0);
  const algorithms=await run(['--config',config,'algorithms','--search','buffer','--limit','2']);
  assert.equal(algorithms.code,0,algorithms.stderr);assert.equal(JSON.parse(algorithms.stdout).algorithms[0].id,'native:buffer');
  const features=await run(['--config',config,'features','--layer','layer-1','--limit','1']);assert.equal(features.code,0,features.stderr);
  assert.match(features.stdout,/9007199254740993/);
  const decoded=JSON.parse(features.stdout,(key,value,context)=>key==='sequence'?BigInt(context.source):value);
  assert.equal(decoded.features[0].fid,'1');assert.equal(decoded.features[0].attributes.source.sequence,9007199254740993n);
  const selected=await run(['--config',config,'select','--layer','layer-1','--fids','["1","9007199254740993"]']);
  assert.equal(selected.code,0,selected.stderr);assert.equal(JSON.parse(selected.stdout).selected,2);
  const selection=await run(['--config',config,'selection','--layer','layer-1']);assert.equal(selection.code,0,selection.stderr);
  assert.deepEqual(JSON.parse(selection.stdout).fids,['1','9007199254740993']);
  const cleared=await run(['--config',config,'clear-selection','--layer','layer-1']);assert.equal(cleared.code,0,cleared.stderr);
  const invalidFids=await run(['--config',config,'select','--layer','layer-1','--fids','[9007199254740993]']);assert.notEqual(invalidFids.code,0);
  const expression=await run(['--config',config,'select','--layer','layer-1','--expression','"name" = \'map\'']);
  assert.equal(expression.code,0,expression.stderr);assert.equal(JSON.parse(expression.stdout).selected,1);
  const both=await run(['--config',config,'select','--layer','layer-1','--fids','[]','--expression','true']);assert.notEqual(both.code,0);
  const begin=await run(['--config',config,'begin-edit','--layer','layer-1']);assert.equal(begin.code,0,begin.stderr);
  const addField=await run(['--config',config,'add-field','--layer','layer-1','--field','label','--field-type','string']);assert.equal(addField.code,0,addField.stderr);
  const renameField=await run(['--config',config,'rename-field','--layer','layer-1','--field','label','--new-field','new_label']);assert.equal(renameField.code,0,renameField.stderr);
  const deleteField=await run(['--config',config,'delete-field','--layer','layer-1','--field','label']);assert.equal(deleteField.code,0,deleteField.stderr);
  const update=await run(['--config',config,'set-attribute','--layer','layer-1','--fid','1','--field','name','--json',JSON.stringify('edited')]);
  assert.equal(update.code,0,update.stderr);assert.equal(JSON.parse(update.stdout).updated,true);
  const undo=await run(['--config',config,'undo-edit','--layer','layer-1']);assert.equal(undo.code,0,undo.stderr);
  const redo=await run(['--config',config,'redo-edit','--layer','layer-1']);assert.equal(redo.code,0,redo.stderr);
  const rollback=await run(['--config',config,'rollback-edit','--layer','layer-1']);assert.equal(rollback.code,0,rollback.stderr);
  const invalidUpdate=await run(['--config',config,'set-attribute','--layer','layer-1','--fid','x','--field','name','--json',JSON.stringify('x')]);assert.notEqual(invalidUpdate.code,0);
  const geometry=await run(['--config',config,'set-geometry','--layer','layer-1','--fid','1','--wkt','POINT (127 37)']);
  assert.equal(geometry.code,0,geometry.stderr);assert.equal(JSON.parse(geometry.stdout).updated,true);
  const deleted=await run(['--config',config,'delete-feature','--layer','layer-1','--fid=-1']);
  assert.equal(deleted.code,0,deleted.stderr);assert.equal(JSON.parse(deleted.stdout).deleted,true);
  const invalidDelete=await run(['--config',config,'delete-feature','--layer','layer-1','--fid=9223372036854775808']);
  assert.notEqual(invalidDelete.code,0);
  const added=await run(['--config',config,'add-feature','--layer','layer-1','--wkt','POINT (127 37)','--json','{"name":"new","source":{"sequence":9007199254740993}}']);
  assert.equal(added.code,0,added.stderr);assert.equal(JSON.parse(added.stdout).fid,'-2');
  const opened=await run(['--config',config,'open',input]);assert.equal(opened.code,0,opened.stderr);
  assert.equal(JSON.parse(opened.stdout).id,'layer-1');
  const raster=await run(['--config',config,'open-raster',input]);assert.equal(raster.code,0,raster.stderr);
  assert.equal(JSON.parse(raster.stdout).id,'raster-1');
  const rasterInfo=await run(['--config',config,'raster-info','--layer','raster-1']);assert.equal(rasterInfo.code,0,rasterInfo.stderr);
  assert.equal(JSON.parse(rasterInfo.stdout).bands,1);
  const sampled=await run(['--config',config,'raster-sample','--layer','raster-1','--x','10.5','--y','19.5','--band','1']);
  assert.equal(sampled.code,0,sampled.stderr);assert.equal(JSON.parse(sampled.stdout).value,5);
  const invalidSample=await run(['--config',config,'raster-sample','--layer','raster-1','--x','NaN','--y','19.5']);assert.notEqual(invalidSample.code,0);
  const output=join(root,'output.geojson');const exported=await run(['--config',config,'export','--layer','layer-1','--output',output]);
  assert.equal(exported.code,0,exported.stderr);assert.equal(JSON.parse(exported.stdout).output,output);
  const bytes=readFileSync(output);assert.equal(JSON.parse(bytes).features[0].properties.source.sourceId,'map');
  const repeated=await run(['--config',config,'export','--layer','layer-1','--output',output]);
  assert.notEqual(repeated.code,0);assert.match(repeated.stderr,/exists/i);assert.deepEqual(readFileSync(output),bytes);
  const buffered=join(root,'buffer.geojson');const buffer=await run(['--config',config,'buffer','--layer','layer-1','--distance','50','--output',buffered]);
  assert.equal(buffer.code,0,buffer.stderr);assert.equal(JSON.parse(readFileSync(buffered)).features[0].geometry.type,'Polygon');
  const existingBuffer=readFileSync(buffered);const repeatBuffer=await run(['--config',config,'buffer','--layer','layer-1','--distance','50','--output',buffered]);
  assert.notEqual(repeatBuffer.code,0);assert.deepEqual(readFileSync(buffered),existingBuffer);
  const clipped=join(root,'clip.geojson');const clip=await run(['--config',config,'clip','--layer','layer-1','--overlay','overlay-1','--output',clipped]);
  assert.equal(clip.code,0,clip.stderr);assert.deepEqual(JSON.parse(readFileSync(clipped)).features,[]);
  assert.notEqual((await run(['--config',config,'clip','--layer','layer-1','--output',join(root,'missing.geojson')])).code,0);
  for(const value of ['NaN','1e999','0x10']){
    const invalid=await run(['--config',config,'buffer','--layer','layer-1','--distance',value,'--output',join(root,'invalid.geojson')]);
    assert.notEqual(invalid.code,0);
  }
  const invalidSegments=await run(['--config',config,'buffer','--layer','layer-1','--distance','50','--segments','0','--output',join(root,'invalid.geojson')]);
  assert.notEqual(invalidSegments.code,0);
});
test('native QGIS CLI rejects invalid input without exposing its token',async t=>{
  const {root,config}=await fixture(t);
  const missing=await run(['--config',config,'open',join(root,'missing.geojson')]);assert.notEqual(missing.code,0);
  const bad=join(root,'bad.json');writeFileSync(bad,JSON.stringify({host:'192.0.2.1',port:1234,token:'cli-test-token'}));
  const result=await run(['--config',bad,'status']);assert.notEqual(result.code,0);assert.match(result.stderr,/loopback/i);
  assert.doesNotMatch(result.stderr,/cli-test-token/);
  writeFileSync(bad,'{"token":"cli-test-token", INVALID}');
  const malformed=await run(['--config',bad,'status']);assert.notEqual(malformed.code,0);
  assert.match(malformed.stderr,/invalid.*json/i);assert.doesNotMatch(malformed.stderr,/cli-test-token/);
});

test('native QGIS CLI forwards explicit CRS transforms and rejects malformed batches',async t=>{
  const {config}=await fixture(t);
  const args=['--config',config,'transform','--source-crs','EPSG:4326','--target-crs','EPSG:3857'];
  const converted=await run([...args,'--points=[[-1,2]]']);assert.equal(converted.code,0,converted.stderr);
  assert.deepEqual(JSON.parse(converted.stdout).points,[[1,2]]);
  for(const points of ['[]','[[1]]','[[1,"2"]]','[[1,2,3]]','[[1e999,0]]']){
    const rejected=await run([...args,'--points='+points]);assert.notEqual(rejected.code,0,points);
  }
  const unrelated=await run(['--config',config,'status','--points','[]']);assert.notEqual(unrelated.code,0);
});
