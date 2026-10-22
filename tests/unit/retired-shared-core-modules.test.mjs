import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('retired native-only C++ spatial and rendering helpers stay absent', () => {
  for (const path of ["shared/core/include/pandoeditor/geobounds.h","shared/core/src/geobounds.cpp","shared/core/include/pandoeditor/spatialindex.h","shared/core/src/spatialindex.cpp","shared/core/include/pandoeditor/maprenderorder.h","shared/core/src/maprenderorder.cpp","shared/core/include/pandoeditor/picking.h"]) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }
  const cmake = read('shared/core/CMakeLists.txt');
  for (const file of ['geobounds.cpp', 'spatialindex.cpp', 'maprenderorder.cpp']) {
    assert.equal(cmake.includes('src/' + file), false, file);
  }
  const header = read('shared/core/include/pandoeditor/project.h');
  const cpp = read('shared/core/src/project.cpp');
  for (const symbol of ['pick', 'editable']) {
    assert.equal(header.includes(' ' + symbol + '('), false, symbol);
    assert.equal(cpp.includes('Project::' + symbol + '('), false, symbol);
  }
});

test('retired native Project mutation convenience APIs stay absent', () => {
  const header = read('shared/core/include/pandoeditor/project.h');
  const cpp = read('shared/core/src/project.cpp');
  for (const name of ["setColor","renameCountry","setMemo","setCountryOpacity","moveCountryToUserLayer","addUserLayer","removeUserLayer","renameUserLayer","setUserLayerVisible","setUserLayerLocked","setUserLayerOpacity","moveUserLayer","changeCountry","changeUserLayer","execute"]) {
    assert.equal(header.includes(' ' + name + '('), false, name);
    assert.equal(cpp.includes('Project::' + name + '('), false, name);
  }
});

test('removed Qt document session profile is not revived', () => {
  const header = read('shared/core/include/pandoeditor/document-session.h');
  const cpp = read('shared/core/src/document-session.cpp');
  for (const name of ['DocumentSessionProfile', 'NativeDocumentPorts', 'prepareNativeCommand', 'installNativeDraft']) {
    assert.equal(header.includes(name), false, name);
    assert.equal(cpp.includes(name), false, name);
  }
});

test('retired Qt project wire codec and native-only identity policy stay absent', () => {
  const header = read('shared/core/include/pandoeditor/projectcodec.h');
  const cpp = read('shared/core/src/projectcodec.cpp');
  const binding = read('shared/wasm/session-bindings.cpp');
  const content = read('shared/core/src/webcontentcommands.cpp');
  for (const name of ['readNativeContentEdit', 'LabelReferencePolicy', 'validateNativeLabelReferences']) {
    assert.equal(header.includes(name) || cpp.includes(name) || binding.includes(name), false, name);
  }
  for (const name of ['ContentIdentityPolicy', 'NativeExact']) {
    assert.equal(content.includes(name), false, name);
  }
  assert.equal(header.includes('ProjectDocument decode(const'), false);
  assert.equal(header.includes('std::string encode(const Project'), false);
});

test('retired user-layer data and command variants remain removed', () => {
  const header=read('shared/core/include/pandoeditor/document.h');
  const actions=read('shared/core/include/pandoeditor/commands.h');
  const processor=read('shared/core/src/commands.cpp');
  const codec=read('shared/core/src/projectcodec.cpp');
  for(const symbol of ['struct UserLayer','std::vector<UserLayer>','nativeLayerId','membership;'])assert.equal(header.includes(symbol),false,symbol);
  for(const symbol of ['AddUserLayer','RemoveUserLayer','MoveUserLayer','SetUserLayerVisible','SetUserLayerLocked','MoveCountryToUserLayer']) {
    assert.equal(actions.includes(symbol)||processor.includes(symbol),false,symbol);
  }
  assert.equal(codec.includes('userLayers'),false);
  assert.ok(header.includes('struct DistributionLayer'),'active distribution layers must remain');
});
test('CommandAction mapping indices follow their variant ordering', () => {
  const actions=read('shared/core/include/pandoeditor/commands.h');
  const processor=read('shared/core/src/commands.cpp');
  const variants=actions.match(/using CommandAction\s*=\s*std::variant<([\s\S]*?)>;/)?.[1].split(',').map(s=>s.trim());
  const text=processor.match(/const std::pair<const char\*,std::size_t> commands\[\]=\{([\s\S]*?)\};/)?.[1];
  assert.ok(variants&&text,'missing C++ command/variant table');
  const entries=Array.from(text.matchAll(/\{"([^"]+)",(\d+)\}/g),m=>[m[1],Number(m[2])]);
  const cases=[
    ['edit.properties','std::monostate'],['country.color','SetCountryColor'],['territorial.field','TerritorialFieldEdit'],
    ['territorial.color','TerritorialColorEdit'],['territorial.lock','TerritorialLockEdit'],
    ['territorial.relation.parent','ApplyTerritorialMutation'],['content.edit','ContentEdit'],['physical-data.configure','SetPhysicalData'],
    ['historical.instantiate','HistoricalInstantiationPlan'],['gis.import.generic','GisGenericImportPlan'],['gis.import.territorial','GisTerritorialImportPlan'],
    ['gis.import.distribution','GisDistributionImportPlan'],['timeline.geometry','TimelineGeometryEdit'],['timeline.parent','TimelineParentEdit'],
    ['timeline.create','TimelineCreate'],['timeline.delete','TimelineDelete'],['timeline.territorial','TimelineTerritorialMutation'],
    ['generic.import','ContentBatchEdit'],['territorial.replace','WebTerritorialEdit'],['objects.remove','WebObjectRemoval'],
    ['document.source-info','DocumentSourceInfoAppend'],['objects.lock','WebObjectEdit']
  ];
  for(const [id,type] of cases){
    const record=entries.find(([name])=>name===id);
    assert.ok(record,id);
    assert.equal(record[1],variants.indexOf(type),id+' -> '+type);
  }
});
test('native country history restore policy remains removed', () => {
  for(const file of ['shared/core/include/pandoeditor/project.h','shared/core/src/project.cpp','shared/core/src/document-session.cpp']){
    const source=read(file);
    for(const token of ['HistoryRestorePolicy','NativeCountryOverrides','restoredHistoryState'])assert.equal(source.includes(token),false,file+':'+token);
  }
});
