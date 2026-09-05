const LABELS = Object.freeze({
  countries: '국가', territories: '권역', administrative: '행정구역', regions: '지방',
  genericFeatures: '기타 객체', distributions: '분포', labels: '지명',
});

export function createGisExportController({
  window,
  document,
  elements,
  ensureRuntime,
  requireReady,
  getProject,
  getCounts,
  download,
  setStatus,
  reportError,
} = {}) {
  let step = 0;
  let returnFocus = null;

  const selectedLayers = () => [...elements.form.querySelectorAll('.gis-export-layers input:checked')].map(input => input.value);
  const updateSummary = () => {
    const counts = getCounts();
    const selected = selectedLayers();
    const nonEmpty = selected.filter(layer => counts[layer] > 0);
    const empty = selected.filter(layer => counts[layer] === 0);
    const format = elements.format?.value === 'geojson-zip' ? 'GeoJSON 묶음' : 'GIS용 GeoPackage';
    const summary = elements.summary?.querySelector('p');
    if (!summary) return;
    const included = nonEmpty.length ? nonEmpty.map(layer => `${LABELS[layer]} ${counts[layer].toLocaleString()}개`).join(' · ') : '생성할 데이터 없음';
    const omitted = empty.length ? ` 비어 있는 ${empty.map(layer => LABELS[layer]).join(', ')} 파일은 만들지 않습니다.` : '';
    summary.textContent = `${format} · ${included}.${omitted}`;
  };

  const setStep = (value, { focus = false } = {}) => {
    step = value === 1 ? 1 : 0;
    for (const element of elements.form.querySelectorAll('[data-gis-export-step]')) element.dataset.gisActive = String(Number(element.dataset.gisExportStep) === step);
    elements.stepIndicator.textContent = `${step + 1}/2 · ${step ? '형식과 파일 내용 확인' : '내보낼 데이터'}`;
    elements.back.disabled = step === 0;
    elements.next.classList.toggle('hidden', step === 1);
    elements.confirm.classList.toggle('hidden', step !== 1);
    if (step === 1) updateSummary();
    if (focus) window.requestAnimationFrame(() => elements.form.querySelector(`[data-gis-export-step="${step}"][data-gis-active="true"] :is(input, select, button)`)?.focus());
  };

  const open = async () => {
    await ensureRuntime();
    if (!requireReady()) return false;
    const HTMLElementCtor = document.defaultView?.HTMLElement;
    returnFocus = typeof HTMLElementCtor === 'function' && document.activeElement instanceof HTMLElementCtor ? document.activeElement : elements.trigger;
    elements.error.textContent = '';
    elements.error.classList.add('hidden');
    elements.modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    setStep(0, { focus: true });
    return true;
  };

  const close = () => {
    if (elements.modal?.classList.contains('hidden')) return false;
    elements.modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    const target = returnFocus?.isConnected ? returnFocus : elements.trigger;
    returnFocus = null;
    target?.focus({ preventScroll: true });
    return true;
  };

  const confirm = async () => {
    const selected = selectedLayers();
    const counts = getCounts();
    if (!selected.some(layer => counts[layer] > 0)) {
      elements.error.textContent = '내보낼 데이터가 있는 범주를 하나 이상 선택하세요.';
      elements.error.classList.remove('hidden');
      return false;
    }
    elements.confirm.disabled = true;
    elements.error.classList.add('hidden');
    try {
      setStatus('GIS 데이터를 내보내는 중입니다.', 'working', 0);
      const project = getProject();
      if (elements.format.value === 'geojson-zip') {
        const result = await window.PandoLabGIS.exportGeoJsonBundle(project, selected, (_message, percent) => setStatus(`GeoJSON 묶음 생성 중 · ${Math.round(percent || 0)}%`, 'working', 0));
        download('판도연구소-GIS-데이터.zip', result.blob);
        close();
        setStatus(`GeoJSON 레이어 ${result.manifest.layers.length}개를 만들었습니다.`, 'success', 3600);
      } else {
        const blob = await window.PandoLabGIS.exportGeoPackage(project, (_message, percent) => setStatus(`GIS용 GeoPackage 생성 중 · ${Math.round(percent || 0)}%`, 'working', 0), { mode: 'gis', layers: selected });
        download('판도연구소-GIS-데이터.gpkg', blob);
        close();
        setStatus('GIS용 GeoPackage를 만들었습니다.', 'success', 3600);
      }
      return true;
    } catch (error) {
      elements.error.textContent = error?.message || String(error);
      elements.error.classList.remove('hidden');
      reportError(error);
      return false;
    } finally {
      elements.confirm.disabled = false;
    }
  };

  const bind = () => {
    elements.close?.addEventListener('click', close);
    elements.cancel?.addEventListener('click', close);
    elements.backdrop?.addEventListener('click', close);
    elements.back?.addEventListener('click', () => setStep(0, { focus: true }));
    elements.next?.addEventListener('click', () => {
      if (!selectedLayers().length) {
        elements.error.textContent = '내보낼 범주를 하나 이상 선택하세요.';
        elements.error.classList.remove('hidden');
        return;
      }
      elements.error.classList.add('hidden');
      setStep(1, { focus: true });
    });
    elements.confirm?.addEventListener('click', confirm);
    elements.format?.addEventListener('change', updateSummary);
    elements.form.querySelector('.gis-export-layers')?.addEventListener('change', updateSummary);
    return api;
  };

  const api = Object.freeze({ bind, open, close, confirm, updateSummary });
  return api;
}
