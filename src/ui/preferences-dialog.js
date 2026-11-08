import { defaultUserPreferences, saveUserPreferences } from "./user-preferences.js";
import { setDialogReturnFocus } from "./dialog-accessibility-controller.js";

/** Shared appearance dialog; the host owns current preferences and repainting. */
export function createPreferencesDialog({ document, productMode, getPreferences, applyPreferences, beforeOpen = () => {}, returnFocus = null }) {
  if (productMode !== 'viewer') throw new TypeError('Preference dialog requires viewer product mode.');
  const get = id => document.getElementById(id);
  const modal = get('preferencesModal');
  let origin = null, trigger = null, disposed = false;
  const subscriptions = [];
  const listen = (node, type, handler) => {
    node.addEventListener(type, handler);
    subscriptions.push(() => node.removeEventListener(type, handler));
  };
  const sync = () => {
    const { appearance } = getPreferences();
    get('preferencesThemeInput').value = appearance.theme;
    for (const button of modal.querySelectorAll('[data-preference-theme]'))
      button.setAttribute('aria-pressed', String(button.dataset.preferenceTheme === appearance.theme));
    for (const button of modal.querySelectorAll('[data-preference-accent]'))
      button.setAttribute('aria-pressed', String(button.dataset.preferenceAccent === appearance.accentPreset));
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
  listen(get('preferencesBtn'), 'click', event => {
    beforeOpen(); trigger = event.currentTarget;
    setDialogReturnFocus(modal, () => returnFocus?.() || trigger);
    origin = { ...getPreferences().appearance }; sync();
    modal.classList.remove('hidden');
    modal.querySelector(`[data-preference-theme="${origin.theme}"]`).focus({ preventScroll: true });
  });
  listen(get('preferencesCancelBtn'), 'click', () => close({ revert: true }));
  listen(modal.querySelector('.ui-dialog-backdrop'), 'click', () => close({ revert: true }));
  listen(get('preferencesApplyBtn'), 'click', () => close());
  listen(get('preferencesResetBtn'), 'click', () => preview(defaultUserPreferences().appearance));
  for (const button of modal.querySelectorAll('[data-preference-theme]'))
    listen(button, 'click', () => preview({ ...getPreferences().appearance, theme: button.dataset.preferenceTheme }));
  for (const button of modal.querySelectorAll('[data-preference-accent]'))
    listen(button, 'click', () => preview({ ...getPreferences().appearance, accentPreset: button.dataset.preferenceAccent }));
  for (const [id, key] of [['preferencesSmoothLinesInput','smoothLines']])
    listen(get(id), 'change', () => preview({ ...getPreferences().appearance, [key]: get(id).checked }));
  listen(modal, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close({ revert: true }); }
  });
  return Object.freeze({ close, dispose() {
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    origin = null;
    trigger = null;
    modal.classList.add('hidden');
  } });
}
