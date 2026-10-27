const CHUNK_BYTES = 256 * 1024;
const DOCUMENT_LIMIT = 256 * 1024 * 1024;
export const invokeNative = (command, payload) => {
  if (typeof globalThis.__TAURI_INTERNALS__?.invoke !== 'function') {
    throw new Error('Native shell bridge is unavailable; browser execution cannot pass native checks.');
  }
  return globalThis.__TAURI_INTERNALS__.invoke(command, payload);
};

export function encodeBytes(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}
export function decodeBytes(base64) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(CHUNK_BYTES / 3) * 4) {
    throw new Error('Invalid 256 KiB native chunk.');
  }
  const binary = atob(base64);
  if (binary.length > CHUNK_BYTES) throw new Error('Invalid 256 KiB native chunk.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function selectedGisName(path) {
  const segment = String(path || '').split(/[\\/]/).pop();
  const decoded = decodeURIComponent(segment || '');
  const name = decoded.split(/[\\/]/).pop().split(':').pop();
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
    throw new Error('GIS 파일 이름을 확인할 수 없습니다. 다른 파일 제공자를 선택하세요.');
  }
  return name;
}

function verifyDocumentBlob(blob) {
  if (!(blob instanceof Blob) || blob.size < 1 || blob.size > DOCUMENT_LIMIT) {
    throw new Error('Document must be a Blob within the 256 MiB limit.');
  }
}

export function createNativeStorage(invoke = invokeNative) {
  const acceptWrite=result=>{
    if(result?.cancelled)throw Object.assign(new Error('파일 저장 취소'),{name:'AbortError'});
    if(typeof result?.path!=='string'||!result.path)throw new Error('네이티브 파일 저장 대상이 확정되지 않았습니다.');
    return {...result,downloaded:false};
  };
  const abort = async token => {
    try { await invoke('abort_document_transfer', { token }); }
    catch (error) { console.error('[PL-NATIVE-TRANSFER-ABORT]', error); }
  };
  async function writeDocument(kind, blob) {
    verifyDocumentBlob(blob);
    const session = await invoke('begin_document_write', { kind });
    if (!Number.isSafeInteger(session?.token)) throw new Error('Native write session did not return a token.');
    const token = session.token;
    try {
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        const slice = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
        await invoke('append_document_chunk', { token, contents: encodeBytes(slice) });
      }
      return await invoke('finish_document_write', { token });
    } catch (error) {
      await abort(token);
      throw error;
    }
  }
  async function readDocument(kind) {
    const selection = await invoke('begin_document_read', { kind });
    if (selection?.cancelled) return { cancelled: true, files: [] };
    if (!Array.isArray(selection?.files) || !selection.files.length || selection.files.length > 16) {
      throw new Error('Invalid native document selection.');
    }
    if (selection.files.some(file => !Number.isSafeInteger(file.token)
        || !Number.isSafeInteger(file.bytes) || file.bytes < 1)
        || selection.files.reduce((sum, file) => sum + file.bytes, 0) > DOCUMENT_LIMIT) {
      throw new Error('Native document selection exceeds 256 MiB.');
    }
    const files = [];
    for (let index = 0; index < selection.files.length; index++) {
      const file = selection.files[index];
      const bytes = [];
      let size = 0, done;
      try {
        do {
          const part = await invoke('read_document_chunk', { token: file.token });
          const chunk = decodeBytes(part?.contents);
          if (!chunk.byteLength) throw new Error('Empty native document chunk.');
          size += chunk.byteLength;
          if (size > file.bytes) throw new Error('Native document overrun.');
          bytes.push(chunk);
          done = part.done === true;
        } while (!done);
        if (size !== file.bytes) throw new Error('Native document length differs from selection.');
        files.push({ path: file.path, blob: new Blob(bytes) });
      } catch (error) {
        await abort(file.token);
        for (const remaining of selection.files.slice(index + 1)) await abort(remaining.token);
        throw error;
      }
    }
    return { cancelled: false, files };
  }
  return Object.freeze({
    prepareProjectSave(){
      let ended=false;
      return Object.freeze({
        async write(blob){if(ended)throw new Error('File writer already finished.');ended=true;return acceptWrite(await writeDocument('project',blob));},
        async abort(){ended=true;},
      });
    },
    async saveExportFile(filename, blob) {
      const kind = filename === '판도연구소-GIS-데이터.gpkg' ? 'gis-gpkg'
        : filename === '판도연구소-GIS-데이터.zip' ? 'gis-zip' : null;
      if (!kind) throw new Error('Unsupported GIS export file name.');
      return acceptWrite(await writeDocument(kind, blob));
    },
    async openProjectFile() {
      const selected = await readDocument('project');
      if (selected.cancelled) return { cancelled: true, path: null, file: null };
      if (selected.files.length !== 1) throw new Error('Project picker must return one document.');
      const chosen=selected.files[0],name=String(chosen.path||'').split(/[\\/]/).pop();
      return { cancelled: false, path: chosen.path,
        file:new File([chosen.blob],name&&/\.gpkg$/i.test(name)?name:'판도연구소-프로젝트.gpkg',{type:'application/geopackage+sqlite3'}) };
    },
    async openGisFiles() {
      const selected = await readDocument('gis');
      if (selected.cancelled) return { cancelled: true, files: [] };
      return { cancelled: false, files: selected.files.map(file =>
        new File([file.blob], selectedGisName(file.path))) };
    },
    writeDiagnosticReport: report => invoke('write_diagnostic_report', { report }),
  });
}
const native = createNativeStorage();
export const { prepareProjectSave, saveExportFile, openProjectFile, openGisFiles,
  writeDiagnosticReport } = native;
