export const EDITOR_MAP_INPUT_RESERVED_SELECTOR = 'button,input,select,textarea,a,[contenteditable="true"],.editor-drawer,.project-bounds-picker';

export function createEditorMapPreparationPresenter(getElement) {
  if (typeof getElement !== 'function') throw new TypeError('Editor map presentation requires an element resolver.');
  return (presentation, { retry }) => {
    const label = getElement('mapPreparationStatus');
    const retryButton = getElement('mapPreparationRetry');
    if (label) {
      if (label.textContent !== presentation.label) label.textContent = presentation.label;
      label.hidden = presentation.status === 'ready';
    }
    if (retryButton) {
      retryButton.hidden = !presentation.retry;
      retryButton.onclick = retry;
    }
  };
}
