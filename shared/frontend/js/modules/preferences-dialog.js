import { defaultUserPreferences, saveUserPreferences } from './user-preferences.js';
import { setDialogReturnFocus } from './dialog-accessibility-controller.js';

/** Shared appearance dialog; the host owns current preferences and repainting. */
export function createPreferencesDialog({ document, productMode, getPreferences, applyPreferences, beforeOpen = () => {}, returnFocus = null }) {
  if (!['viewer', 'editor'].includes(productMode)) throw new TypeError('Preference product mode is required.');
  const get = id => document.getElementById(id);
  const modal = get('preferencesModal');
  let origin = null, trigger = null;
  const sync = () => {
    const { appearance } = getPreferences();
    get('preferencesThemeInput').value = appearance.theme;
    for (const button of modal.querySelectorAll('[data-preference-theme]'))
      button.setAttribute('aria-pressed', String(button.dataset.preferenceTheme === appearance.theme));
    for (const button of modal.querySelectorAll('[data-preference-accent]'))
      button.setAttribute('aria-pressed', String(button.dataset.preferenceAccent === appearance.accentPreset));
    if (productMode === 'editor') get('preferencesStatusBarVisibleInput').checked = appearance.statusBarVisible;
    get('preferencesSmoothLinesInput').checked = appearance.smoothLines;
  };
  const preview = appearance => { applyPreferences({ ...getPreferences(), appearance }); sync(); };
  const close = ({ revert = false } = {}) => {
    if (origin === null) return;
    if (revert) preview(origin);
    else applyPreferences(saveUserPreferences(getPreferences()));
    origin = null;
    modal.classList.add('hidden');
  };
  get('preferencesBtn').addEventListener('click', event => {
    beforeOpen(); trigger = event.currentTarget;
    setDialogReturnFocus(modal, () => returnFocus?.() || trigger);
    origin = { ...getPreferences().appearance }; sync();
    modal.classList.remove('hidden');
    modal.querySelector(`[data-preference-theme="${origin.theme}"]`).focus({ preventScroll: true });
  });
  get('preferencesCancelBtn').addEventListener('click', () => close({ revert: true }));
  modal.querySelector('.ui-dialog-backdrop').addEventListener('click', () => close({ revert: true }));
  get('preferencesApplyBtn').addEventListener('click', () => close());
  get('preferencesResetBtn').addEventListener('click', () => preview(defaultUserPreferences().appearance));
  for (const button of modal.querySelectorAll('[data-preference-theme]'))
    button.addEventListener('click', () => preview({ ...getPreferences().appearance, theme: button.dataset.preferenceTheme }));
  for (const button of modal.querySelectorAll('[data-preference-accent]'))
    button.addEventListener('click', () => preview({ ...getPreferences().appearance, accentPreset: button.dataset.preferenceAccent }));
  for (const [id, key] of [...(productMode === 'editor' ? [['preferencesStatusBarVisibleInput','statusBarVisible']] : []),['preferencesSmoothLinesInput','smoothLines']])
    get(id).addEventListener('change', () => preview({ ...getPreferences().appearance, [key]: get(id).checked }));
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close({ revert: true }); }
  });
  return Object.freeze({ close });
}
