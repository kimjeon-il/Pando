import { parseTemporal } from './temporal.js';

export function shiftTimelineMonth(value, delta) {
  const point = parseTemporal(value, { nullable: false });
  if (point.precision !== 'month' || !Number.isInteger(delta)) throw new TypeError('A month and integer offset are required.');
  let year = point.year, month = point.month + delta;
  while (month < 1) { month += 12; year = year === 1 ? -1 : year - 1; }
  while (month > 12) { month -= 12; year = year === -1 ? 1 : year + 1; }
  const signed = year < 0 ? '-' : year > 9999 ? '+' : '';
  return `${signed}${String(Math.abs(year)).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function timelineMonthLabel(value) {
  const point = parseTemporal(value, { nullable: false });
  if (point.precision !== 'month') throw new TypeError('A month is required.');
  return `${point.year < 0 ? `기원전 ${Math.abs(point.year)}` : point.year}년 ${point.month}월`;
}

/** Timeline controls update only the session cursor, never document history. */
export function installTimelineControls({ document, window, getMonth, setMonth }) {
  const input = document.getElementById('timelineMonthInput');
  const button = document.getElementById('timelineMonthButton');
  const buttonText = document.getElementById('timelineMonthButtonText');
  const label = document.getElementById('timelineMonthLabel');
  const context = document.getElementById('editorTimelineContext');
  const error = document.getElementById('timelineMonthError');
  const steps = [
    ['timelinePreviousYear', -12],
    ['timelinePreviousMonth', -1],
    ['timelineNextMonth', 1],
    ['timelineNextYear', 12],
  ].map(([id, delta]) => [document.getElementById(id), delta]);
  if ([input, button, buttonText, label, context, error, ...steps.map(([node]) => node)].some(value => !value)) {
    throw new Error('Timeline controls are missing.');
  }

  let editing = false;
  let composing = false;
  let changeRequest = 0;
  let requestedMonth = null;
  const showError = message => {
    error.textContent = message;
    error.hidden = !message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  };
  const sync = () => {
    const month = getMonth();
    if (!month) return;
    const readable = timelineMonthLabel(month);
    label.textContent = readable;
    buttonText.textContent = readable;
    button.setAttribute('aria-label', `${readable}, 시점 직접 입력`);
    context.textContent = `${readable} 기준 편집`;
    if (!editing) input.value = month;
  };
  const exitEdit = (focusButton = false) => {
    if (!editing) return;
    editing = false;
    composing = false;
    input.hidden = true;
    button.hidden = false;
    input.value = getMonth() || '';
    showError('');
    if (focusButton) button.focus({ preventScroll: true });
  };
  const beginEdit = () => {
    if (editing || !getMonth()) return;
    input.value = getMonth();
    showError('');
    editing = true;
    button.hidden = true;
    input.hidden = false;
    input.focus({ preventScroll: true });
    input.select();
  };
  const change = async requested => {
    const request = ++changeRequest;
    try {
      const point = parseTemporal(requested, { nullable: false });
      if (point.precision !== 'month') throw new TypeError('YYYY-MM 형식으로 입력하세요.');
      requestedMonth = point.canonical;
      await setMonth(point.canonical);
      if (request !== changeRequest) return false;
      requestedMonth = null;
      showError('');
      sync();
      return true;
    } catch (reason) {
      if (request !== changeRequest) return false;
      requestedMonth = null;
      showError(String(reason?.message || reason));
      sync();
      return false;
    }
  };
  const acceptEdit = async () => {
    if (!editing || composing) return;
    if (await change(input.value.trim())) {
      exitEdit(true);
      sync();
    }
  };
  const onKeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      exitEdit(true);
    } else if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229) {
      event.preventDefault();
      acceptEdit().catch(reason => showError(String(reason?.message || reason)));
    }
  };
  // Some mobile input methods send an insertLineBreak action instead of a keydown.
  const onBeforeInput = event => {
    if (event.inputType !== 'insertLineBreak' || composing || !editing) return;
    if (event.cancelable) event.preventDefault();
    acceptEdit().catch(reason => showError(String(reason?.message || reason)));
  };
  const onBlur = () => exitEdit(false);
  const onInput = () => showError('');
  const onCompositionStart = () => { composing = true; };
  const onCompositionEnd = () => { composing = false; };
  const onButtonClick = () => beginEdit();
  const onStep = delta => () => {
    exitEdit(false);
    if (getMonth()) change(shiftTimelineMonth(requestedMonth || getMonth(), delta))
      .catch(reason => showError(String(reason?.message || reason)));
  };
  const stepHandlers = steps.map(([node, delta]) => {
    const handler = onStep(delta);
    node.addEventListener('click', handler);
    return [node, handler];
  });
  button.addEventListener('click', onButtonClick);
  input.addEventListener('keydown', onKeydown);
  input.addEventListener('beforeinput', onBeforeInput);
  input.addEventListener('blur', onBlur);
  input.addEventListener('input', onInput);
  input.addEventListener('compositionstart', onCompositionStart);
  input.addEventListener('compositionend', onCompositionEnd);
  window.addEventListener('pandolab:project-changed', sync);
  sync();
  return () => {
    changeRequest += 1;
    exitEdit(false);
    button.removeEventListener('click', onButtonClick);
    input.removeEventListener('keydown', onKeydown);
    input.removeEventListener('beforeinput', onBeforeInput);
    input.removeEventListener('blur', onBlur);
    input.removeEventListener('input', onInput);
    input.removeEventListener('compositionstart', onCompositionStart);
    input.removeEventListener('compositionend', onCompositionEnd);
    for (const [node, handler] of stepHandlers) node.removeEventListener('click', handler);
    window.removeEventListener('pandolab:project-changed', sync);
  };
}
