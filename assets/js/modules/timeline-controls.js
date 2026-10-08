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

/** The controls own only presentation; the entity owner changes the session month. */
export function installTimelineControls({ document, window, getMonth, setMonth }) {
  const input = document.getElementById('timelineMonthInput');
  const label = document.getElementById('timelineMonthLabel');
  const context = document.getElementById('editorTimelineContext');
  const error = document.getElementById('timelineMonthError');
  const previous = document.getElementById('timelinePreviousMonth');
  const next = document.getElementById('timelineNextMonth');
  if ([input, label, context, error, previous, next].some(value => !value)) throw new Error('Timeline controls are missing.');
  const sync = () => {
    const month = getMonth();
    if (!month) return;
    input.value = month;
    label.textContent = timelineMonthLabel(month);
    context.textContent = `${timelineMonthLabel(month)} 기준 편집`;
  };
  const change = month => {
    try { setMonth(month); error.hidden = true; error.textContent = ''; }
    catch (reason) { error.textContent = String(reason?.message || reason); error.hidden = false; }
    sync();
  };
  const onInput = () => change(input.value);
  const onPrevious = () => { if (getMonth()) change(shiftTimelineMonth(getMonth(), -1)); };
  const onNext = () => { if (getMonth()) change(shiftTimelineMonth(getMonth(), 1)); };
  input.addEventListener('change', onInput);
  previous.addEventListener('click', onPrevious);
  next.addEventListener('click', onNext);
  window.addEventListener('pandolab:project-changed', sync);
  sync();
  return () => {
    input.removeEventListener('change', onInput);
    previous.removeEventListener('click', onPrevious);
    next.removeEventListener('click', onNext);
    window.removeEventListener('pandolab:project-changed', sync);
  };
}
