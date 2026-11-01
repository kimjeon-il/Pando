export function createProbeStorage(invoke, { scope = globalThis } = {}) {
  if (typeof invoke !== 'function') throw new TypeError('Probe storage requires an explicit native invoke transport.');
  return Object.freeze({
    writeProbeFile(contents) {
      if (typeof contents !== 'string' || new TextEncoder().encode(contents).length > 1024 * 1024) throw new Error('Probe file exceeds the 1 MiB limit.');
      return invoke('write_probe_file', { contents });
    },
    readProbeFile: () => invoke('read_probe_file', {}),
    finishDiagnostics(report) {
      scope.__PANDOLAB_SHELL_REPORT__ = report;
      return invoke('finish_probe', { report });
    },
  });
}
