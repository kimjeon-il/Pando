const RESULT_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

export function createTerritorialLibraryController({
  document,
  elements,
  service,
  renderMapPreview,
  createEmptyState,
  replaceSelectOptions,
  shouldShowTerritorialParentChoice,
  closeSurface,
  focusSurfaceTrigger,
  instantiate,
  ownershipContext = () => ({ missing: [], countries: [], parents: () => [] }),
  setStatus,
  reportError,
  getProjectGeneration,
  requestFrame = callback => requestAnimationFrame(callback),
}) {
  let selectedId = '';
  let loading = false;
  let requestGeneration = 0;
  let ownershipChoices = null;
  let confirmedImpact = '';
  let flagPicker = null;
  let timePopoverOpen = false;

  function resetOwnership() {
    ownershipChoices = null;
    confirmedImpact = '';
    elements.ownership?.replaceChildren();
    elements.ownership?.classList.add('hidden');
    if (elements.add) elements.add.textContent = '추가';
  }

  function showOwnership(context) {
    const host = elements.ownership;
    if (!host) throw new Error('소속 설정 화면을 찾을 수 없습니다.');
    ownershipChoices = {};
    host.replaceChildren();
    host.classList.remove('hidden');
    const heading = document.createElement('h3');
    heading.textContent = '소속 설정';
    host.append(heading);
    function field(title, control) {
      const label = document.createElement('label');
      label.className = 'ui-field field-group';
      const text = document.createElement('span');
      text.textContent = title;
      label.append(text, control);
      host.append(label);
      return label;
    }
    for (const item of context.missing) {
      const choice = { mode: 'child', countryId: item.countryId, parentId: item.countryId, name: item.name };
      ownershipChoices[item.entityId] = choice;
      const mode = document.createElement('select');
      replaceSelectOptions(mode, [
        { value: 'child', label: '상위 객체 아래에 추가' },
        { value: 'root', label: '최상위 객체로 추가' },
      ], 'child');
      field(`${item.name} · 추가 방식`, mode);
      const country = document.createElement('select');
      const countryChoice = replaceSelectOptions(country, [
        { value: '', label: '소속 국가 선택', placeholder: true },
        ...context.countries,
      ], choice.countryId, { autoSelectSingle: true }) || { single: false, value: country.value };
      choice.countryId = countryChoice.value;
      const countryRow = field('소속 국가', country);
      const parent = document.createElement('select');
      const parentRow = field('상위 객체', parent);
      const name = document.createElement('input');
      name.value = item.name;
      const nameRow = field('객체 이름', name);
      function sync() {
        choice.mode = mode.value;
        choice.name = name.value;
        choice.countryId = country.value;
        const candidates = context.parents(country.value);
        const options = candidates.length
          ? candidates
          : [{ value: '', label: '상위 단위 선택', placeholder: true }];
        const parentChoice = replaceSelectOptions(parent, options, choice.parentId, { autoSelectSingle: true }) || { value: parent.value };
        choice.parentId = parentChoice.value;
        countryRow.hidden = mode.value === 'root' || countryChoice.single;
        parentRow.hidden = mode.value === 'root' || !shouldShowTerritorialParentChoice({
          rootId: choice.countryId,
          parentId: choice.parentId,
          options,
        });
        nameRow.hidden = mode.value !== 'root';
        elements.add.disabled = Object.values(ownershipChoices).some(value => value.mode === 'root' ? !value.name.trim() : !value.countryId);
        confirmedImpact = '';
        host.querySelector('[data-library-impact]')?.remove();
      }
      mode.addEventListener('change', sync);
      name.addEventListener('input', sync);
      country.addEventListener('change', () => { choice.parentId = country.value; sync(); });
      parent.addEventListener('change', () => { choice.parentId = parent.value; sync(); });
      sync();
    }
    host.querySelector('select')?.focus();
  }

  function setLoadingState(nextLoading) {
    loading = !!nextLoading;
    if (loading) setTimePopover(false);
    for (const element of [
      elements.search,
      elements.clearSearch,
      elements.referenceDate,
      elements.timeSuggest,
      elements.childDepth,
      ...(elements.ownership?.querySelectorAll('input, select') || []),
    ]) {
      if (element) element.disabled = loading;
    }
    if (elements.add) elements.add.disabled = true;
    if (elements.results) elements.results.setAttribute('aria-busy', String(loading));
  }

  function renderLoadingResults() {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 6; index += 1) {
      const row = document.createElement('div');
      row.className = 'territorial-library-result-skeleton';
      row.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      const meta = document.createElement('span');
      title.className = 'ui-skeleton-block';
      meta.className = 'ui-skeleton-block';
      row.append(title, meta);
      fragment.appendChild(row);
    }
    elements.results.replaceChildren(fragment);
  }

  function period(entity) {
    const { validFrom, validTo } = entity.lifetime;
    const year = date => date.match(/^[+-]?\d+/)[0];
    if (!validFrom && !validTo) return '기간 미상';
    return `${validFrom ? year(validFrom) : '?'}–${validTo ? year(validTo) : '현재'}`;
  }

  function setTimePopover(open, { restoreFocus = false } = {}) {
    timePopoverOpen = !!open;
    elements.timePopover.hidden = !timePopoverOpen;
    elements.timeSuggest.setAttribute('aria-expanded', String(timePopoverOpen));
    if (restoreFocus) elements.timeSuggest.focus({ preventScroll: true });
  }

  function showTimePopover() {
    if (loading) return;
    if (timePopoverOpen) { setTimePopover(false); return; }
    try {
      const heading = document.createElement('h3');
      heading.className = 'territorial-library-time-heading';
      heading.textContent = '주요 사건';
      const events = service.events({ query: elements.search.value });
      const options = events.map(event => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ui-button territorial-library-time-option';
        const date = document.createElement('time');
        date.textContent = event.date;
        date.setAttribute('datetime', event.date);
        const name = document.createElement('span');
        name.textContent = event.name;
        button.append(date, name);
        button.addEventListener('click', () => {
          elements.referenceDate.value = event.date;
          const refreshed = refreshSelection();
          elements.referenceDate.focus({ preventScroll: true });
          return refreshed;
        });
        return button;
      });
      if (!options.length) {
        const empty = document.createElement('p');
        empty.className = 'editor-help';
        empty.textContent = '등록된 주요 사건이 없습니다.';
        options.push(empty);
      }
      elements.timePopover.replaceChildren(heading, ...options);
      setTimePopover(true);
    } catch (error) {
      setTimePopover(false);
      reportError(error, '등록된 주요 사건을 불러오지 못했습니다.', 'PL-LIB-005', 4800);
    }
  }

  function clearPreview() {
    elements.preview.replaceChildren();
    elements.preview.hidden = true;
    elements.add.disabled = true;
    elements.addOptions?.classList.add('hidden');
    elements.optionsBack?.classList.add('hidden');
  }

  function invalidReferenceDate(error) {
    selectedId = '';
    clearPreview();
    resetOwnership();
    elements.results.replaceChildren(createEmptyState('시점을 확인해 주세요.', '연도, 연·월 또는 연·월·일을 입력하세요.', { compact: true }));
    reportError(error, '검색 조건의 시점을 확인해 주세요.', 'PL-LIB-005', 4800);
  }

  function renderPreview(referenceDate = service.normalizeReferenceDate(elements.referenceDate.value)) {
    const selectedRow = [...elements.results.querySelectorAll('[data-library-entity-id]')].find(row => row.dataset.libraryEntityId === selectedId);
    selectedRow?.insertAdjacentElement?.('afterend', elements.preview);
    const entity = flagPicker ? service.get(selectedId) : service.getLoadedEntity(selectedId);
    if (flagPicker) {
      const flagUrl = String(entity?.metadata?.defaultFlagDataUrl || '').trim();
      if (!entity) {
        elements.preview.hidden = true;
        elements.add.disabled = true;
        return;
      }
      elements.preview.hidden = false;
      const title = document.createElement('h3');
      title.className = 'territorial-library-preview-title';
      title.textContent = entity.names.ko || entity.names.en || Object.values(entity.names)[0];
      const help = document.createElement('p');
      help.className = 'editor-help';
      help.textContent = flagUrl ? '이 항목의 기본 국기를 적용합니다.' : '이 항목에는 기본 국기가 없습니다.';
      elements.preview.replaceChildren(title, help);
      elements.add.disabled = !flagUrl;
      elements.addOptions?.classList.add('hidden');
      elements.optionsBack?.classList.add('hidden');
      elements.card?.classList.remove('is-detail', 'is-options');
      elements.add.textContent = '적용';
      elements.add.setAttribute('aria-label', '선택한 라이브러리 국기 적용');
      elements.add.dataset.tooltip = '선택한 라이브러리 국기 적용';
      return;
    }
    const resolution = selectedId ? service.resolveSelection(selectedId, referenceDate) : null;
    const version = entity && resolution ? entity.geometryVersions.find(candidate => candidate.versionId === resolution.geometryVersionId) : null;
    if (!entity || !version) {
      elements.preview.hidden = !selectedId;
      const help = document.createElement('p');
      help.className = 'editor-help';
      help.textContent = !selectedId ? '항목을 선택하세요.' : !resolution
        ? (referenceDate ? '선택한 시점의 국토 자료가 없습니다.' : '대표 국토 자료를 정할 수 없습니다. 시점을 입력해 주세요.')
        : '국토 자료를 불러오는 중입니다.';
      elements.preview.replaceChildren(help);
      elements.add.disabled = true;
      elements.addOptions?.classList.add('hidden');
      elements.optionsBack?.classList.add('hidden');
      return;
    }
    elements.preview.hidden = false;
    const title = document.createElement('h3');
    title.className = 'territorial-library-preview-title';
    title.textContent = entity.names.ko || entity.names.en || Object.values(entity.names)[0];
    const map = renderMapPreview(entity, version);
    map.dataset.geometryVersionId = version.versionId;
    const source = document.createElement('p');
    source.className = 'editor-help territorial-library-source-date';
    source.textContent = resolution.mode === 'representative' ? `자료 기준 ${resolution.sourceDate}` : '';
    const meta = document.createElement('p');
    meta.className = 'editor-help';
    meta.textContent = [
      version.certainty === 'low' ? '정확도가 낮은 경계' : version.certainty === 'medium' ? '경계 일부 불확실' : '',
      entity.metadata?.approximateGeometry ? '근사 경계' : '',
    ].filter(Boolean).join(' · ');
    const heading = document.createElement('div');
    heading.className = 'territorial-library-preview-heading';
    heading.append(title);
    elements.preview.replaceChildren(heading, map, ...(source.textContent ? [source] : []),
      ...(meta.textContent ? [meta] : []));
    elements.add.disabled = false;
    const hasChildren = service.list().some(candidate => candidate.parentEntityId === entity.entityId);
    if (hasChildren) elements.addOptions?.classList.remove('hidden');
    else {
      elements.addOptions?.classList.add('hidden');
      elements.childDepth.value = 'none';
    }
    elements.optionsBack?.classList.add('hidden');
    elements.add.textContent = '추가';
    elements.add.setAttribute('aria-label', '선택한 항목을 현재 프로젝트에 추가');
    elements.add.dataset.tooltip = '선택한 항목을 현재 프로젝트에 추가';
  }

  function renderResults(referenceDate = service.normalizeReferenceDate(elements.referenceDate.value)) {
    const groups = service.search({ query: elements.search.value, referenceDate }).map(group=>({...group,entities:group.entities.filter(entity=>!flagPicker || String(entity.metadata?.defaultFlagDataUrl || '').trim())})).filter(group=>group.entities.length);
    const results = groups.flatMap(group=>group.entities);
    if (selectedId && !results.some(entity => entity.entityId === selectedId)) {
      selectedId = '';
      resetOwnership();
    }
    const fragment = document.createDocumentFragment();
    for (const entity of results) {
      const button = document.createElement('button');
      const selected = selectedId === entity.entityId;
      button.type = 'button';
      button.className = `ui-button ui-row ui-card ui-selectable-row territorial-library-result${selected ? ' is-selected' : ''}`;
      button.dataset.libraryEntityId = entity.entityId;
      button.setAttribute('aria-expanded', String(selected));
      if (selected) button.setAttribute('aria-controls', elements.preview.id);
      button.tabIndex = selected ? 0 : -1;
      const strong = document.createElement('strong');
      strong.textContent = entity.names.ko || entity.names.en || Object.values(entity.names)[0];
      const small = document.createElement('small');
      small.textContent = period(entity);
      const flagUrl = String(entity.metadata?.defaultFlagDataUrl || '').trim();
      if (flagUrl) {
        const flag = document.createElement('span');
        flag.className = 'territorial-library-result-flag';
        flag.setAttribute('aria-hidden', 'true');
        const image = document.createElement('img');
        image.src = flagUrl;
        image.alt = '';
        flag.appendChild(image);
        button.className += ' territorial-library-result--flagged';
        button.append(flag, strong, small);
      } else button.append(strong, small);
      fragment.appendChild(button);
    }
    if (!results.length) fragment.appendChild(createEmptyState(
      flagPicker ? '국기가 있는 항목이 없습니다.' : '조건에 맞는 항목이 없습니다.',
      referenceDate ? '기록된 존속 기간에서 확인되는 항목이 없습니다. 검색어나 시점을 바꾸거나 시점을 비워 보세요.' : '검색어를 바꿔 보세요.',
      { compact: true },
    ));
    elements.results.replaceChildren(fragment);
    const options = [...elements.results.querySelectorAll('[data-library-entity-id]')];
    if (options.length && !options.some(option => option.tabIndex === 0)) options[0].tabIndex = 0;
    renderPreview(referenceDate);
  }

  // Every edit/reopen establishes a current continuation, even when the loader shares
  // a pending chunk. Retiring the old generation alone would leave a loading preview.
  async function refreshSelection({ generation = ++requestGeneration, restoreFocus = false } = {}) {
    const project = getProjectGeneration();
    resetOwnership();
    setTimePopover(false);
    setLoadingState(false);
    let referenceDate;
    try { referenceDate = service.normalizeReferenceDate(elements.referenceDate.value); }
    catch (error) { invalidReferenceDate(error); return; }
    try {
      renderResults(referenceDate);
      const resolution = selectedId && !flagPicker ? service.resolveSelection(selectedId, referenceDate) : null;
      if (resolution && !service.getLoadedEntity(selectedId)) await service.loadEntity(selectedId);
      if (generation !== requestGeneration || elements.modal.classList.contains('hidden')) return;
      if (project !== getProjectGeneration()) {
        selectedId = '';
        resetOwnership();
        renderResults(referenceDate);
        return;
      }
      renderPreview(referenceDate);
    } catch (error) {
      if (generation !== requestGeneration || elements.modal.classList.contains('hidden')) return;
      if (project !== getProjectGeneration()) {
        selectedId = '';
        resetOwnership();
        renderResults(referenceDate);
        return;
      }
      clearPreview();
      if (selectedId) {
        const help = document.createElement('p');
        help.className = 'editor-help';
        help.textContent = '국토 자료를 불러오지 못했습니다. 항목을 다시 선택해 주세요.';
        elements.preview.replaceChildren(help);
        elements.preview.hidden = false;
      }
      reportError(error, '선택한 경계를 불러오지 못했습니다.', 'PL-LIB-004', 4800);
      return;
    }
    if (restoreFocus) requestFrame(() => {
      if (generation === requestGeneration && project === getProjectGeneration() && !elements.modal.classList.contains('hidden')) {
        elements.results.querySelector('[aria-expanded="true"]')?.focus({ preventScroll: true });
      }
    });
  }

  async function select(id) {
    if (loading) return;
    if (selectedId !== String(id || '')) elements.childDepth.value = 'none';
    selectedId = String(id || '');
    return refreshSelection({ restoreFocus: !!document.activeElement?.hasAttribute?.('data-library-entity-id') });
  }

  function close() {
    requestGeneration += 1;
    resetOwnership();
    setTimePopover(false);
    setLoadingState(false);
    clearPreview();
    elements.modal.classList.add('hidden');
    elements.card?.classList.remove('is-detail', 'is-options');
    const restoreFocus = flagPicker?.restoreFocus;
    flagPicker = null;
    if (restoreFocus?.focus) restoreFocus.focus({ preventScroll: true });
    else focusSurfaceTrigger('create');
  }

  async function open({ onPickFlag = null, restoreFocus = null } = {}) {
    const generation = ++requestGeneration;
    const project = getProjectGeneration();
    flagPicker = typeof onPickFlag === 'function' ? { onPickFlag, restoreFocus } : null;
    closeSurface('create');
    elements.modal.classList.remove('hidden');
    resetOwnership();
    clearPreview();
    setLoadingState(true);
    renderLoadingResults();
    try {
      await service.load();
      if (generation !== requestGeneration) return;
      if (project !== getProjectGeneration()) {
        selectedId = '';
        setLoadingState(false);
        elements.results.replaceChildren();
        return;
      }
      await refreshSelection({ generation });
      if (generation === requestGeneration && project === getProjectGeneration() && !elements.modal.classList.contains('hidden')) elements.search.focus();
    } catch (error) {
      if (generation !== requestGeneration || project !== getProjectGeneration()) return;
      loading = false;
      elements.results.setAttribute('aria-busy', 'false');
      elements.results.replaceChildren(createEmptyState('라이브러리를 불러오지 못했습니다.', '잠시 후 다시 시도해 주세요.', { compact: true }));
      reportError(error, '국가·지역 라이브러리를 불러오지 못했습니다.', 'PL-LIB-001', 4800);
    }
  }

  async function addSelected() {
    if (loading || !selectedId) return;
    let resolution, referenceDate;
    try {
      referenceDate = service.normalizeReferenceDate(elements.referenceDate.value);
      resolution = service.resolveSelection(selectedId, referenceDate);
    }
    catch (error) { requestGeneration += 1; invalidReferenceDate(error); return; }
    if (!resolution || !service.getLoadedEntity(selectedId)) return;
    const selection = { id: selectedId, resolution, depth: elements.childDepth.value,
      ownership: structuredClone(ownershipChoices || {}), confirmedImpact };
    const generation = ++requestGeneration;
    const project = getProjectGeneration();
    function isCurrent() {
      if (generation !== requestGeneration) return false;
      if (project === getProjectGeneration()) return true;
      selectedId = '';
      resetOwnership();
      setLoadingState(false);
      renderResults(referenceDate);
      return false;
    }
    setLoadingState(true);
    try {
      const context = await ownershipContext([selection.id], selection.resolution.referenceDate, selection.depth);
      if (!isCurrent()) return;
      if (!ownershipChoices && context.missing.length) {
        setLoadingState(false);
        showOwnership(context);
        return;
      }
    } catch (error) {
      if (!isCurrent()) return;
      setLoadingState(false);
      renderPreview();
      reportError(error, '선택한 항목의 소속과 경계 버전을 확인하세요.', 'PL-LIB-002', 4800);
      return;
    }
    setLoadingState(true);
    try {
      const result = await instantiate([selection.id], selection.resolution.referenceDate, selection.depth, {
        ownership: selection.ownership, confirmedImpact: selection.confirmedImpact,
        isCurrent,
      });
      if (!isCurrent()) return;
      if (result?.confirmationRequired) {
        const host = elements.ownership;
        host.classList.remove('hidden');
        host.querySelector('[data-library-impact]')?.remove();
        const impact = document.createElement('div');
        impact.dataset.libraryImpact = '';
        const title = document.createElement('h3');
        title.textContent = '영토 변경 확인';
        const list = document.createElement('ul');
        for (const message of result.impacts) {
          const item = document.createElement('li');
          item.textContent = message;
          list.append(item);
        }
        impact.append(title, list);
        host.append(impact);
        confirmedImpact = result.impactKey;
        setLoadingState(false);
        elements.add.disabled = false;
        elements.add.textContent = '확인 후 추가';
        return;
      }
      const added = Number(result?.added || 0);
      const deleted = Number(result?.deleted || 0);
      if (!added) throw new Error('추가 결과에 새 프로젝트 객체가 없습니다.');
      else if (Number(result?.subtracted || 0)) {
        const deletedText = deleted ? ` 이 중 ${deleted}개는 완전히 대체되어 제거했습니다.` : '';
        setStatus(`라이브러리 항목 ${added}개를 추가하고 기존 국가 ${result.subtracted}개의 겹친 영토를 대체했습니다.${deletedText}`, 'success', 4200);
      } else {
        setStatus(`라이브러리 항목 ${added}개를 독립 프로젝트 인스턴스로 추가했습니다.`, 'success', 4200);
      }
      close();
    } catch (error) {
      if (!isCurrent()) return;
      setLoadingState(false);
      renderPreview();
      reportError(error, '라이브러리 항목을 프로젝트에 추가하지 못했습니다.', 'PL-LIB-002', 4800);
    }
  }

  function applySelectedFlag() {
    const selected = flagPicker;
    const flagUrl = String(service.get(selectedId)?.metadata?.defaultFlagDataUrl || '').trim();
    if (!selected?.onPickFlag || !flagUrl) return;
    close();
    selected.onPickFlag(flagUrl);
  }

  function advanceAdd() {
    if (loading || !selectedId) return;
    if (flagPicker) {
      applySelectedFlag();
      return;
    }
    return addSelected();
  }

  function returnToDetail() {
    elements.addOptions?.classList.add('hidden');
    elements.optionsBack?.classList.add('hidden');
    elements.add.textContent = '추가';
    elements.card?.classList.remove('is-detail', 'is-options');
    const generation = requestGeneration;
    requestFrame(() => {
      if (generation === requestGeneration && !elements.modal.classList.contains('hidden')) elements.results.querySelector('[aria-expanded="true"]')?.focus();
    });
  }

  function connect() {
    elements.childDepth?.addEventListener('change', () => refreshSelection());
    elements.timeSuggest.addEventListener('click', showTimePopover);
    elements.modal.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !timePopoverOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setTimePopover(false, { restoreFocus: true });
    });
    document.addEventListener('click', event => {
      if (timePopoverOpen && !elements.timePopover.contains(event.target) && !elements.timeSuggest.contains(event.target)) setTimePopover(false);
    });
    elements.open?.addEventListener('click', open);
    elements.close?.addEventListener('click', close);
    elements.backdrop?.addEventListener('click', close);
    for (const [element, eventName] of [
      [elements.search, 'input'],
      [elements.referenceDate, 'input'],
    ]) {
      element?.addEventListener(eventName, () => refreshSelection());
    }
    elements.clearSearch?.addEventListener('click', () => {
      elements.search.value = '';
      elements.search.dispatchEvent(new elements.search.ownerDocument.defaultView.Event('input', { bubbles: true }));
      elements.search.focus({ preventScroll: true });
    });
    elements.results?.addEventListener('click', event => {
      const button = event.target.closest('[data-library-entity-id]');
      if (button) select(button.dataset.libraryEntityId);
    });
    elements.results?.addEventListener('keydown', event => {
      if (!RESULT_KEYS.has(event.key) || !event.target.closest('[data-library-entity-id]')) return;
      const options = [...elements.results.querySelectorAll('[data-library-entity-id]')];
      if (!options.length) return;
      const current = event.target.closest('[data-library-entity-id]');
      const currentIndex = Math.max(0, options.indexOf(current));
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? options.length - 1
          : event.key === 'ArrowDown' ? Math.min(options.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
      const next = options[nextIndex];
      if (!next) return;
      event.preventDefault();
      options.forEach(option => { option.tabIndex = option === next ? 0 : -1; });
      next.focus();
    });
    elements.add?.addEventListener('click', advanceAdd);
    elements.optionsBack?.addEventListener('click', returnToDetail);
  }

  return Object.freeze({ close, connect, isOpen: () => !elements.modal.classList.contains('hidden'), open, renderPreview, renderResults, select });
}
