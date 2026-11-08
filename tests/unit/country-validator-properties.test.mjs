import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {buildCurrentWorld} from "../../tools/data/territorial-current-world.mjs";

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=[
  '#include "country-properties.h"',
  '#include <iostream>',
  '#include <string>',
  'int main() {',
  '    std::string line;',
  '    try {',
  '        while(std::getline(std::cin,line)) {',
  '            const auto properties=pandoeditor::codecjson::parse(line);',
  '            pandoeditor::tools::requireCountryProperties(properties);',
  "            std::cout<<properties.encode()<<'\\n';",
  '        }',
  '    } catch(const std::exception& error) {',
  "        std::cerr<<error.what()<<'\\n';",
  '        return 1;',
  '    }',
  '}',
].join('\n');

test('native country property validation follows the canonical producer contract',async t=>{
  const build=resolve(root,'build-native/territorial-tools');
  mkdirSync(build,{recursive:true});
  const input=resolve(build,'country-properties-probe-'+process.pid+'.cpp');
  const binary=resolve(build,'country-properties-probe-'+process.pid+(process.platform==='win32'?'.exe':''));
  t.after(()=>{rmSync(input,{force:true});rmSync(binary,{force:true});});
  writeFileSync(input,source);
  const compile=spawnSync(process.env.CXX||'c++',['-std=c++17',
    '-I'+resolve(root,'tools/cpp'),'-I'+resolve(root,'shared/core/include'),
    input,resolve(root,'shared/core/src/losslessjson.cpp'),'-o',binary],
  {cwd:root,encoding:'utf8',timeout:60000});
  assert.ifError(compile.error);
  assert.equal(compile.status,0,compile.stderr);
  const check=properties=>spawnSync(binary,[],{
    input:JSON.stringify(properties)+'\n',encoding:'utf8',timeout:5000});
  const accepted=properties=>{
    const result=check(properties);
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),properties,'validation must preserve all properties');
  };
  const rejected=properties=>{
    const result=check(properties);
    assert.ifError(result.error);assert.equal(result.status,1);
    assert.match(result.stderr,/Expected (?:only )?country (name|metadata)/);
  };
  await t.test('preview name-only properties remain valid',()=>accepted({name:'한국 · Korea'}));
  await t.test('canonical flag metadata is accepted without rewriting the opaque value',()=>
    accepted({name:'Ireland',metadata:{flagDataUrl:'flags/source.svg?variant=original#flag'}}));
  await t.test('other source metadata remains opaque and unchanged',()=>
    accepted({name:'Fixture',metadata:{flagDataUrl:'not a normalized data URL',source:{years:[1900,null],reviewed:false},label:'원본'}}));
  await t.test('canonical producer output retains its source metadata and exact geometry',()=>{
    const geometry={type:'Polygon',coordinates:[[[0,0],[0,2],[2,2],[2,0],[0,0]]]};
    const entity={entityId:'state:fixture',entityKind:'general',names:{en:'Fixture'},
      geometryVersions:[{versionId:'fixture:v1',geometry}],
      metadata:{defaultFlagDataUrl:'opaque:fixture flag'},
      sourceInfo:{featureId:'FIX',featureProperties:{name:'Original',metadata:{flagDataUrl:'replaced',source:{reviewed:false}}}}};
    const view={schemaVersion:1,selections:[{entityId:entity.entityId,geometryVersionId:'fixture:v1'}],
      sourceInfo:{collectionMetadata:{type:'FeatureCollection',bbox:[0,0,2,2]}}};
    const before=structuredClone({entity,view});
    const result=buildCurrentWorld({entities:[entity],view});
    assert.deepEqual(result.features,[{type:'Feature',id:'FIX',
      properties:{name:'Fixture',metadata:{flagDataUrl:'opaque:fixture flag',source:{reviewed:false}}},geometry}]);
    assert.deepEqual({entity,view},before);
    accepted(result.features[0].properties);
    delete entity.metadata.defaultFlagDataUrl;
    const withoutFlag=buildCurrentWorld({entities:[entity],view}).features[0];
    assert.deepEqual(withoutFlag.properties,{name:'Fixture',metadata:{source:{reviewed:false}}});
    assert.deepEqual(withoutFlag.geometry,geometry);
    accepted(withoutFlag.properties);
  });
  await t.test('missing names and unknown top-level properties are rejected',()=>{
    for(const properties of [{},{metadata:{}},{name:'Fixture',unexpected:true},
      {name:'Fixture',metadata:{},unexpected:true}])rejected(properties);
  });
  await t.test('a country name must remain a nonempty string',()=>{
    for(const name of ['',null,42,false,[],{}])rejected({name});
  });
  await t.test('metadata must be an object and cannot replace the name',()=>{
    for(const metadata of [null,[],42,false,'opaque'])rejected({name:'Fixture',metadata});
    accepted({name:'Fixture',metadata:{}});
  });
  await t.test('non-object property containers are rejected',()=>{
    for(const properties of [null,[],'Fixture',42,false])rejected(properties);
  });
});
