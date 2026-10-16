const LIMIT = 1024 * 1024;
const invokeNative = (command, payload) => {
  if (typeof globalThis.__TAURI_INTERNALS__?.invoke !== 'function') throw new Error('Native shell bridge is unavailable; browser execution cannot pass native checks.');
  return globalThis.__TAURI_INTERNALS__.invoke(command, payload);
};
export function encodeBytes(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
export function decodeBytes(base64) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(LIMIT / 3) * 4) throw new Error('Native project exceeds the 1 MiB limit.');
  const binary = atob(base64);
  if (binary.length > LIMIT) throw new Error('Native project exceeds the 1 MiB limit.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
export function createNativeStorage(invoke = invokeNative) {
  return Object.freeze({
    async saveProjectFile(blob) {
      if (!(blob instanceof Blob) || blob.size > LIMIT) throw new Error('Project must be a Blob within the 1 MiB prototype limit.');
      return invoke('save_project_file', { contents: encodeBytes(new Uint8Array(await blob.arrayBuffer())) });
    },
    async openProjectFile() {
      const result = await invoke('open_project_file', {});
      if (result.cancelled) return { cancelled: true, path: null, blob: null };
      return { cancelled: false, path: result.path, blob: new Blob([decodeBytes(result.contents)], { type: 'application/geopackage+sqlite3' }) };
    },
    writeProbeFile: contents => {
      if (typeof contents !== 'string' || new TextEncoder().encode(contents).length > LIMIT) throw new Error('Probe file exceeds the 1 MiB limit.');
      return invoke('write_probe_file', { contents });
    },
    readProbeFile: () => invoke('read_probe_file', {}),
    writeDiagnosticReport: report => invoke('write_diagnostic_report', { report }),
    finishDiagnostics: report => {
      globalThis.__PANDOLAB_SHELL_REPORT__ = report;
      return invoke('finish_probe', { report });
    },
  });
}
const native = createNativeStorage();
export const { saveProjectFile, openProjectFile, writeProbeFile, readProbeFile, writeDiagnosticReport, finishDiagnostics } = native;
