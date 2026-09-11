const clone = value => {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export function createGisImportWizardController({ ensureRuntime, getOptions, onStatus = () => {} } = {}) {
  let openPromise = null;

  const open = async (files, options = {}) => {
    if (openPromise) return openPromise;
    onStatus('GIS 가져오기 도구를 준비하는 중…');
    openPromise = Promise.resolve()
      .then(() => ensureRuntime())
      .then(runtime => {
        if (typeof runtime?.openImportWizard !== 'function') throw new Error('GIS 가져오기 모듈을 불러오지 못했습니다.');
        return runtime.openImportWizard(files, { ...getOptions(), ...clone(options) });
      })
      .then(result => clone(result))
      .finally(() => { openPromise = null; });
    return openPromise;
  };

  return Object.freeze({ open });
}
