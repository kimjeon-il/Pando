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
