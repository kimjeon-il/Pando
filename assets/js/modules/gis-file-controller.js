export function createGisFileController({
  elements,
  onFiles,
  setTarget = () => {},
  requireCanonicalData = () => true,
  projectDomain = null,
  setActionStatus = () => {},
  window = globalThis,
  document = globalThis.document,
} = {}) {
  let returnFocus = null;

  const openPicker = ({ target = '', trigger = null } = {}) => {
    setTarget(target);
    returnFocus = trigger || elements.open;
    elements.input.dataset.returnFocusId = returnFocus?.id || '';
    elements.input.click();
  };

  const handleChange = async event => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    try { return await onFiles(files); }
    finally {
      const target = returnFocus;
      returnFocus = null;
      target?.focus?.({ preventScroll: true });
    }
  };

  const bind = () => {
    elements.input?.addEventListener('change', handleChange);
    return api;
  };

  const downloadBlob = (filename, blob) => {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  };

  const saveProject = async () => {
    if (!requireCanonicalData()) return false;
    const button = elements.save;
    if (button) button.disabled = true;
    try {
      return await projectDomain.save(async blob => {
        const filename = '판도연구소-프로젝트.gpkg';
        if (typeof window.showSaveFilePicker === 'function') {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'GeoPackage', accept: { 'application/geopackage+sqlite3': ['.gpkg'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setActionStatus('프로젝트 파일을 저장했습니다.', 'success', 3200);
          return { downloaded: false };
        } else {
          downloadBlob(filename, blob);
          setActionStatus('프로젝트 다운로드를 만들었습니다.', 'success', 3600);
          return { downloaded: true };
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        setActionStatus('파일 저장을 취소했습니다.', 'ready', 2200);
        return false;
      }
      console.error('[PL-GPKG-001]', error);
      setActionStatus('프로젝트 저장에 실패했습니다.', 'error', 0);
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  };

  const api = Object.freeze({ bind, openPicker, handleChange, saveProject });
  return api;
}
