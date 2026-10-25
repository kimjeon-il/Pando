import test from 'node:test';
import assert from 'node:assert/strict';
import "../../shared/frontend/js/vendor/polygon-clipping.min.js";
const module = await import('../../tools/historical-world-territories.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const box = (left, right) => ({ type: 'Polygon', coordinates: [[[left, 0], [right, 0], [right, 2], [left, 2], [left, 0]]] });
const candidate = (entityId, left, right, parentId = '') => ({ entityId, parentId, geometry: box(left, right), validFrom: '1991-09-02', validTo: '1991-12-25', currentSnapshot: false });
const policy = { schemaVersion: 1, unknownPeerOverlap: 'exclude-from-all', replacements: [] };
function adjust(rows, rules = policy, clipper = globalThis.polygonClipping) {
  assert.equal(typeof module.adjustHistoricalTerritories, 'function');
  return module.adjustHistoricalTerritories(rows, rules, clipper);
}
function owns(result, id, x) {
  const row = result.candidates.find(item => item.entityId === id);
  if (!row) return false;
  return globalThis.polygonClipping.intersection(row.geometry.type === 'Polygon' ? [row.geometry.coordinates] : row.geometry.coordinates, [box(x - .01, x + .01).coordinates]).length > 0;
}
test('explicitReplacementClipsParentAndDescendants', () => {
  const rows = [candidate('soviet', 0, 10), candidate('child', 0, 10, 'soviet'), candidate('ukraine', 5, 10)];
  const rules = { ...policy, replacements: [{ targetEntityId: 'soviet', priorityEntityId: 'ukraine', validFrom: '1991-08-24', validTo: '2014-03-17' }] };
  const result = adjust(rows, rules);
  assert.equal(owns(result, 'soviet', 7), false);
  assert.equal(owns(result, 'child', 7), false);
  assert.equal(owns(result, 'child', 2), true);
  assert.equal(owns(result, 'ukraine', 7), true);
  assert.deepEqual(adjust([...rows].reverse(), rules), result);
});
test('unknownPeerOverlapBecomesGap', () => {
  const rows = [candidate('east', 0, 6), candidate('west', 4, 10)];
  const result = adjust(rows);
  assert.equal(owns(result, 'east', 5), false); assert.equal(owns(result, 'west', 5), false);
  assert.equal(owns(result, 'east', 2), true); assert.equal(owns(result, 'west', 8), true);
  assert.deepEqual(adjust([...rows].reverse()), result);
});
test('sharedBoundaryDoesNotRemoveLand', () => {
  const rows = [candidate('left', 0, 5), candidate('right', 5, 10)];
  const result = adjust(rows);
  assert.deepEqual(result.candidates, rows); assert.deepEqual(result.adjustments, []);
});
test('emptyResultIsDifferentFromClippingFailure', () => {
  assert.equal(adjust([candidate('a', 0, 5), candidate('b', 0, 5)]).candidates.length, 0);
  assert.throws(() => adjust([candidate('a', 0, 5), candidate('b', 0, 5)], policy, {
    ...globalThis.polygonClipping, intersection() { throw new Error('clipping failure'); },
  }), /clipping failure/);
});
test('currentSnapshotRetainsExplicitOverseasGeometry', () => {
  const rows = [candidate('overseas', 10, 12, 'parent'), candidate('parent', 0, 5)].map(row => ({ ...row, currentSnapshot: true }));
  assert.deepEqual(adjust(rows).candidates, rows);
});

test('one compilation reuses exact Boolean results across date cuts without freezing dates or changed geometry',()=>{
 assert.equal(typeof module.createHistoricalTerritoryCache,'function');
 let calls=0;
 const clipper=Object.fromEntries(['intersection','difference','union'].map(name=>[name,(...args)=>{calls++;return globalThis.polygonClipping[name](...args);} ]));
 const cache=module.createHistoricalTerritoryCache(clipper),rows=[candidate('east',0,6),candidate('west',4,10)];
 const first=module.adjustHistoricalTerritories(rows,policy,clipper,cache),initialCalls=calls;
 const later=rows.map(row=>({...row,validFrom:'2000-01-01',validTo:'2001-12-31'}));
 const reused=module.adjustHistoricalTerritories(later,policy,clipper,cache);
 assert.equal(calls,initialCalls,'the same geometry operations are evaluated once');
 assert.deepEqual(reused,module.adjustHistoricalTerritories(later,policy));
 assert.equal(reused.candidates[0].validFrom,'2000-01-01');
 assert.deepEqual(reused.adjustments,first.adjustments);
 const edited=[{...later[0],geometry:box(0,3)},later[1]];
 assert.deepEqual(module.adjustHistoricalTerritories(edited,policy,clipper,cache),module.adjustHistoricalTerritories(edited,policy));
 assert.ok(calls>initialCalls,'a different geometry must calculate its own result');
});

test('reused Boolean results replay precision evidence and retain each interval discard budget',()=>{
 const artifact=[[46.798053,39.097382],[46.803617228283514,39.10088708625098],
  [46.80361722811995,39.10088708614795],[46.798053,39.097382]];
 const clipper={...globalThis.polygonClipping,intersection:(...args)=>[...globalThis.polygonClipping.intersection(...args),[artifact]]};
 const cache=module.createHistoricalTerritoryCache(clipper),rows=[candidate('east',0,6),candidate('west',4,10)];
 const first=module.adjustHistoricalTerritories(rows,policy,clipper,cache);
 assert.ok(first.adjustments.some(row=>row.kind==='certified-clipping-precision-artifact'));
 assert.deepEqual(module.adjustHistoricalTerritories(rows,policy,clipper,cache),first);
 const many=Array.from({length:6},(_,index)=>candidate(`source${index}`,index*10,index*10+2));
 const budget=module.createHistoricalTerritoryCache(clipper);
 for(let run=0;run<2;run++)assert.throws(()=>module.adjustHistoricalTerritories(many,policy,clipper,budget),/HISTORICAL_CLIP_PRECISION_BUDGET_EXCEEDED/);
});
