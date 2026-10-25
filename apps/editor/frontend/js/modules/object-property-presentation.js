const PROPERTY_TYPE_LABELS = Object.freeze({
  entity: '객체',
  distribution: '분포', generic: '기타 객체', label: '지명', hydro: '강·호수', multi: '다중선택',
});

export function presentObjectHeading({document, getElement, type, title = '', typeLabel = ''}) {
  const visibleTypeLabel = typeLabel || (type ? PROPERTY_TYPE_LABELS[type] || type : '');
  getElement('propertyTitle').textContent = type ? String(title || '') : '';
  const label=getElement('propertyTypeLabel');
  label.textContent=visibleTypeLabel;
  label.classList.add('editor-object-type-label');
  document.querySelector('.editor-object-heading').setAttribute('aria-label', type ? `${String(title || '')}, ${visibleTypeLabel}` : '');
}


/** Show every independently verified source on its own river, preserving remaining ODbL notices. */
export function builtinHydroSourceNotes(properties = {}) {
  const relationIds = [...new Set((Array.isArray(properties.osm_relation_ids) ? properties.osm_relation_ids : [])
    .map(id => Number(id)).filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
  const independentUrls = [...new Set((Array.isArray(properties.independent_source_urls)
    ? properties.independent_source_urls : []).filter(url => typeof url === 'string' && /^https:\/\//i.test(url)))];
  const fromOsm = relationIds.length > 0 || /\bOSM\b|OpenStreetMap/i.test(String(properties.source || ''));
  if (!fromOsm && !independentUrls.length) return '';
  return [
    '형상: HydroRIVERS 1.0. 국경 정렬 구간에는 Natural Earth의 공유 경계가 사용됩니다.',
    ...(independentUrls.length ? ['강 명칭·수계 관계 검증 출처 (OSM 대체):', ...independentUrls] : []),
    ...(fromOsm ? [
      '강 명칭·수계 관계 보강: © OpenStreetMap contributors · ODbL 1.0',
      'https://www.openstreetmap.org/copyright',
      ...(relationIds.length ? ['OSM relation: ' + relationIds.map(id => 'https://www.openstreetmap.org/relation/' + id).join(', ')] : []),
    ] : []),
  ].join('\n');
}
