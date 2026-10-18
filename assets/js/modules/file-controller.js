import { readProjectFile } from './project-file-reader.js';
export function createFileController({
  productMode,
  readProject=readProjectFile,
  openProject=null,
  reportOperationError,
  elements,
  onFiles,
  setTarget = () => {},
  requireCanonicalData = () => true,
  projectDomain = null,
  fileAccess = null,
  setActionStatus = () => {},
  window = globalThis,
  document = globalThis.document,
} = {}) {
  if(!['viewer','editor'].includes(productMode))throw new TypeError('File operations require immutable product mode.');
  if(typeof reportOperationError!=='function')throw new TypeError('File operations require their operation error reporter.');
  const loadProject=openProject||((read)=>projectDomain.open(read));
  let returnFocus = null;
  let saving = false;

  const openPicker = async ({ target = '', trigger = null } = {}) => {
    setTarget(target);
    returnFocus = trigger || elements.open;
    if (!fileAccess) {
      elements.input.dataset.returnFocusId = returnFocus?.id || '';
      elements.input.click();
      return true;
    }
    const focusTarget = returnFocus;
    try {
      const selection = await fileAccess.openGisFiles();
      if (selection?.cancelled) {
        setTarget('');
        return false;
      }
      if (!Array.isArray(selection?.files) || !selection.files.length) throw new Error('선택한 GIS 파일이 없습니다.');
      return await onFiles(selection.files, { sourceKind: 'vector' });
    } catch (error) {
      setTarget('');
      throw error;
    } finally {
      returnFocus = null;
      focusTarget?.focus?.({ preventScroll: true });
    }
  };

  const handleChange = async event => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    try {
      if(event.target===elements.projectInput)return files.length?await loadProject(()=>readProject(files[0])):false;
      if(productMode!=='editor')throw new Error('GIS import is unavailable in this product.');
      return await onFiles(files,{sourceKind:'vector'});
    }
    finally {
      const target = returnFocus;
      returnFocus = null;
      target?.focus?.({ preventScroll: true });
    }
  };

  const bind = () => {
    if(productMode==='editor')elements.input?.addEventListener('change',event=>{handleChange(event).catch(reportOperationError);});
    elements.projectInput.addEventListener('change',event=>{handleChange(event).catch(reportOperationError);});
    return api;
  };

  const openProjectPicker = async () => {
    setTarget('');
    returnFocus = elements.projectOpen;
    if (!fileAccess) {
      elements.projectInput.dataset.returnFocusId = returnFocus?.id || '';
      elements.projectInput.click();
      return true;
    }
    const target = returnFocus;
    try {
      const selected = await fileAccess.openProjectFile();
      if (selected?.cancelled) return false;
      if (!(selected?.blob instanceof Blob)) throw new TypeError('The application project picker must return a Blob.');
      const name = String(selected.path || '').split(/[\\/]/).pop();
      const filename = name && /\.gpkg$/i.test(name) ? name : '판도연구소-프로젝트.gpkg';
      const file=new File([selected.blob],filename,{type:'application/geopackage+sqlite3'});
      return await loadProject(()=>readProject(file));
    } finally {
      returnFocus = null;
      target?.focus?.({ preventScroll: true });
    }
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

  const saveExportFile = async (filename, blob) => {
    if (!fileAccess) {
      downloadBlob(filename, blob);
      return { downloaded: true };
    }
    const result = await fileAccess.saveExportFile(filename, blob);
    if (result?.cancelled) throw Object.assign(new Error('GIS 내보내기 취소'), { name: 'AbortError' });
    if (!result?.path) throw new Error('앱 파일 내보내기 대상이 확정되지 않았습니다.');
    return { downloaded: false };
  };

  const saveProject = async () => {
    if (saving || !requireCanonicalData()) return false;
    saving = true;
    const button = elements.save;
    if (button) button.disabled = true;
    try {
      const filename = '판도연구소-프로젝트.gpkg';
      // Request the destination while the click still has user activation.
      const handle = !fileAccess && typeof window.showSaveFilePicker === 'function'
        ? await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: '판도연구소 프로젝트', accept: { 'application/geopackage+sqlite3': ['.gpkg'] } }],
        }) : null;
      return await projectDomain.save(async blob => {
        if (fileAccess) {
          const selected = await fileAccess.saveProjectFile(blob);
          if (selected?.cancelled) throw Object.assign(new Error('프로젝트 저장 취소'), { name: 'AbortError' });
          if (!selected?.path) throw new Error('앱 파일 저장 대상이 확정되지 않았습니다.');
          setActionStatus('프로젝트 저장 완료', 'success', 3200);
          return { downloaded: false };
        }
        if (handle) {
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setActionStatus('프로젝트 저장 완료', 'success', 3200);
          return { downloaded: false };
        } else {
          downloadBlob(filename, blob);
          setActionStatus('브라우저 다운로드 폴더에 저장 완료', 'success', 4800);
          return { downloaded: true };
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        setActionStatus('저장 취소', 'ready', 2200);
        return false;
      }
      console.error('[PL-GPKG-001]', error);
      setActionStatus('프로젝트 저장 실패', 'error', 0);
      return false;
    } finally {
      saving = false;
      if (button) button.disabled = false;
    }
  };

  const api = Object.freeze({bind,openProjectPicker,handleChange,...(productMode==='editor'?{openPicker,saveProject,saveExportFile}:{})});
  return api;
}
