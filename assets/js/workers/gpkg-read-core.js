function tableExists(db, tableName) {
  const statement = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1");
  statement.bind([tableName]);
  const exists = statement.step();
  statement.free();
  return exists;
}
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
export async function readAtlasTables(buffer, getSql) {
  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(buffer));
  try {
    if (tableExists(db,'pandolab_reference_sources')) throw new TypeError('Unsupported retired project attachments.');
    const result = { projectState: null, countryAssets: [], sourceInfo: null };
    if (tableExists(db, 'pandolab_project_settings')) {
      const rows = db.exec("SELECT json_value FROM pandolab_project_settings WHERE setting_key='project_state' LIMIT 1");
      if (rows[0]?.values?.[0]?.[0]) {
        result.projectState = JSON.parse(rows[0].values[0][0]);
        if (Object.hasOwn(result.projectState,'packageAssets')) throw new TypeError('Unsupported retired project attachments.');
      }
      if (db.exec("SELECT 1 FROM pandolab_project_settings WHERE setting_key='reference_images' LIMIT 1")[0]?.values.length)
        throw new TypeError('Unsupported retired project attachments.');
    }
    if (tableExists(db, 'pandolab_country_assets')) {
      const statement = db.prepare('SELECT country_id, mime_type, image_data FROM pandolab_country_assets');
      while (statement.step()) {
        const row = statement.get();
        result.countryAssets.push({ countryId: String(row[0]), mimeType: String(row[1]), base64: bytesToBase64(new Uint8Array(row[2])) });
      }
      statement.free();
    }
    if (tableExists(db, 'pandolab_source_info')) {
      const rows = db.exec("SELECT json_value FROM pandolab_source_info WHERE info_key='source' LIMIT 1");
      if (rows[0]?.values?.[0]?.[0]) result.sourceInfo = JSON.parse(rows[0].values[0][0]);
    }
    return result;
  } finally {
    db.close();
  }
}
