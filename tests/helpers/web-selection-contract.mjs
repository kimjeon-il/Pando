import { loadWebOracle } from './web-oracle.mjs';
const { createSelectionDomain } = await loadWebOracle('assets/js/modules/selection-domain.js');

export function captureWebSelectionContract() {
  let generation = 1;
  const knownIds = new Set(['A','B','G','L','builtin:place:fixture:1','builtin-hydro']);
  const domain = createSelectionDomain({ projectDomain: { getGeneration: () => generation }, refExists: ref => knownIds.has(ref.id) });
  const ref = (objectDomain, type, id) => ({ domain: objectDomain, type, id });
  const A = ref('territorial','entity','A'), B = ref('territorial','entity','B'), G = ref('generic','feature','G');
  const capital = ref('label','capital','L'), city = ref('label','city','L');
  const place = ref('label','city','builtin:place:fixture:1'), hydro = ref('hydro','river','builtin-hydro');
  const rows = [];
  const capture = (operation, perform) => {
    perform(); rows.push({ operation, snapshot: structuredClone(domain.snapshot()), stats: domain.stats() });
  };
  capture('initial', () => {});
  capture('replace A with anchor', () => domain.replace(A, { scope: 'countries' }));
  capture('same replace is a no-op', () => domain.replace(A, { scope: 'countries' }));
  capture('toggle B makes B primary', () => domain.toggle(B, { scope: 'countries' }));
  capture('remove primary selects last remaining', () => domain.remove(B));
  capture('range retains removed B anchor', () => domain.selectRange(G, [A,B,G], { scope: 'countries' }));
  capture('additive range preserves insertion order', () => domain.selectRange(A, [A,B,G], { scope: 'countries', additive: true }));
  capture('setMany fallback is last input, not last unique insertion', () => domain.setMany([A,B,A]));
  capture('same ID under different label types retains both public keys', () => domain.setMany([capital,city,place,hydro], { primary: capital }));
  capture('prune leaves builtin refs and last remaining primary', () => domain.prune(new Set(domain.snapshot().selection.items.filter(item => item.id !== 'L').map(item => item.key))));
  capture('map hover starts', () => domain.setHover(hydro, { source: 'map' }));
  capture('foreign source cannot clear hover', () => domain.setHover(null, { source: 'layer' }));
  capture('same ref changes hover source without hover revision', () => domain.setHover(hydro, { source: 'layer' }));
  capture('old source cannot clear same hover ref', () => domain.setHover(null, { source: 'map' }));
  capture('wrong expected key cannot clear hover', () => domain.setHover(null, { source: 'layer', expectedKey: 'old-key' }));
  capture('matching source and key clears hover', () => domain.setHover(null, { source: 'layer', expectedKey: domain.snapshot().hover.key }));
  capture('invalid selection and hover are no-ops', () => { domain.replace(ref('territorial','entity','missing')); domain.setHover(ref('label','city','missing')); });
  capture('remove by encoded public key', () => domain.remove(domain.snapshot().selection.items[0].key));
  capture('clear removes selected items and anchors', () => domain.clear());
  capture('empty clear is a no-op', () => domain.clear());
  capture('range after clear uses target only', () => domain.selectRange(B, [A,B,G], { scope: 'countries' }));
  capture('captured label type stays part of selected reference', () => domain.replace(capital));
  // Domain refExists deliberately uses object identity, like current Web labelById.
  // A later kind edit does not rewrite the captured reference held by selection.
  capture('newly selected label kind changes its public key', () => domain.replace(city));
  capture('project reset starts with active hover', () => domain.setHover(place, { source: 'map' }));
  capture('project reset clears selection and hover independently of document undo', () => { generation += 1; domain.resetProject(generation); });
  capture('empty selection anchor quirk starts with scoped toggle', () => domain.toggle(A, { scope: 'empty-reset' }));
  capture('scoped toggle removes the last item but retains its range anchor', () => domain.toggle(A, { scope: 'empty-reset' }));
  capture('empty clear early return retains the old range anchor', () => domain.clear());
  capture('empty resetProject also retains the old range anchor', () => { generation += 1; domain.resetProject(generation); });
  capture('range after empty reset still includes the old anchor', () => domain.selectRange(B, [A,B], { scope: 'empty-reset' }));
  domain.dispose();
  return rows;
}
