import { parseTemporal, shiftTemporalMonth } from './temporal.js';

export function shiftTimelineMonth(value, delta) {
  return shiftTemporalMonth(value, delta);
}

export function timelineMonthLabel(value) {
  const point = parseTemporal(value, { nullable: false });
  if (point.precision !== 'month') throw new TypeError('A month is required.');
  return `${point.year < 0 ? `기원전 ${Math.abs(point.year)}` : point.year}년 ${point.month}월`;
}

/** Owns transient date input; the session cursor and Core own committed time. */
export function installTimelineControls({ document, window, getMonth, setMonth }) {
  const get = id => document.getElementById(id);
  const root = get('timelineControls'), popover = get('timelinePopover'), form = get('timelineDateForm');
  const year = get('timelineYearInput'), month = get('timelineMonthInput'), go = get('timelineGoBtn');
  const button = get('timelineMonthButton'), text = get('timelineMonthButtonText'), error = get('timelineMonthError');
  const steps = [['timelinePreviousYear', -12], ['timelinePreviousMonth', -1],
    ['timelineNextMonth', 1], ['timelineNextYear', 12]].map(([id, delta]) => [get(id), delta]);
  if ([root, popover, form, year, month, go, button, text, error, ...steps.map(([node]) => node)].some(node => !node))
    throw new Error('Timeline controls are missing.');
  let editing = false, composing = false, submitting = false, disposed = false;
  let changeRequest = 0, editSession = 0, requestedMonth = null;
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
  };
  const sync = () => {
    if (!getMonth()) return;
    const readable = timelineMonthLabel(getMonth());
    text.textContent = readable;
    button.setAttribute('aria-label', `${readable}, 시점 직접 입력`);
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
  const change = async requested => {
    const request = ++changeRequest, session = editSession;
    try {
      const point = parseTemporal(requested, { nullable: false });
      if (point.precision !== 'month') throw new TypeError('연도와 월을 확인하세요.');
      requestedMonth = point.canonical;
      await setMonth(point.canonical);
      if (disposed || request !== changeRequest) return false;
      requestedMonth = null;
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
  const acceptEdit = async () => {
    if (!editing || composing || submitting || disposed) return;
    const yearText = year.value.trim(), monthText = month.value.trim();
    if (!/^[+-]?\d+$/.test(yearText) || !/^\d{1,2}$/.test(monthText) || !Number.isSafeInteger(Number(yearText))) {
      showError('연도와 월을 확인하세요.'); return;
    }
    const value = Number(yearText);
    const canonicalYear = `${value < 0 ? '-' : value > 9999 ? '+' : ''}${String(Math.abs(value)).padStart(4, '0')}`;
    const session = editSession;
    submitting = true; go.disabled = true;
    try {
      if (await change(`${canonicalYear}-${monthText.padStart(2, '0')}`)) {
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
  const stepHandlers = steps.map(([node, delta]) => {
    const handler = () => {
      exitEdit(false);
      if (getMonth()) change(shiftTimelineMonth(requestedMonth || getMonth(), delta))
        .catch(reason => showError(String(reason?.message || reason)));
    };
    node.addEventListener('click', handler); return [node, handler];
  });
  const bindings = [[button, 'click', onButtonClick], [form, 'submit', submit], [root, 'keydown', onKeydown],
    [form, 'keydown', onFormKeydown], [form, 'beforeinput', onBeforeInput], [root, 'focusout', onFocusOut],
    [form, 'input', onInput], [form, 'change', onInput], [form, 'compositionstart', onCompositionStart],
    [form, 'compositionend', onCompositionEnd], [document, 'pointerdown', onOutside],
    [window, 'pandolab:project-changed', sync]];
  for (const [node, event, handler] of bindings) node.addEventListener(event, handler);
  popover.hidden = true; button.setAttribute('aria-expanded', 'false'); sync();
  return () => {
    changeRequest++; disposed = true; exitEdit(false);
    for (const [node, event, handler] of [...bindings, ...stepHandlers.map(([node, handler]) => [node, 'click', handler])])
      node.removeEventListener(event, handler);
  };
}
