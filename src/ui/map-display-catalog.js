/** Canonical display groups shared by editor and viewer. Storage keys are not UI labels. */
export const MAP_DISPLAY_TARGETS = Object.freeze({
  objects: { presentationGroup: 'objects', label: '객체', color: true, boundary: true, boundaryLabel: '경계' },
  distributions: { presentationGroup: 'distributions', label: '분포', blendMode: true },
  rivers: { presentationGroup: 'rivers', label: '강' },
  lakes: { presentationGroup: 'lakes', label: '호수' },
  genericFeatures: { presentationGroup: 'genericFeatures', label: '기타 객체' },
  labels: { presentationGroup: 'labels', label: '도시' },
});
