export function territorialSelectionStatus(view, area = '') {
  return [view.statusName || view.displayName, area].filter(Boolean).join(' · ');
}
