/** Remove only temporary outlines covered by this frame's actual GPU result.
 * Empty/absent coverage is not success for an individual object.
 */
export function commitSelectionFallbackCoverage(roots, result) {
  if (!result || result.succeeded === false || result.contextLost) return 0;
  const coverage = new Map(Object.entries(result.channels || {}).map(([channel, value]) =>
    [channel, new Set(value.renderedKeys || [])]));
  let removed = 0;
  for (const root of roots) {
    for (const node of root?.querySelectorAll?.('[data-selection-fallback-key]') || []) {
      if (!coverage.get(node.getAttribute('data-selection-channel'))?.has(node.getAttribute('data-selection-fallback-key'))) continue;
      node.remove();
      removed += 1;
    }
  }
  return removed;
}
