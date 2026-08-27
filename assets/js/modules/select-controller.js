const DEFAULT_SEARCH_THRESHOLD = 12;
const DEFAULT_RENDER_LIMIT = 240;

export function normalizeSelectQuery(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ko')
    .replace(/\s+/g, ' ');
}

function optionMatchRank(option, query) {
  if (!query) return 0;
  const label = normalizeSelectQuery(option.label);
  const value = normalizeSelectQuery(option.value);
  const searchText = normalizeSelectQuery(option.searchText);
  if (label === query || value === query) return 0;
  if (label.startsWith(query) || value.startsWith(query)) return 1;
  if (searchText.split(' ').some(part => part.startsWith(query))) return 2;
  if (label.includes(query) || value.includes(query) || searchText.includes(query)) return 3;
  return Number.POSITIVE_INFINITY;
}

export function filterSelectOptions(options, query, collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })) {
  const normalizedQuery = normalizeSelectQuery(query);
  if (!normalizedQuery) return [...options];
  return options
    .map((option, index) => ({ option, index, rank: optionMatchRank(option, normalizedQuery) }))
    .filter(entry => Number.isFinite(entry.rank))
    .sort((left, right) => left.rank - right.rank
      || collator.compare(String(left.option.label || ''), String(right.option.label || ''))
      || left.index - right.index)
    .map(entry => entry.option);
}

function associatedLabelText(select, documentRef) {
  const explicit = select.id ? documentRef.querySelector(`label[for="${select.id}"]`) : null;
  const label = explicit || select.closest('label');
  const heading = label?.querySelector(':scope > span, :scope > label');
  return String(heading?.textContent || label?.textContent || select.getAttribute('aria-label') || select.name || select.id || '선택').trim();
}

