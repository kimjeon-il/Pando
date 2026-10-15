import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { timelineCases, timelineContext } from '../../tests/fixtures/timeline-records-cases.mjs';

const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/wasm/wasm/pandoeditor-core.js');
const { default: createCore }=await import(pathToFileURL(modulePath));
const core=await createCore({wasmBinary:await readFile(modulePath.replace(/\.js$/,'.wasm'))});

test('P5-4 exported timeline C++ capabilities are present and keep the document ABI',()=>{
  for(const name of ['timelineNormalizeRecords','timelineInitialMonth','timelineResolveWorld',
    'timelineEditRecord','timelineTruncateEntity'])assert.equal(typeof core[name],'function',name);
  assert.equal(core.coreAbiVersion,1);
});
test('P5-4 timeline normalization rejects the same invalid corpus and preserves input',()=>{
  for(const fixture of timelineCases()) {
    const input=structuredClone(fixture.input);
    const context=timelineContext(fixture.context);
    if(fixture.expected!=='OK') {
      assert.throws(()=>core.timelineNormalizeRecords(input,context),
        error=>error?.code===fixture.expected,fixture.name);
    } else {
      const result=core.timelineNormalizeRecords(input,context);
      assert.equal(result.schemaVersion,1,fixture.name);
      assert.deepEqual(result,core.timelineNormalizeRecords(result,context),fixture.name);
      assert.deepEqual(result.lifetimes.map(x=>x.id),input.lifetimes.map(x=>x.id),fixture.name);
    }
    assert.deepEqual(input,fixture.input,fixture.name);
  }
});
test('P5-4 read-only C++ month-end world results match the cross-platform golden corpus',()=>{
  const project=JSON.parse(readFileSync(new URL('../../tests/fixtures/timeline-exchange/complex.json',import.meta.url),'utf8'));
  const golden=JSON.parse(readFileSync(new URL('../../tests/fixtures/portability/timeline-resolution.json',import.meta.url),'utf8'));
  const context={
    entities:project.territorialEntities.map(x=>({id:x.id,entityKind:x.properties.entityKind})),
    geometryExists:ref=>project.geometries.some(x=>x.id===ref.id&&x.version===ref.version)
  };
  const normalized=core.timelineNormalizeRecords(project.timelineRecords,context);
  assert.equal(core.timelineInitialMonth(normalized,'2026-10'),'1916-01');
  for(const row of golden.cases) {
    const world=core.timelineResolveWorld(normalized,context,row.month);
    assert.equal(world.month,row.month);
    assert.deepEqual(world.entities.map(x=>[x.id,x.geometryRef.id,x.geometryRef.version,
      x.parentId,x.rootId,x.ancestors]),row.expected,row.month);
  }
});
test('P5-4 C++ record edits split, preserve future dates and preserve no-op identity signals',()=>{
  const golden=JSON.parse(readFileSync(new URL('../../tests/fixtures/portability/timeline-edit.json',import.meta.url),'utf8'));
  for(const entry of golden.cases) {
    const source=structuredClone(golden.records);
    const output=entry.op==='truncate'
      ? core.timelineTruncateEntity(source,'A',entry.month)
      : core.timelineEditRecord(source,entry.op==='geometry'?'geometryBindings':'parentRelations','A',
        entry.month,entry.op==='geometry'?{geometryRef:{id:'shape',version:entry.version}}
          :{parentId:entry.parentId,coverageMode:entry.coverageMode});
    assert.deepEqual(entry.op==='truncate'?output:output.changed?output.records:source,entry.expected,entry.name);
    if(entry.identity)assert.equal(output.changed,false,entry.name);
    assert.deepEqual(source,golden.records,'Immutable inputs: '+entry.name);
  }
});

test('P5-4 library geometry selection uses shared C++ end-of-precision rules',()=>{
  const life={validFrom:'1914',validTo:'1915'};
  const versions=[
    {validFrom:'1914-07',validTo:'1914-07-15'},
    {validFrom:'1914-07-16',validTo:'1915-12'},
  ];
  for(const name of ['timelineVersionExistsAt','timelineSelectGeometryVersion'])
    assert.equal(typeof core[name],'function',name);
  assert.equal(core.timelineVersionExistsAt(life,'1914-07'),true);
  assert.equal(core.timelineVersionExistsAt(life,'1916-01'),false);
  assert.equal(core.timelineSelectGeometryVersion(life,versions,'1914-07'),1);
  assert.equal(core.timelineSelectGeometryVersion(life,versions,'1914-07-15'),0);
  assert.equal(core.timelineSelectGeometryVersion(life,versions,'1916-01'),-1);
  assert.equal(core.timelineSelectGeometryVersion(
    {validFrom:null,validTo:null},[{validFrom:null,validTo:null}],null),0);
  assert.throws(()=>core.timelineSelectGeometryVersion(life,versions,null),/reference date/i);
  assert.throws(()=>core.timelineSelectGeometryVersion(life,
    [{validFrom:null,validTo:null},{validFrom:null,validTo:null}],'1914-07'),
  error=>error?.code==='PL-LIB-GEOMETRY');
  assert.equal(core.timelineSelectGeometryVersion({validFrom:'-0001',validTo:'0001'},
    [{validFrom:'-0001',validTo:'-0001'},{validFrom:'0001',validTo:'0001'}],'-0001'),0);
});
