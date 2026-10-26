import { parseTemporal, shiftTemporalMonth } from './temporal.js';
import { deviceCurrentMonth } from './builtin-month-clock.js';

export function shiftTimelineMonth(value, delta) {
  return shiftTemporalMonth(value, delta);
}

export function timelineMonthLabel(value) {
  const point = parseTemporal(value, { nullable: false });
  if (point.precision !== 'month') throw new TypeError('A month is required.');
  return `${point.year < 0 ? `기원전 ${Math.abs(point.year)}` : point.year}년 ${point.month}월`;
}

/** Owns transient date input; the session cursor and Core own committed time. */
export function installTimelineControls({ document, window, getMonth, setMonth, now = () => new Date() }) {
  const get = id => document.getElementById(id);
  const root = get('timelineControls'), popover = get('timelinePopover'), form = get('timelineDateForm');
  const year = get('timelineYearInput'), month = get('timelineMonthInput'), go = get('timelineGoBtn');
  const button = get('timelineDateButton'), text = get('timelineDateButtonText'), error = get('timelineDateError');
  const unit = get('timelineViewUnit'), basis = get('timelineDateBasis'), monthFields = get('timelineMonthFields');
  const steps = [['timelinePreviousDecade', -120], ['timelinePreviousYear', -12],
    ['timelineNextYear', 12], ['timelineNextDecade', 120]].map(([id, delta]) => [get(id), delta]);
  const monthSteps = [['timelinePreviousMonth', -1], ['timelineNextMonth', 1]].map(([id, delta]) => [get(id), delta]);
  if ([root, popover, form, year, month, go, button, text, error, unit, basis, monthFields,
    ...steps.map(([node]) => node), ...monthSteps.map(([node]) => node)].some(node => !node))
    throw new Error('Timeline controls are missing.');
  let editing = false, composing = false, submitting = false, disposed = false;
  let viewUnit = 'year';
  let changeRequest = 0, editSession = 0, requestedMonth = null;
  const yearValue = value => `${value < 0 ? '-' : value > 9999 ? '+' : ''}${String(Math.abs(value)).padStart(4, '0')}`;
  const annualMonth = value => {
    const point = parseTemporal(value, { nullable: false });
    const current = parseTemporal(deviceCurrentMonth(now()), { nullable: false });
    return parseTemporal(`${yearValue(point.year)}-${point.year === current.year ? String(current.month).padStart(2, '0') : '12'}`, { nullable: false }).canonical;
  };
  const syncUnitInput = () => {
    monthFields.hidden = unit.value !== 'month';
    month.disabled = monthFields.hidden;
  };
  const showError = message => {
    error.textContent = message;
    error.hidden = !message;
    year.setAttribute('aria-invalid', String(!!message));
    month.setAttribute('aria-invalid', String(!!message));
  };
  const syncInputs = () => {
    if (!getMonth()) return;
    const point = parseTemporal(getMonth(), { nullable: false });
    year.value = String(point.year);
    month.value = String(point.month);
    unit.value = viewUnit;
    syncUnitInput();
  };
  const sync = () => {
    if (!getMonth()) return;
    const point = parseTemporal(getMonth(), { nullable: false });
    const readable = viewUnit === 'month' ? timelineMonthLabel(getMonth())
      : `${point.year < 0 ? `기원전 ${Math.abs(point.year)}` : point.year}년`;
    text.textContent = readable;
    basis.textContent = viewUnit === 'month' ? '월말 기준' : getMonth() === deviceCurrentMonth(now()) ? '현재 월 기준'
      : point.month === 12 ? '연말 기준' : `${point.month}월말 기준`;
    button.setAttribute('aria-label', `${readable}, ${basis.textContent}, 시점 직접 입력`);
    if (!editing) syncInputs();
  };
  const exitEdit = (restoreFocus = false) => {
    if (!editing) return;
    editing = false; composing = false; editSession++;
    popover.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    syncInputs(); showError('');
    if (restoreFocus) button.focus({ preventScroll: true });
  };
  const beginEdit = () => {
    if (editing || !getMonth() || disposed) return;
    syncInputs(); showError(''); editing = true; editSession++;
    popover.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    year.focus({ preventScroll: true }); year.select();
  };
  const change = async (requested, nextUnit) => {
    const request = ++changeRequest, session = editSession;
    try {
      const point = parseTemporal(requested, { nullable: false });
      if (point.precision !== 'month') throw new TypeError('연도와 월을 확인하세요.');
      requestedMonth = point.canonical;
      const accepted = await setMonth(point.canonical);
      if (disposed || request !== changeRequest) return false;
      requestedMonth = null;
      if (accepted === false) { sync(); return false; }
      viewUnit = nextUnit;
      if (session === editSession) showError('');
      sync();
      return true;
    } catch (reason) {
      if (disposed || request !== changeRequest) return false;
      requestedMonth = null;
      if (session === editSession) {
        if (!editing) beginEdit();
        showError(String(reason?.message || reason));
      }
      sync();
      return false;
    }
  };
  const readInput = () => {
    const yearText = year.value.trim(), monthText = month.value.trim();
    if (!/^[+-]?\d+$/.test(yearText) || !Number.isSafeInteger(Number(yearText))) throw new TypeError('연도를 확인하세요.');
    const selectedUnit = unit.value;
    if (!['year', 'month'].includes(selectedUnit)) throw new TypeError('보기 단위를 확인하세요.');
    const canonicalYear = yearValue(Number(yearText));
    if (selectedUnit === 'year') return { value: annualMonth(canonicalYear), unit: selectedUnit };
    if (!/^\d{1,2}$/.test(monthText)) throw new TypeError('월을 확인하세요.');
    return { value: parseTemporal(`${canonicalYear}-${monthText.padStart(2, '0')}`, { nullable: false }).canonical, unit: selectedUnit };
  };
  const acceptEdit = async () => {
    if (!editing || composing || submitting || disposed) return;
    let input;
    try { input = readInput(); } catch (reason) { showError(String(reason.message)); return; }
    const session = editSession;
    submitting = true; go.disabled = true;
    try {
      if (await change(input.value, input.unit)) {
        if (editing && session === editSession) exitEdit(true);
        sync();
      }
    } finally { submitting = false; go.disabled = false; }
  };
  const submit = event => {
    event.preventDefault();
    acceptEdit().catch(reason => showError(String(reason?.message || reason)));
  };
  const onKeydown = event => {
    if (event.key === 'Escape' && editing) {
      event.preventDefault(); event.stopPropagation(); exitEdit(true);
    }
  };
  const onFormKeydown = event => {
    if (event.target !== year && event.target !== go) return;
    if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229) submit(event);
  };
  const onBeforeInput = event => {
    if (event.inputType === 'insertLineBreak' && !composing && editing) submit(event);
  };
  const onOutside = event => { if (editing && !root.contains(event.target)) exitEdit(false); };
  const onFocusOut = event => { if (editing && event.relatedTarget && !root.contains(event.relatedTarget)) exitEdit(false); };
  const onInput = () => showError('');
  const onCompositionStart = () => { composing = true; };
  const onCompositionEnd = () => { composing = false; };
  const onButtonClick = () => { if (editing) exitEdit(false); else beginEdit(); };
  const onUnitChange = () => { syncUnitInput(); showError(''); };
  const stepHandlers = steps.map(([node, delta]) => {
    const handler = () => {
      exitEdit(false);
      try {
        if (!getMonth()) return;
        const shifted = shiftTimelineMonth(requestedMonth || getMonth(), delta);
        change(viewUnit === 'year' ? annualMonth(shifted) : shifted, viewUnit)
          .catch(reason => showError(String(reason?.message || reason)));
      } catch (reason) { beginEdit(); showError(String(reason.message)); }
    };
    node.addEventListener('click', handler); return [node, handler];
  });
  const monthHandlers = monthSteps.map(([node, delta]) => {
    const handler = () => {
      if (!editing || unit.value !== 'month' || composing || disposed) return;
      try {
        const next = shiftTimelineMonth(readInput().value, delta), point = parseTemporal(next, { nullable: false });
        year.value = String(point.year); month.value = String(point.month);
        change(next, 'month').catch(reason => showError(String(reason?.message || reason)));
      } catch (reason) { showError(String(reason.message)); }
    };
    node.addEventListener('click', handler); return [node, handler];
  });
  const bindings = [[button, 'click', onButtonClick], [form, 'submit', submit], [root, 'keydown', onKeydown],
    [form, 'keydown', onFormKeydown], [form, 'beforeinput', onBeforeInput], [root, 'focusout', onFocusOut],
    [form, 'input', onInput], [form, 'change', onInput], [unit, 'change', onUnitChange], [form, 'compositionstart', onCompositionStart],
    [form, 'compositionend', onCompositionEnd], [document, 'pointerdown', onOutside],
    [window, 'pandolab:project-changed', sync]];
  for (const [node, event, handler] of bindings) node.addEventListener(event, handler);
  popover.hidden = true; button.setAttribute('aria-expanded', 'false'); sync();
  return () => {
    changeRequest++; disposed = true; exitEdit(false);
    for (const [node, event, handler] of [...bindings, ...[...stepHandlers, ...monthHandlers].map(([node, handler]) => [node, 'click', handler])])
      node.removeEventListener(event, handler);
  };
}
