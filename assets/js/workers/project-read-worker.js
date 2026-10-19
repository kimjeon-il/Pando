'use strict';
let sql;
const getSql = () => {
  if (!sql) {
    importScripts('../vendor/sql/sql-wasm.js');
    sql = self.initSqlJs({ locateFile: () => new URL('../vendor/sql/sql-wasm.wasm', self.location.href).href });
  }
  return sql;
};
self.onmessage = async ({ data }) => {
  try {
    if (data.action !== 'read') throw new Error('프로젝트 읽기만 허용됩니다.');
    const { readAtlasTables } = await import('./gpkg-read-core.js');
    const metadata = await readAtlasTables(data.buffer, getSql);
    if (!metadata.projectState) throw new Error('현재 PandoLab 프로젝트 형식의 저장 정보가 없습니다.');
    self.postMessage({ ok: true, metadata });
  } catch (error) { self.postMessage({ ok: false, error: error.message }); }
};
