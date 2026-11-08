import {compactNotificationMessage} from './notification-copy.js';
export function createNotificationPresentation(ports){
  const getElement=(...args)=>ports.getElement(...args),isMobile=()=>ports.isMobile();
  let errorHoldUntil=0;
  let notificationTimer=null, disposed=false;
  function clearNotification() {
    errorHoldUntil=0;
    clearTimeout(notificationTimer);
    notificationTimer=null;
    const notice = getElement('actionStatus');
    if (!notice) return;
    notice.classList.add('hidden');
    notice.classList.remove('working', 'success', 'error', 'info', 'warning');
    notice.classList.add('ready');
    notice.setAttribute('role', 'status');
    ports.document.body.classList.remove('notification-visible');
  }

  function clearErrorNotification() {
    if (getElement('actionStatus')?.classList.contains('error')) clearNotification();
  }

  function setActionStatus(message, tone = 'success', timeout = 1800, { forceVisible = false } = {}) {
    if(disposed)return;
    const notice = getElement('actionStatus');
    if (!notice) return;
    // Background readiness/success must not immediately erase a user's file
    // failure. The viewer opts in; editor behavior remains unchanged.
    if (ports.protectErrorNotices===true && tone!=='error'
      && !forceVisible && Date.now()<errorHoldUntil) return;
    const fullMessage = String(message ?? '').replace(/\s+/g, ' ').trim();
    const isTopLevelNotice = ['working', 'success', 'error', 'info', 'warning'].includes(tone)
      || forceVisible;
    clearTimeout(notificationTimer);
    notificationTimer=null;
    if (!fullMessage || !isTopLevelNotice) {
      clearNotification();
      return;
    }
    const visibleMessage = tone === 'error'
      ? compactNotificationMessage(fullMessage, {
        tone,
        maxLength: isMobile() ? 28 : 44,
      })
      : isMobile()
        ? compactNotificationMessage(fullMessage, { tone, maxLength: 22 })
        : fullMessage;
    notice.classList.remove('hidden');
    notice.classList.remove('ready', 'working', 'success', 'error', 'info', 'warning');
    notice.classList.add(tone);
    errorHoldUntil=tone==='error' ? (timeout>0?Date.now()+timeout:Infinity) : 0;
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    notice.setAttribute('aria-label', fullMessage);
    if (visibleMessage !== fullMessage) notice.dataset.tooltip = fullMessage;
    else delete notice.dataset.tooltip;
    const strong = notice.querySelector('strong');
    if (strong) strong.textContent = visibleMessage;
    ports.document.body.classList.add('notification-visible');
    if (tone === 'error' || timeout <= 0) return;
    notificationTimer=setTimeout(clearNotification, timeout);
  }

  function isSafeKoreanErrorMessage(error) {
    const message = String(error?.message || '');
    if (!/[가-힣]/.test(message)) return false;
    return !/(Cannot read|undefined|null is not|is not a function|TypeError|ReferenceError|SyntaxError|RangeError|failed\b|\bat\s+\S+\s*\()/i.test(message);
  }

  function reportOperationError(error, fallbackMessage, code, timeout = 4400) {
    console.error(`[${code}]`, error);
    const detail = isSafeKoreanErrorMessage(error) ? String(error.message).trim() : '';
    const fallbackSummary = String(fallbackMessage || '').split(/(?<=[.!?])\s+/u)[0];
    const message = detail
      ? `${detail} · ${code}`
      : `${fallbackSummary} · ${code}`;
    setActionStatus(message, 'error', timeout);
    return message;
  }

  return Object.freeze({clearNotification,clearErrorNotification,setActionStatus,isSafeKoreanErrorMessage,reportOperationError,
    dispose(){if(disposed)return;disposed=true;clearNotification();}});
}
