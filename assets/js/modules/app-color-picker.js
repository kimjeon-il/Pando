import { createCustomColorControl } from './custom-color-control.js';

/** ColorPicker: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createColorPicker() {
  let dependencies;
  const customControls = new WeakMap();

  function connect(ports) {
    if (dependencies) throw new Error('color-picker already connected');
    dependencies = ports;
  }

  function normalizeEditorColor(value, fallback) {
    return (0, dependencies.colorServices.normalizeColorValue)(value, fallback);
  }

  function syncColorPicker(kind, { value, defaultColor, isDefault }) {
    const picker = document.querySelector(`[data-color-picker="${kind}"]`);
    if (!picker) return;
    const fallback = kind === 'country' ? (0, dependencies.colorModel.defaultCountryColor)()
      : (kind === 'subunit') && (dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)
        ? (0, dependencies.colorModel.territorialUnitColor)((0, dependencies.objectPresentation.territorialUnitById)(dependencies.projectState.state.selected.id))
        : dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR;
    const resolvedDefault = normalizeEditorColor(defaultColor, fallback);
    const resolvedValue = normalizeEditorColor(value, resolvedDefault);
    const input = picker.querySelector('.ui-native-color-input');
    const triggerPreview = picker.querySelector('.ui-color-trigger .ui-color-preview');
    const valueLabel = picker.querySelector('.ui-color-value');
    const defaultButton = picker.querySelector('[data-color-default]');
    const defaultPreview = defaultButton?.querySelector('.ui-color-preview');
    if (input) input.value = resolvedValue;
    triggerPreview?.style.setProperty('--swatch-color', resolvedValue);
    defaultPreview?.style.setProperty('--swatch-color', resolvedDefault);
    if (valueLabel) valueLabel.textContent = isDefault ? (kind === 'subunit' ? '국가색 상속' : '기본 색상') : resolvedValue.toUpperCase();
    defaultButton?.setAttribute('aria-pressed', String(!!isDefault));
    picker.querySelectorAll('[data-color-value]').forEach(button => {
      button.setAttribute('aria-pressed', String(!isDefault && button.dataset.colorValue === resolvedValue));
    });
    picker.dataset.colorDefault = resolvedDefault;
    picker.dataset.colorValue = resolvedValue;
    picker.dataset.colorIsDefault = String(!!isDefault);
  }

  function closeColorPicker(picker, { restoreFocus = false } = {}) {
    if (!picker) return;
    const popover = picker.querySelector('.ui-color-popover');
    const trigger = picker.querySelector('.ui-color-trigger');
    if (popover?.classList.contains('hidden')) return;
    customControls.get(picker)?.close();
    popover?.classList.remove('is-custom');
    popover.classList.add('hidden');
    picker.classList.remove('is-open');
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  }

  function closeAllColorPickers(except = null, options = {}) {
    document.querySelectorAll('[data-color-picker]').forEach(picker => {
      if (picker !== except) closeColorPicker(picker, options);
    });
  }

  function alignColorPopoverToViewport(popover) {
    if (!popover || popover.classList.contains('hidden')) return;
    if (window.matchMedia('(max-width: 799px)').matches) return;
    popover.style.removeProperty('--ui-color-popover-shift-x');
    popover.style.removeProperty('--ui-color-popover-shift-y');
    delete popover.dataset.placement;
    const rootStyle = getComputedStyle(document.documentElement);
    const screenEdge = Number.parseFloat(rootStyle.getPropertyValue('--ui-popover-screen-edge')) || 8;
    const pickerBounds = popover.closest('.ui-color-picker')?.getBoundingClientRect();
    let bounds = popover.getBoundingClientRect();
    if (pickerBounds && bounds.bottom > window.innerHeight - screenEdge && pickerBounds.top - screenEdge >= bounds.height) {
      popover.dataset.placement = 'top';
      bounds = popover.getBoundingClientRect();
    }
    let shiftX = 0;
    let shiftY = 0;
    if (bounds.left < screenEdge) shiftX = screenEdge - bounds.left;
    if (bounds.right + shiftX > window.innerWidth - screenEdge) shiftX += (window.innerWidth - screenEdge) - (bounds.right + shiftX);
    if (bounds.top < screenEdge) shiftY = screenEdge - bounds.top;
    if (bounds.bottom + shiftY > window.innerHeight - screenEdge) shiftY += (window.innerHeight - screenEdge) - (bounds.bottom + shiftY);
    if (shiftX) popover.style.setProperty('--ui-color-popover-shift-x', `${shiftX}px`);
    if (shiftY) popover.style.setProperty('--ui-color-popover-shift-y', `${shiftY}px`);
  }

  function openColorPicker(picker) {
    if (!picker) return;
    const popover = picker.querySelector('.ui-color-popover');
    const trigger = picker.querySelector('.ui-color-trigger');
    if (!popover || !trigger) return;
    const opening = popover.classList.contains('hidden');
    closeAllColorPickers(picker);
    popover.classList.toggle('hidden', !opening);
    picker.classList.toggle('is-open', opening);
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) requestAnimationFrame(() => {
      if (!picker.classList.contains('is-open')) return;
      alignColorPopoverToViewport(popover);
      if (!popover.classList.contains('is-custom')) popover.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }

  function openCustomColorPicker(picker) {
    const popover = picker.querySelector('.ui-color-popover');
    const input = picker.querySelector('.ui-native-color-input');
    if (!popover || !input) return;
    if (!picker.classList.contains('is-open')) openColorPicker(picker);
    let control = customControls.get(picker);
    if (!control) {
      control = createCustomColorControl({
        onApply(value) {
          // Preserve the existing object commit and preference preview handlers.
          input.value = value;
          input.dispatchEvent(new window.Event(picker.hasAttribute('data-color-custom-only') ? 'input' : 'change', { bubbles: true }));
          closeColorPicker(picker, { restoreFocus: true });
        },
        onCancel: () => closeColorPicker(picker, { restoreFocus: true }),
      });
      customControls.set(picker, control);
      popover.appendChild(control.element);
    }
    popover.classList.add('is-custom');
    control.open(input.value);
    alignColorPopoverToViewport(popover);
    if (picker.hasAttribute('data-color-custom-only')) control.element.scrollIntoView({ block: 'nearest' });
  }

  function resetCountryColor() {
    if (!(dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
    const id = dependencies.projectState.state.selected.id;
    const idx = dependencies.projectState.state.countryIndex.get(id);
    const feature = idx === undefined ? null : dependencies.projectState.state.countriesData.features[idx];
    const override = { ...(dependencies.projectState.state.countryOverrides[id] || {}) };
    const color = (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.COUNTRY, { feature, override }, { fallback: (0, dependencies.colorModel.defaultCountryColor)() });
    if (color.isDefault) {
      syncColorPicker('country', { value: (0, dependencies.colorModel.defaultCountryColor)(), defaultColor: (0, dependencies.colorModel.defaultCountryColor)(), isDefault: true });
      return true;
    }
    dependencies.domains.projectDomain.recordHistory();
    (0, dependencies.colorModel.writeDomainColor)(dependencies.colorModel.COLOR_DOMAINS.COUNTRY, { feature, override }, '', { clear: true, fallback: (0, dependencies.colorModel.defaultCountryColor)() });
    if (Object.keys(override).length) dependencies.projectState.state.countryOverrides[id] = override;
    else delete dependencies.projectState.state.countryOverrides[id];
    dependencies.rendering.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-color-reset');
    dependencies.domains.renderingDomain?.invalidateBaseScene?.('country-color-reset');
    (0, dependencies.propertyEditingA.applyCountrySelectionIntent)(id, true);
    dependencies.domains.projectDomain.queueAutosave();
    (0, dependencies.feedback.setActionStatus)('국가 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function resetGenericFeatureColor() {
    if (dependencies.projectState.state.selected?.domain !== 'generic') return false;
    const feature = dependencies.projectState.state.genericFeatures.find(item => String(item.id) === String(dependencies.projectState.state.selected.id));
    if (!feature) return false;
    feature.properties ||= {};
    const color = (0, dependencies.colorModel.readDomainColor)(dependencies.colorModel.COLOR_DOMAINS.GENERIC, { feature }, { fallback: (0, dependencies.objectModelA.defaultGenericFeatureColor)(feature) });
    if (color.isDefault) {
      const defaultColor = (0, dependencies.objectModelA.defaultGenericFeatureColor)(feature);
      syncColorPicker('generic', { value: defaultColor, defaultColor, isDefault: true });
      return true;
    }
    dependencies.domains.projectDomain.recordHistory();
    (0, dependencies.colorModel.writeDomainColor)(dependencies.colorModel.COLOR_DOMAINS.GENERIC, { feature }, '', { clear: true, fallback: (0, dependencies.objectModelA.defaultGenericFeatureColor)(feature) });
    dependencies.presentation.genericFeatureLandClipCache.delete(feature);
    (0, dependencies.propertyEditingA.applyGenericSelectionIntent)(String(feature.id), true);
    dependencies.domains.projectDomain.queueAutosave();
    (0, dependencies.feedback.setActionStatus)('기타 객체 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function resetTerritorialUnitColor(kind) {
    if (!(dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
    const feature = (0, dependencies.objectPresentation.territorialUnitById)(dependencies.projectState.state.selected.id);
    if (!feature) return false;
    if (!(0, dependencies.objectModelB.territorialStyleColor)(feature)) {
      const inherited = (0, dependencies.colorModel.territorialUnitColor)(feature);
      syncColorPicker(kind, { value: inherited, defaultColor: inherited, isDefault: true });
      return true;
    }
    (0, dependencies.objectMetadata.commitTerritorialUnitMeta)('color', '');
    return true;
  }

  function applyColorPickerSelection(kind, value, isDefault = false) {
    if (kind === 'multiProperties') {
      const color = normalizeEditorColor(value, '#3f6fae');
      syncColorPicker('multiProperties', { value: color, defaultColor: color, isDefault: false });
      (0, dependencies.objectOperationsA.batchSetColor)(color);
      return true;
    }
    if (isDefault) {
      if (kind === 'country') return resetCountryColor();
      if (kind === 'subunit' || kind === 'region') return resetTerritorialUnitColor(kind);
      return resetGenericFeatureColor();
    }
    const color = normalizeEditorColor(value, kind === 'country' ? (0, dependencies.colorModel.defaultCountryColor)() : dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR);
    if (kind === 'country') {
      if (!(dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
      (0, dependencies.objectMetadata.commitCountryEdit)('color', color);
      return true;
    }
    if (kind === 'subunit' || kind === 'region') {
      if (!(dependencies.projectState.state.selected?.domain === 'territorial' && dependencies.projectState.state.selected.type !== dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
      (0, dependencies.objectMetadata.commitTerritorialUnitMeta)('color', color);
      return true;
    }
    if (kind === 'distribution') {
      if (dependencies.projectState.state.selected?.domain !== 'distribution') return false;
      return (0, dependencies.propertyEditingA.commitDistributionMeta)('color', color);
    }
    if (kind === 'hydro') {
      const feature = dependencies.projectState.state.selected?.domain === 'hydro' ? (0, dependencies.hydroPresentation.hydroEditById)(dependencies.projectState.state.selected.id) : null;
      if (!feature) return false;
      return (0, dependencies.objectMetadata.commitHydroEdit)('editorColor', normalizeEditorColor(value, dependencies.hydroPresentation.HYDRO_TOOL_CONFIG[feature.properties.category].color));
    }
    if (dependencies.projectState.state.selected?.domain !== 'generic') return false;
    (0, dependencies.objectMetadata.commitGenericFeatureMeta)('color', color);
    return true;
  }

  function colorSwatchCheckTone(color) {
    const normalized = normalizeEditorColor(color, '#000000').slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
    const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
    const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
    const luminance = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
    return luminance >= 0.62 ? 'dark' : 'light';
  }

  function createColorSwatch({ color, label, family = '', tone = '' }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-button ui-color-swatch';
    button.dataset.colorValue = color;
    button.dataset.checkTone = colorSwatchCheckTone(color);
    if (family) button.dataset.colorFamily = family;
    if (tone) button.dataset.colorTone = tone;
    button.setAttribute('aria-label', `${label} (${color.toUpperCase()}) 색상`);
    button.setAttribute('aria-pressed', 'false');
    button.style.setProperty('--swatch-color', color);
    return button;
  }

  function paletteColorsByTone() {
    const neutrals = dependencies.platformConfigurationA.COLOR_PALETTE_NEUTRALS;
    const chromatic = dependencies.platformConfigurationA.COLOR_PALETTE_COLORS;
    const hueCount = Math.max(1, new Set(chromatic.map(color => color.family)).size);
    const rowCount = Math.max(neutrals.length, Math.ceil(chromatic.length / hueCount));
    const colors = [];
    for (let row = 0; row < rowCount; row += 1) {
      const tone = chromatic[row * hueCount]?.tone || '가장 어두움';
      if (neutrals[row]) colors.push({ ...neutrals[row], family: '회색', tone });
      colors.push(...chromatic.slice(row * hueCount, (row + 1) * hueCount));
    }
    return colors;
  }

  function appendColorPalette(container, colors) {
    const grid = document.createElement('div');
    grid.className = 'ui-color-swatch-grid ui-color-swatch-grid--palette';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', '색상표');
    colors.forEach(color => grid.appendChild(createColorSwatch(color)));
    container.appendChild(grid);
  }

  function populateColorPalette(container) {
    if (!container || container.children.length) return;
    appendColorPalette(container, paletteColorsByTone());
  }

  function bindColorPickers() {
    document.querySelectorAll('[data-color-picker]').forEach(picker => {
      const kind = picker.dataset.colorPicker;
      const trigger = picker.querySelector('.ui-color-trigger');
      const input = picker.querySelector('.ui-native-color-input');
      const swatches = picker.querySelector('.ui-color-swatches');
      const defaultButton = picker.querySelector('[data-color-default]');
      const customButton = picker.querySelector('[data-color-custom]');
      const customOnly = picker.hasAttribute('data-color-custom-only');
      populateColorPalette(swatches);
      if (!customOnly) trigger?.addEventListener('click', () => openColorPicker(picker));
      defaultButton?.addEventListener('click', () => {
        if (applyColorPickerSelection(kind, '', true)) closeColorPicker(picker, { restoreFocus: true });
      });
      swatches?.addEventListener('click', event => {
        const button = event.target.closest('[data-color-value]');
        if (!button) return;
        if (applyColorPickerSelection(kind, button.dataset.colorValue)) closeColorPicker(picker, { restoreFocus: true });
      });
      customButton?.addEventListener('click', () => {
        if (customOnly && picker.classList.contains('is-open')) closeColorPicker(picker, { restoreFocus: true });
        else openCustomColorPicker(picker);
      });
      if (!customOnly) input?.addEventListener('change', event => {
        applyColorPickerSelection(kind, event.target.value);
        trigger?.focus({ preventScroll: true });
      });
    });
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('.ui-color-popover, .ui-color-trigger')) closeAllColorPickers();
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const openPicker = document.querySelector('[data-color-picker].is-open');
      if (!openPicker) return;
      closeColorPicker(openPicker, { restoreFocus: true });
      event.preventDefault();
    });
    window.addEventListener('resize', () => {
      document.querySelectorAll('[data-color-picker].is-open .ui-color-popover').forEach(alignColorPopoverToViewport);
    });
  }



  return Object.freeze({
    connect,

    get bindColorPickers() { return bindColorPickers; },
    get closeAllColorPickers() { return closeAllColorPickers; },
    get closeColorPicker() { return closeColorPicker; },
    get normalizeEditorColor() { return normalizeEditorColor; },
    get syncColorPicker() { return syncColorPicker; },
  });
}
