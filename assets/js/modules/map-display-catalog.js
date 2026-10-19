/** Canonical display groups shared by editor and viewer. Storage keys are not UI labels. */
export const MAP_DISPLAY_TARGETS = Object.freeze({
  countries: { presentationGroup: 'countries', label: '상위 객체', color: true, opacity: true, boundary: true, boundaryLabel: '경계' },
  subunits: { presentationGroup: 'subunits', label: '하위 객체', color: true, opacity: true, boundary: true, boundaryLabel: '경계' },
  regions: { presentationGroup: 'regions', label: '지방', color: true, opacity: true, boundary: true, boundaryLabel: '경계' },
  distributions: { presentationGroup: 'distributions', label: '분포', opacity: true, blendMode: true },
  rivers: { presentationGroup: 'rivers', label: '강', opacity: true },
  lakes: { presentationGroup: 'lakes', label: '호수', opacity: true },
  genericFeatures: { presentationGroup: 'genericFeatures', label: '기타 객체', opacity: true, opacityLabel: '전체 투명도' },
  labels: { presentationGroup: 'labels', label: '지명' },
});
