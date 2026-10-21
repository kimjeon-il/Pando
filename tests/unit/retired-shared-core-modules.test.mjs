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
