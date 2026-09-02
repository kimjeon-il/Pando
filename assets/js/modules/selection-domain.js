const cloneValue = value => {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) { /* fall through */ }
  }
  if (Array.isArray(value)) return value.map(cloneValue);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
};

export function createSelectionDomain({
  context = null,
  projectDomain = null,
  spatialIndex = null,
  selectionController = null,
  selectionPacketFactory = null,
  normalizeRef = value => value,
  refExists = () => true,
  selectHandlers = {},
  withSelectionGuard = callback => callback(),
  countryType = 'country',
  onSelectionChanged = () => {},
  requestRender = () => {},
} = {}) {
  let revision = 0;
  let styleRevision = 0;
  let hover = null;
  let style = null;
  let disposed = false;
  const controller = selectionController;
  const readController = () => controller?.snapshot?.() || { primaryKey: null, keys: [], items: [] };
  const signature = value => {
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  };
  const snapshot = () => Object.freeze({
    revision,
    styleRevision,
    style: cloneValue(style),
    hover: cloneValue(hover),
    selection: cloneValue(readController()),
    projectGeneration: projectDomain?.getGeneration?.() || 0,
  });
  let lastSignature = signature({ hover, selection: readController() });
  const emit = (reason, { force = false, style = false } = {}) => {
    const nextSignature = signature({ hover, selection: readController() });
    if (!force && !style && nextSignature === lastSignature) return snapshot();
    lastSignature = nextSignature;
    revision += 1;
    if (style) styleRevision += 1;
    const value = snapshot();
    onSelectionChanged(value, reason);
    (typeof requestRender === 'function' ? requestRender : context?.requestRender)?.(reason || 'selection-change');
    return value;
  };
  const active = () => {
    if (disposed) throw new Error('Selection domain is disposed.');
  };
  const select = (ref, options) => { active(); controller?.replace?.(ref, options); return emit('replace'); };
  const toggle = (ref, options) => { active(); controller?.toggle?.(ref, options); return emit('toggle'); };
  const clear = options => { active(); controller?.clear?.(options); return emit('clear'); };
  const setHover = ref => { active(); hover = cloneValue(ref); return emit('hover'); };
  const updateStyle = nextStyle => {
    active();
    style = cloneValue(nextStyle);
    return emit('selection-style', { force: true, style: true });
  };
  const selectObjectRef = (value, { refreshOnly = false } = {}) => {
    active();
    const ref = normalizeRef(value);
    if (!ref || !refExists(ref)) return false;
    const handler = selectHandlers?.[ref.domain === 'territorial' && ref.type === countryType ? 'country' : ref.domain];
    if (typeof handler !== 'function') return false;
    withSelectionGuard(() => handler(ref.id, refreshOnly));
    return true;
  };
  const createPacket = options => selectionPacketFactory?.({
    revision,
    styleRevision,
    style: cloneValue(style),
    ...(options || {}),
    country: options?.country || {},
    generic: options?.generic || {},
  }) || Object.freeze({ revision, country: {}, generic: {} });
  const getSelectedObjects = () => cloneValue(controller?.items?.() || []);
  const dispose = () => { disposed = true; hover = null; };
  return Object.freeze({
    snapshot,
    select,
    toggle,
    clear,
    setHover,
    updateStyle,
    selectObjectRef,
    createPacket,
    getSelectedObjects,
    dispose,
    getSpatialIndex: () => spatialIndex,
  });
}