function createSvgIcon(documentRef, symbolId, className = 'ui-icon') {
  const icon = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', className);
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const use = documentRef.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${symbolId}`);
  icon.appendChild(use);
  return icon;
}

export function createSelectController({
  document: documentRef = globalThis.document,
  window: windowRef = globalThis.window,
  searchThreshold = DEFAULT_SEARCH_THRESHOLD,
  renderLimit = DEFAULT_RENDER_LIMIT,
} = {}) {
  if (!documentRef || !windowRef) throw new Error('드롭다운 컨트롤러에 document와 window가 필요합니다.');

  const components = new Map();
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  const nativeValueDescriptor = Object.getOwnPropertyDescriptor(windowRef.HTMLSelectElement.prototype, 'value');
  let activeComponent = null;
  let documentObserver = null;
  let componentSequence = 0;
  let positionFrame = 0;

  function nativeSelectValue(select) {
    return nativeValueDescriptor?.get ? nativeValueDescriptor.get.call(select) : select.value;
  }

  function setNativeSelectValue(select, value) {
    if (nativeValueDescriptor?.set) nativeValueDescriptor.set.call(select, String(value ?? ''));
  }

  function optionData(select) {
    return [...select.options].map((option, index) => ({
      index,
      value: String(option.value),
      label: String(option.label || option.textContent || option.value),
      searchText: `${option.dataset.searchText || ''} ${option.value}`,
      disabled: !!option.disabled,
      selected: !!option.selected,
    }));
  }

  function selectedOption(component) {
    const selectedValue = nativeSelectValue(component.select);
    return component.options.find(option => option.value === selectedValue) || component.options.find(option => option.selected) || null;
  }

  function selectedLabel(component) {
    return selectedOption(component)?.label || '';
  }

  function schedulePosition(component = activeComponent) {
    if (!component?.open || positionFrame) return;
    positionFrame = windowRef.requestAnimationFrame(() => {
      positionFrame = 0;
      positionPopover(component);
    });
  }

  function positionPopover(component) {
    if (!component.open || component.popover.hidden || !component.control.isConnected) return;
    const rect = component.control.getBoundingClientRect();
    const viewport = windowRef.visualViewport;
    const viewportWidth = viewport?.width || windowRef.innerWidth;
    const viewportHeight = viewport?.height || windowRef.innerHeight;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const rootStyle = windowRef.getComputedStyle(documentRef.documentElement);
    const readMetric = (name, fallback) => {
      const value = Number.parseFloat(rootStyle.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const margin = readMetric('--ui-popover-screen-edge', 8);
    const gap = readMetric('--ui-select-popover-gap', 6);
    const width = Math.min(Math.max(rect.width, 180), Math.max(180, viewportWidth - margin * 2));
    const below = viewportTop + viewportHeight - rect.bottom - margin - gap;
    const above = rect.top - viewportTop - margin - gap;
    const openAbove = below < 180 && above > below;
    const available = Math.max(120, openAbove ? above : below);
    const listHeight = Math.min(320, available);
    const left = Math.min(
      Math.max(rect.left, viewportLeft + margin),
      viewportLeft + viewportWidth - width - margin,
    );
    component.popover.style.width = `${width}px`;
    component.popover.style.left = `${left}px`;
    component.popover.style.setProperty('--ui-select-list-max-height', `${listHeight}px`);
    component.popover.classList.toggle('opens-above', openAbove);
    if (openAbove) {
      component.popover.style.top = 'auto';
      component.popover.style.bottom = `${windowRef.innerHeight - rect.top + gap}px`;
    } else {
      component.popover.style.top = `${rect.bottom + gap}px`;
      component.popover.style.bottom = 'auto';
    }
  }

  function visibleOptions(component) {
    const matches = filterSelectOptions(component.options, component.query, collator);
    if (matches.length <= renderLimit) return { options: matches, limited: false, total: matches.length };
    const selected = selectedOption(component);
    const visible = matches.slice(0, renderLimit);
    if (selected && !visible.some(option => option.index === selected.index)) visible[visible.length - 1] = selected;
    return { options: visible, limited: true, total: matches.length };
  }

  function setActiveOption(component, index, { scroll = true } = {}) {
    if (!component.renderedOptions.length) {
      component.activeIndex = -1;
      component.control.removeAttribute('aria-activedescendant');
      return;
    }
    const count = component.renderedOptions.length;
    component.activeIndex = ((index % count) + count) % count;
    const rows = [...component.listbox.querySelectorAll('.ui-select-option')];
    rows.forEach((row, rowIndex) => row.classList.toggle('is-active', rowIndex === component.activeIndex));
    const activeRow = rows[component.activeIndex];
    if (!activeRow) return;
    component.control.setAttribute('aria-activedescendant', activeRow.id);
    if (scroll) activeRow.scrollIntoView({ block: 'nearest' });
  }

  function renderOptions(component) {
    const { options, limited, total } = visibleOptions(component);
    component.renderedOptions = options;
    const selected = selectedOption(component);
    const fragment = documentRef.createDocumentFragment();
    for (const [rowIndex, option] of options.entries()) {
      const row = documentRef.createElement('div');
      row.id = `${component.listbox.id}-option-${option.index}`;
      row.className = 'ui-select-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.value === selected?.value));
      if (option.disabled) row.setAttribute('aria-disabled', 'true');
      row.dataset.optionIndex = String(option.index);
      const label = documentRef.createElement('span');
      label.className = 'ui-select-option-label';
      label.textContent = option.label;
      row.append(label);
      if (option.value === selected?.value) {
        row.classList.add('is-selected');
        row.append(createSvgIcon(documentRef, 'icon-check', 'ui-icon ui-select-check'));
      }
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('click', () => {
        if (!option.disabled) commitOption(component, option);
      });
      row.addEventListener('pointermove', () => setActiveOption(component, rowIndex, { scroll: false }));
      fragment.appendChild(row);
    }
    if (!options.length) {
      const empty = documentRef.createElement('p');
      empty.className = 'ui-select-empty';
      empty.textContent = '일치하는 항목이 없습니다.';
      fragment.appendChild(empty);
    } else if (limited) {
      const status = documentRef.createElement('p');
      status.className = 'ui-select-status';
      status.textContent = `${total.toLocaleString()}개 중 ${options.length.toLocaleString()}개 표시 · 검색어를 더 입력하세요.`;
      fragment.appendChild(status);
    }
    component.listbox.replaceChildren(fragment);
    const selectedIndex = options.findIndex(option => option.value === selected?.value);
    setActiveOption(component, selectedIndex >= 0 ? selectedIndex : 0, { scroll: false });
    windowRef.requestAnimationFrame(() => {
      const active = component.listbox.querySelector('.ui-select-option.is-active');
      active?.scrollIntoView({ block: 'nearest' });
    });
  }

  function scheduleQueryRender(component) {
    if (!component.open || !component.searchable || component.queryFrame) return;
    component.queryFrame = windowRef.requestAnimationFrame(() => {
      component.queryFrame = 0;
      if (!component.open || !component.searchable) return;
      const nextQuery = component.control.value;
      if (nextQuery === component.query) return;
      component.query = nextQuery;
      renderOptions(component);
      schedulePosition(component);
    });
  }

  function close(component, { restoreFocus = false } = {}) {
    if (!component?.open) return;
    if (component.queryFrame) windowRef.cancelAnimationFrame(component.queryFrame);
    component.queryFrame = 0;
    component.open = false;
    component.query = '';
    component.popover.hidden = true;
    component.shell.classList.remove('is-open');
    component.control.setAttribute('aria-expanded', 'false');
    component.control.removeAttribute('aria-activedescendant');
    component.control.value = selectedLabel(component);
    if (activeComponent === component) activeComponent = null;
    if (restoreFocus) component.control.focus({ preventScroll: true });
  }

  function closeActive(options) {
    if (activeComponent) close(activeComponent, options);
  }

  function open(component, { selectText = false, clearText = false } = {}) {
    if (component.control.disabled || component.open) return;
    closeActive();
    component.open = true;
    component.query = '';
    component.shell.classList.add('is-open');
    component.popover.hidden = false;
    component.control.setAttribute('aria-expanded', 'true');
    component.control.value = clearText && component.searchable ? '' : selectedLabel(component);
    activeComponent = component;
    renderOptions(component);
    positionPopover(component);
    if (selectText && component.searchable) component.control.select();
  }

  function commitOption(component, option) {
    const changed = nativeSelectValue(component.select) !== option.value;
    setNativeSelectValue(component.select, option.value);
    sync(component.select);
    close(component, { restoreFocus: true });
    if (!changed) return;
    component.select.dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    component.select.dispatchEvent(new windowRef.Event('change', { bubbles: true }));
  }

  function moveActive(component, delta) {
    if (!component.open) open(component);
    const start = component.activeIndex < 0 ? 0 : component.activeIndex;
    let next = start;
    for (let count = 0; count < component.renderedOptions.length; count += 1) {
      next = (next + delta + component.renderedOptions.length) % component.renderedOptions.length;
      if (!component.renderedOptions[next]?.disabled) break;
    }
    setActiveOption(component, next);
  }

  function handleKeydown(component, event) {
    const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!component.open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        open(component);
        moveActive(component, event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Enter' || (event.key === ' ' && !component.searchable)) {
        event.preventDefault();
        event.stopPropagation();
        open(component, { selectText: component.searchable });
        return;
      }
      if (printable && component.searchable) {
        open(component);
        component.control.value = '';
        component.query = '';
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      moveActive(component, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      setActiveOption(component, event.key === 'Home' ? 0 : component.renderedOptions.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const option = component.renderedOptions[component.activeIndex];
      if (option && !option.disabled) commitOption(component, option);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(component, { restoreFocus: true });
      return;
    }
    if (event.key === 'Tab') close(component);
  }

  function sync(select) {
    const component = components.get(select);
    if (!component) return;
    component.options = optionData(select);
    component.searchable = select.hasAttribute('data-searchable-select') || component.options.length > searchThreshold;
    component.control.readOnly = !component.searchable;
    component.control.disabled = !!select.disabled || !component.options.length;
    component.control.setAttribute('aria-autocomplete', component.searchable ? 'list' : 'none');
    component.shell.classList.toggle('is-searchable', component.searchable);
    component.shell.classList.toggle('is-disabled', component.control.disabled);
    if (component.control.disabled) close(component);
    if (!component.open) component.control.value = selectedLabel(component);
    else renderOptions(component);
  }

  function enhance(select) {
    if (!select || components.has(select) || select.multiple || Number(select.size || 0) > 1 || select.hasAttribute('data-native-select')) return components.get(select) || null;
    componentSequence += 1;
    const componentId = select.id || `uiSelect${componentSequence}`;
    const label = associatedLabelText(select, documentRef);
    const shell = documentRef.createElement('div');
    shell.className = 'ui-select-shell';
    const control = documentRef.createElement('input');
    control.id = `${componentId}Control`;
    control.className = 'ui-select-control';
    control.type = 'text';
    control.autocomplete = 'off';
    control.spellcheck = false;
    control.setAttribute('role', 'combobox');
    control.setAttribute('aria-haspopup', 'listbox');
    control.setAttribute('aria-expanded', 'false');
    control.setAttribute('aria-label', label);
    const listbox = documentRef.createElement('div');
    listbox.id = `${componentId}Listbox`;
    listbox.className = 'ui-select-listbox';
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', `${label} 목록`);
    control.setAttribute('aria-controls', listbox.id);
    const toggle = documentRef.createElement('span');
    toggle.className = 'ui-select-toggle';
    toggle.setAttribute('aria-hidden', 'true');
    toggle.append(createSvgIcon(documentRef, 'icon-chevron-down'));
    const popover = documentRef.createElement('div');
    popover.className = 'ui-select-popover';
    popover.hidden = true;
    popover.append(listbox);

    select.before(shell);
    shell.append(control, toggle, select);
    documentRef.body.append(popover);
    select.classList.add('ui-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const component = {
      select,
      shell,
      control,
      toggle,
      popover,
      listbox,
      options: [],
      renderedOptions: [],
      activeIndex: -1,
      query: '',
      queryFrame: 0,
      searchable: false,
      open: false,
      activationPointerType: '',
      observer: null,
    };
    components.set(select, component);

    if (nativeValueDescriptor?.get && nativeValueDescriptor?.set && !Object.hasOwn(select, 'value')) {
      Object.defineProperty(select, 'value', {
        configurable: true,
        enumerable: nativeValueDescriptor.enumerable,
        get() { return nativeValueDescriptor.get.call(this); },
        set(value) {
          nativeValueDescriptor.set.call(this, String(value ?? ''));
          windowRef.queueMicrotask(() => sync(this));
        },
      });
    }

    control.addEventListener('pointerdown', event => {
      component.activationPointerType = String(event.pointerType || '');
    });
    control.addEventListener('pointercancel', () => {
      component.activationPointerType = '';
    });
    control.addEventListener('click', event => {
      const pointerType = String(event.pointerType || component.activationPointerType || '');
      const directTouch = pointerType === 'touch' || pointerType === 'pen';
      component.activationPointerType = '';
      if (component.open && !component.searchable) close(component);
      else open(component, {
        selectText: component.searchable && !directTouch,
        clearText: component.searchable && directTouch,
      });
    });
    control.addEventListener('keydown', event => handleKeydown(component, event));
    control.addEventListener('input', () => scheduleQueryRender(component));
    control.addEventListener('compositionupdate', () => scheduleQueryRender(component));
    control.addEventListener('compositionend', () => scheduleQueryRender(component));
    select.addEventListener('input', () => sync(select));
    select.addEventListener('change', () => sync(select));
    select.addEventListener('focus', () => control.focus({ preventScroll: true }));
    component.observer = new windowRef.MutationObserver(() => windowRef.queueMicrotask(() => sync(select)));
    component.observer.observe(select, { attributes: true, childList: true, characterData: true, subtree: true });
    sync(select);
    return component;
  }

  function enhanceAll(root = documentRef) {
    root.querySelectorAll?.('select').forEach(enhance);
    if (!documentObserver) {
      documentObserver = new windowRef.MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof windowRef.Element)) continue;
            if (node.matches('select')) enhance(node);
            node.querySelectorAll?.('select').forEach(enhance);
          }
        }
      });
      documentObserver.observe(documentRef.body, { childList: true, subtree: true });
    }
    return components.size;
  }

  documentRef.addEventListener('pointerdown', event => {
    if (!activeComponent) return;
    if (activeComponent.shell.contains(event.target) || activeComponent.popover.contains(event.target)) return;
    closeActive();
  }, true);
  documentRef.addEventListener('reset', () => windowRef.queueMicrotask(() => components.forEach((_, select) => sync(select))), true);
  windowRef.addEventListener('resize', () => schedulePosition());
  windowRef.visualViewport?.addEventListener('resize', () => schedulePosition());
  windowRef.visualViewport?.addEventListener('scroll', () => schedulePosition());
  documentRef.addEventListener('scroll', event => {
    if (activeComponent?.popover.contains(event.target)) return;
    schedulePosition();
  }, true);

  return Object.freeze({
    enhance,
    enhanceAll,
    sync,
    closeAll: closeActive,
    get size() { return components.size; },
  });
}
