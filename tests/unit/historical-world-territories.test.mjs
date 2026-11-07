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
test('historical production clipping preserves source coordinates and prior verified owner',()=>{
  const rows=[candidate('east',0,6),candidate('west',4,10)];
  const before=JSON.stringify(rows);
  const native=module.adjustHistoricalTerritories(rows,policy);
  const baseline=module.adjustHistoricalTerritories(rows,policy,globalThis.polygonClipping);
  assert.deepEqual(native.candidates,baseline.candidates);
  assert.equal(JSON.stringify(rows),before,'native compilation cannot mutate source geometry');
  assert.equal(module.historicalWorldClipper,globalThis.polygonClipping,
    'historical compilation must use its verified single Boolean owner');
});

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


// Multiple disjoint components have exact set-difference semantics. In
// particular, an unrelated distant island must not enter a mainland sweep.
test('large component differences use disjoint-subject sweeps and preserve repeated overlap semantics',()=>{
  const make=(w,e,s=0,n=4)=>[[[w,s],[e,s],[e,n],[w,n],[w,s]]];
  const subject={entityId:'subject',parentId:'',geometry:{type:'MultiPolygon',
    coordinates:Array.from({length:18},(_,i)=>make(i*10,i*10+7))},
    validFrom:'1950-01-01',validTo:'1952-12-31',currentSnapshot:false};
  const cutter={entityId:'cutter',parentId:'',geometry:{type:'MultiPolygon',
    coordinates:[make(2,4),make(3,6),make(12,16),make(50,51),make(200,210)]},
    validFrom:'1950-01-01',validTo:'1952-12-31',currentSnapshot:false};
  const calls=[];
  const clipper={...globalThis.polygonClipping,
    difference:(...args)=>{calls.push(args.map(operand=>operand.length));return globalThis.polygonClipping.difference(...args);}};
  const rules={...policy,replacements:[{targetEntityId:'subject',priorityEntityId:'cutter',
    validFrom:'1950-01-01',validTo:'1952-12-31'}]};
  const result=module.adjustHistoricalTerritories([subject,cutter],rules,clipper);
  const actual=result.candidates.find(row=>row.entityId==='subject').geometry;
  const baseline=globalThis.polygonClipping.difference(subject.geometry.coordinates,cutter.geometry.coordinates);
  const asMulti=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  assert.deepEqual(globalThis.polygonClipping.xor(asMulti(actual),baseline),[]);
  assert.ok(calls.length>=2,'each intersecting subject polygon is independently clipped');
  assert.ok(calls.every(args=>args.length===2 && args[0]===1),
    'each Boolean sweep has one subject and at most one intersection-union cutter');
});

test('large historical multi-polygon differences partition independent components without changing topology',()=>{
  const boxAt=(left,right,y=0)=>({type:'Polygon',coordinates:[[[left,y],[right,y],[right,y+2],[left,y+2],[left,y]]]});
  const root={entityId:'root',geometry:{type:'MultiPolygon',
    coordinates:Array.from({length:20},(_,i)=>boxAt(i*10,i*10+6).coordinates)},
    parentId:'',validFrom:'1990-01-01',validTo:'1999-12-31',currentSnapshot:false};
  const peer={...candidate('peer',5,12),validFrom:'1990-01-01',validTo:'1999-12-31'};
  const wrap=(geometry)=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  const baseline=globalThis.polygonClipping.difference(wrap(root.geometry),wrap(peer.geometry));
  const operations=[],clipper={
    ...globalThis.polygonClipping,
    difference:(left,right)=>{operations.push([left.length,right.length]);return globalThis.polygonClipping.difference(left,right);},
  };
  const rules={...policy,replacements:[{targetEntityId:'root',priorityEntityId:'peer',validFrom:'1990-01-01',validTo:'1999-12-31'}]};
  const result=module.adjustHistoricalTerritories([root,peer],rules,clipper);
  const rebuilt=result.candidates.find(row=>row.entityId==='root')?.geometry;
  assert.ok(rebuilt,'the untouched components remain');
  const symmetric=globalThis.polygonClipping.xor(wrap(rebuilt),baseline);
  assert.equal(symmetric.length,0,'component subtraction must produce the same exact geographical set');
  assert.ok(operations.every(([left])=>left===1),'a large source is split into independent sweeps');
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

// Source geometry and immutable snapshots are necessary: subtracting the
// intersection fragments first can introduce near-coincident shared edges.
test('unknown peers union only pairwise intersection fragments before bounded subtraction',()=>{
  const rows=[candidate('a',0,12),candidate('b',3,7),candidate('c',6,11)];
  const calls=[],clipper={...globalThis.polygonClipping,
    union:(...operands)=>{calls.push(['union',...operands.map(x=>x.length)]);return globalThis.polygonClipping.union(...operands);},
    difference:(...operands)=>{calls.push(['difference',...operands.map(x=>x.length)]);return globalThis.polygonClipping.difference(...operands);}};
  const before=structuredClone(rows);
  const result=module.adjustHistoricalTerritories(rows,policy,clipper);
  const baseline=globalThis.polygonClipping.difference(rows[0].geometry.coordinates,rows[1].geometry.coordinates,rows[2].geometry.coordinates);
  const shape=result.candidates.find(row=>row.entityId==='a')?.geometry;
  const multi=shape?.type==='Polygon'?[shape.coordinates]:shape?.coordinates||[];
  assert.deepEqual(globalThis.polygonClipping.xor(multi,baseline),[]);
  assert.ok(calls.some(args=>args[0]==='union'&&args.length===3),
    'only the two pairwise overlap fragments need merging for A');
  assert.ok(calls.filter(args=>args[0]==='difference').every(args=>args.length===3),
    'a single bounded difference must use one clipping MultiPolygon');
  assert.deepEqual(rows,before,'clipping must preserve source geometry');
  assert.deepEqual(module.adjustHistoricalTerritories([...rows].reverse(),policy,clipper),result);
});

test('invalid historical Boolean shells fail with bounded ring evidence instead of being silently omitted',()=>{
  const two=[candidate('a',0,6),candidate('b',4,10)];
  const clipper={...globalThis.polygonClipping,
    difference:()=>[[[[0,0],[1,1],[2,2],[3,3],[0,0]]]]};
  assert.throws(()=>module.adjustHistoricalTerritories(two,policy,clipper),error=>{
    assert.match(error.message,/HISTORICAL_CLIP_INVALID/);
    assert.match(error.message,/ringDiagnostic=/);
    assert.match(error.message,/invalidComponentIndex=0/);
    assert.match(error.message,/areaDegreesSquared/);
    assert.match(error.message,/repeatedVertices/);
    assert.match(error.message,/degenerate shell or hole/);
    return true;
  });
});
