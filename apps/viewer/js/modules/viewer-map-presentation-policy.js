export const VIEWER_MAP_INPUT_RESERVED_SELECTOR = 'button,input,select,textarea,a,[contenteditable="true"]';

export function createViewerMapPreparationPresenter(getElement) {
  if (typeof getElement !== 'function') throw new TypeError('Viewer map presentation requires an element resolver.');
  return (presentation, { retry }) => {
    const label = getElement('mapPreparationStatus');
    const retryButton = getElement('mapPreparationRetry');
    const notice = getElement('mapPreparationNotice');
    const text = presentation.label.replace('현재 화면 ', '').replace('준비 실패', '불러오기 실패');
    if (label) {
      if (label.textContent !== text) label.textContent = text;
      label.hidden = presentation.status === 'ready';
    }
    if (notice) notice.hidden = presentation.status !== 'error';
    if (retryButton) {
      retryButton.hidden = !presentation.retry;
      retryButton.onclick = retry;
    }
  };
}
