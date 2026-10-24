import { invokeNative } from './native-storage.js';
export function createProbeStorage(invoke = invokeNative) {
  return {
    writeProbeFile(contents) {
      if (typeof contents !== 'string' || new TextEncoder().encode(contents).length > 1024 * 1024) throw new Error('Probe file exceeds the 1 MiB limit.');
      return invoke('write_probe_file', { contents });
    },
    readProbeFile: () => invoke('read_probe_file', {}),
    finishDiagnostics(report) {
      globalThis.__PANDOLAB_SHELL_REPORT__ = report;
      return invoke('finish_probe', { report });
    },
  };
}
export const { writeProbeFile, readProbeFile, finishDiagnostics } = createProbeStorage();
