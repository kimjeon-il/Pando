/** ColorPicker: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createColorPicker() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('color-picker already connected');
    dependencies = ports;
  }

  function normalizeEditorColor(value, fallback) {
    return (0, dependencies.normalizeColorValue)(value, fallback);
  }

  function syncColorPicker(kind, { value, defaultColor, isDefault }) {
    const picker = document.querySelector(`[data-color-picker="${kind}"]`);
    if (!picker) return;
    const fallback = kind === 'country' ? (0, dependencies.defaultCountryColor)()
      : (kind === 'subunit') && (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)
        ? (0, dependencies.territorialUnitColor)((0, dependencies.territorialUnitById)(dependencies.state.selected.id))
        : dependencies.DEFAULT_GENERIC_FEATURE_COLOR;
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
      alignColorPopoverToViewport(popover);
      popover.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }

  function resetCountryColor() {
    if (!(dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
    const id = dependencies.state.selected.id;
    const idx = dependencies.state.countryIndex.get(id);
    const feature = idx === undefined ? null : dependencies.state.countriesData.features[idx];
    const override = { ...(dependencies.state.countryOverrides[id] || {}) };
    const color = (0, dependencies.readDomainColor)(dependencies.COLOR_DOMAINS.COUNTRY, { feature, override }, { fallback: (0, dependencies.defaultCountryColor)() });
    if (color.isDefault) {
      syncColorPicker('country', { value: (0, dependencies.defaultCountryColor)(), defaultColor: (0, dependencies.defaultCountryColor)(), isDefault: true });
      return true;
    }
    dependencies.projectDomain.recordHistory();
    (0, dependencies.writeDomainColor)(dependencies.COLOR_DOMAINS.COUNTRY, { feature, override }, '', { clear: true, fallback: (0, dependencies.defaultCountryColor)() });
    if (Object.keys(override).length) dependencies.state.countryOverrides[id] = override;
    else delete dependencies.state.countryOverrides[id];
    dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'country-color-reset');
    dependencies.renderingDomain?.invalidateBaseScene?.('country-color-reset');
    (0, dependencies.applyCountrySelectionIntent)(id, true);
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)('국가 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function resetGenericFeatureColor() {
    if (dependencies.state.selected?.domain !== 'generic') return false;
    const feature = dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.selected.id));
    if (!feature) return false;
    feature.properties ||= {};
    const color = (0, dependencies.readDomainColor)(dependencies.COLOR_DOMAINS.GENERIC, { feature }, { fallback: (0, dependencies.defaultGenericFeatureColor)(feature) });
    if (color.isDefault) {
      const defaultColor = (0, dependencies.defaultGenericFeatureColor)(feature);
      syncColorPicker('generic', { value: defaultColor, defaultColor, isDefault: true });
      return true;
    }
    dependencies.projectDomain.recordHistory();
    (0, dependencies.writeDomainColor)(dependencies.COLOR_DOMAINS.GENERIC, { feature }, '', { clear: true, fallback: (0, dependencies.defaultGenericFeatureColor)(feature) });
    dependencies.genericFeatureLandClipCache.delete(feature);
    (0, dependencies.applyGenericSelectionIntent)(String(feature.id), true);
    dependencies.projectDomain.queueAutosave();
    (0, dependencies.setActionStatus)('기타 객체 색상을 기본값으로 되돌렸습니다.', 'success');
    return true;
  }

  function resetTerritorialUnitColor(kind) {
    if (!(dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
    const feature = (0, dependencies.territorialUnitById)(dependencies.state.selected.id);
    if (!feature) return false;
    if (!(0, dependencies.territorialStyleColor)(feature)) {
      const inherited = (0, dependencies.territorialUnitColor)(feature);
      syncColorPicker(kind, { value: inherited, defaultColor: inherited, isDefault: true });
      return true;
    }
    (0, dependencies.commitTerritorialUnitMeta)('color', '');
    return true;
  }

  function applyColorPickerSelection(kind, value, isDefault = false) {
    if (kind === 'multiProperties') {
      const color = normalizeEditorColor(value, '#3f6fae');
      syncColorPicker('multiProperties', { value: color, defaultColor: color, isDefault: false });
      (0, dependencies.batchSetColor)(color);
      return true;
    }
    if (isDefault) {
      if (kind === 'country') return resetCountryColor();
      if (kind === 'subunit' || kind === 'region') return resetTerritorialUnitColor(kind);
      return resetGenericFeatureColor();
    }
    const color = normalizeEditorColor(value, kind === 'country' ? (0, dependencies.defaultCountryColor)() : dependencies.DEFAULT_GENERIC_FEATURE_COLOR);
    if (kind === 'country') {
      if (!(dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
      (0, dependencies.commitCountryEdit)('color', color);
      return true;
    }
    if (kind === 'subunit' || kind === 'region') {
      if (!(dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type !== dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY)) return false;
      (0, dependencies.commitTerritorialUnitMeta)('color', color);
      return true;
    }
    if (kind === 'distribution') {
      if (dependencies.state.selected?.domain !== 'distribution') return false;
      return (0, dependencies.commitDistributionMeta)('color', color);
    }
    if (kind === 'hydro') {
      const feature = dependencies.state.selected?.domain === 'hydro' ? (0, dependencies.hydroEditById)(dependencies.state.selected.id) : null;
      if (!feature) return false;
      return (0, dependencies.commitHydroEdit)('editorColor', normalizeEditorColor(value, dependencies.HYDRO_TOOL_CONFIG[feature.properties.category].color));
    }
    if (dependencies.state.selected?.domain !== 'generic') return false;
    (0, dependencies.commitGenericFeatureMeta)('color', color);
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
    const neutrals = dependencies.COLOR_PALETTE_NEUTRALS;
    const chromatic = dependencies.COLOR_PALETTE_COLORS;
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
      populateColorPalette(swatches);
      trigger?.addEventListener('click', () => openColorPicker(picker));
      defaultButton?.addEventListener('click', () => {
        if (applyColorPickerSelection(kind, '', true)) closeColorPicker(picker, { restoreFocus: true });
      });
      swatches?.addEventListener('click', event => {
        const button = event.target.closest('[data-color-value]');
        if (!button) return;
        if (applyColorPickerSelection(kind, button.dataset.colorValue)) closeColorPicker(picker, { restoreFocus: true });
      });
      customButton?.addEventListener('click', () => {
        closeColorPicker(picker);
        input?.click();
      });
      input?.addEventListener('change', event => {
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
