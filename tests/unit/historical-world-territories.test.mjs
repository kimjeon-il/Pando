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

// Inject only the observed native ring error. All geometry operations and
// expected set relationships still use the actual native Core.
function subtractionWitnessFixture({external=null,precision=false,error='Unable to complete output ring',witness='native'}={}){
 const rows=[candidate('parent',0,10),candidate('cutter',4,12)];
 if(external)rows.push(candidate('external',...external));
 const rules={...policy,replacements:[{targetEntityId:'parent',priorityEntityId:'cutter',validFrom:'1991-01-01',validTo:'1992-01-01'}]};
 const range=value=>{const xs=value.flat(2).map(point=>point[0]);return [Math.min(...xs),Math.max(...xs)];};
 const has=(operands,bounds)=>operands.some(value=>JSON.stringify(range(value))===JSON.stringify(bounds));
 const calls={failures:0,witnesses:0,differences:0};
 const artifact=[[46.798053,39.097382],[46.803617228283514,39.10088708625098],[46.80361722811995,39.10088708614795],[46.798053,39.097382]];
 const clipper={...module.historicalWorldClipper,
  difference:(...args)=>{
   calls.differences++;
   const result=module.historicalWorldClipper.difference(...args);
   return precision?[...result,[artifact]]:result;
  },
  intersection:(...args)=>{
   if(has(args,[0,4])&&has(args,external||[4,12])){calls.failures++;throw typeof error==='string'?new Error(error):error;}
   if(external&&has(args,[0,10])&&has(args,external)){
    calls.witnesses++;
    if(witness==='throws')throw new Error('ancestor witness failed');
    if(witness==='artifact')return [[artifact]];
    if(witness==='malformed')return {length:0};
    if(witness==='empty-string')return '';
   }
   return module.historicalWorldClipper.intersection(...args);
  },
 };
 return {rows,rules,clipper,calls};
}

test('subtraction witness recovers a ring intersection only for the exact prior cutter object',()=>{
 const {rows,rules,clipper,calls}=subtractionWitnessFixture(),before=structuredClone(rows);
 const result=module.adjustHistoricalTerritories(rows,rules,clipper);
 assert.equal(calls.failures,1);
 assert.deepEqual(module.historicalWorldClipper.xor([result.candidates.find(r=>r.entityId==='parent').geometry.coordinates],[box(0,4).coordinates]),[]);
 assert.equal(result.adjustments.filter(r=>r.kind==='certified-clipping-precision-artifact').length,0);
 assert.deepEqual(rows,before);
});

test('subtraction witness requires an actually empty native ancestor intersection',()=>{
 const {rows,rules,clipper,calls}=subtractionWitnessFixture({external:[20,22]});
 const result=module.adjustHistoricalTerritories(rows,rules,clipper);
 assert.equal(calls.failures,1);assert.equal(calls.witnesses,1);
 assert.deepEqual(module.historicalWorldClipper.xor([result.candidates.find(r=>r.entityId==='parent').geometry.coordinates],[box(0,4).coordinates]),[]);
 assert.deepEqual(result.candidates.find(r=>r.entityId==='external').geometry,box(20,22));
});

test('subtraction witness fails closed for overlapping, failed or precision-only ancestor results',()=>{
 for(const options of [{external:[2,3]},{external:[20,22],witness:'throws'},{external:[20,22],witness:'artifact'}]){
  const {rows,rules,clipper,calls}=subtractionWitnessFixture(options);
  assert.throws(()=>module.adjustHistoricalTerritories(rows,rules,clipper),error=>{
   assert.match(error.message,/HISTORICAL_CLIP_BOOLEAN_FAILED: intersection/);
   assert.equal(error.cause.message,'Unable to complete output ring');return true;
  });
  assert.equal(calls.witnesses,1);
 }
});

test('subtraction witness cannot cross a precision-discard difference or recover unrelated errors',()=>{
 for(const options of [{precision:true},{error:'unrelated clipping failure'}]){
  const {rows,rules,clipper}=subtractionWitnessFixture(options);
  assert.throws(()=>module.adjustHistoricalTerritories(rows,rules,clipper),new RegExp(options.error||'Unable to complete output ring'));
 }
});

test('subtraction witness keeps cached positive precision evidence ineligible on later date cuts',()=>{
 const {rows,rules,clipper,calls}=subtractionWitnessFixture({precision:true});
 const cache=module.createHistoricalTerritoryCache(clipper);
 assert.throws(()=>module.adjustHistoricalTerritories(rows,rules,clipper,cache),/Unable to complete output ring/);
 const differences=calls.differences;
 const evidence=[...cache.operations.values()].flatMap(value=>value.precision);
 assert.equal(evidence.length,1);assert.ok(evidence[0].areaM2>0);
 const later=rows.map(r=>({...r,validFrom:'1991-10-01',validTo:'1991-10-31'}));
 assert.throws(()=>module.adjustHistoricalTerritories(later,rules,clipper,cache),/Unable to complete output ring/);
 assert.equal(calls.differences,differences,'this rejection must exercise the cached difference');
 assert.deepEqual([...cache.operations.values()].flatMap(value=>value.precision),evidence);
});

test('subtraction witness does not infer identity from clones, normalization or union outputs',()=>{
 const {rows,rules,clipper}=subtractionWitnessFixture();
 const cache=module.createHistoricalTerritoryCache(clipper);
 const result=module.adjustHistoricalTerritories(rows,rules,clipper,cache);
 const derived=result.candidates.find(r=>r.entityId==='parent'),cutter=rows[1];
 const normalized=globalThis.PandoLabPolygonGeometry.normalizeClippedPolygonGeometry([derived.geometry.coordinates]);
 const union=globalThis.PandoLabPolygonGeometry.normalizeClippedPolygonGeometry(module.historicalWorldClipper.union([derived.geometry.coordinates]));
 for(const [left,right] of [
  [derived,{...cutter,geometry:structuredClone(cutter.geometry)}],
  [{...derived,geometry:structuredClone(derived.geometry)},cutter],
  [{...derived,geometry:normalized},cutter],
  [{...derived,geometry:union},cutter],
 ])assert.throws(()=>module.adjustHistoricalTerritories([left,right],policy,clipper,cache),/Unable to complete output ring/);
});

test('subtraction witness follows exact zero-discard chains and reuses cached proofs across date cuts',()=>{
 const {rows,rules,clipper,calls}=subtractionWitnessFixture();
 rows[1].entityId='a-cutter';rules.replacements[0].priorityEntityId='a-cutter';
 rows.push(candidate('b-cutter',1,2));
 rules.replacements.push({...rules.replacements[0],priorityEntityId:'b-cutter'});
 const cache=module.createHistoricalTerritoryCache(clipper),before=structuredClone(rows);
 const first=module.adjustHistoricalTerritories(rows,rules,clipper,cache),failures=calls.failures;
 assert.equal(failures,1);
 const derived=first.candidates.find(r=>r.entityId==='parent');
 assert.equal(owns(first,'parent',0.5),true);assert.equal(owns(first,'parent',1.5),false);
 assert.equal(owns(first,'parent',3),true);assert.equal(owns(first,'parent',6),false);
 const later=rows.map(r=>({...r,validFrom:'1991-10-01',validTo:'1991-10-31'}));
 const second=module.adjustHistoricalTerritories(later,rules,clipper,cache);
 assert.equal(calls.failures,failures,'cached successful proof must not repeat the failed native sweep');
 assert.strictEqual(second.candidates.find(r=>r.entityId==='parent').geometry,derived.geometry);
 assert.deepEqual(second.adjustments,first.adjustments);
 assert.equal(second.candidates[0].validFrom,'1991-10-01');assert.deepEqual(rows,before);
});

test('subtraction witness recovery audit replays separately from precision and cannot be mutated by callers',()=>{
 const {rows,rules,clipper}=subtractionWitnessFixture();
 const cache=module.createHistoricalTerritoryCache(clipper);
 const first=module.adjustHistoricalTerritories(rows,rules,clipper,cache);
 const audit=first.adjustments.find(r=>r.kind==='certified-empty-intersection-recovery');
 assert.ok(audit);assert.equal(audit.proof.method,'exact-subtraction-cutter');
 assert.deepEqual(audit.proof.subtractionDepths,[0,1]);
 assert.equal(audit.proof.precisionDiscardCount,0);
 assert.equal(audit.nativeError.message,'Unable to complete output ring');
 const before=structuredClone(audit);audit.proof.method='caller mutation';
 const second=module.adjustHistoricalTerritories(rows,rules,clipper,cache);
 assert.deepEqual(second.adjustments.find(r=>r.kind==='certified-empty-intersection-recovery'),before);
 assert.equal([...cache.operations.values()].flatMap(r=>r.precision).length,0);
});

test('subtraction witness audit is identical after unrelated cache warmup',()=>{
 const {rows,rules,clipper}=subtractionWitnessFixture();
 const fresh=module.createHistoricalTerritoryCache(clipper),warm=module.createHistoricalTerritoryCache(clipper);
 module.adjustHistoricalTerritories([candidate('unrelated-x',20,22),candidate('unrelated-y',24,26)],policy,clipper,warm);
 const audits=cache=>module.adjustHistoricalTerritories(rows,rules,clipper,cache).adjustments.filter(r=>r.kind==='certified-empty-intersection-recovery');
 assert.equal(JSON.stringify(audits(warm)),JSON.stringify(audits(fresh)));
});

test('subtraction witness audit does not spend the ten-artifact precision budget on cached replay',()=>{
 const {rows,rules,clipper}=subtractionWitnessFixture(),intersection=clipper.intersection;
 const artifact=[[46.798053,39.097382],[46.803617228283514,39.10088708625098],[46.80361722811995,39.10088708614795],[46.798053,39.097382]];
 let emitted=false;
 clipper.intersection=(...args)=>{
  const raw=intersection(...args);
  if(!emitted&&raw.length){emitted=true;return [...raw,...Array.from({length:10},()=>[structuredClone(artifact)])];}
  return raw;
 };
 const cache=module.createHistoricalTerritoryCache(clipper);
 const first=module.adjustHistoricalTerritories(rows,rules,clipper,cache);
 const second=module.adjustHistoricalTerritories(rows,rules,clipper,cache);
 for(const result of [first,second]){
  assert.equal(result.adjustments.filter(r=>r.kind==='certified-clipping-precision-artifact').length,10);
  assert.equal(result.adjustments.filter(r=>r.kind==='certified-empty-intersection-recovery').length,1);
 }
 assert.deepEqual(second.adjustments,first.adjustments);
});

test('subtraction witness rejects mutated result, ancestor or cutter on recovery and cached reuse',()=>{
 for(const reuseCache of [true,false])for(const part of ['result','ancestor','cutter']){
  const {rows,rules,clipper}=subtractionWitnessFixture(),cache=module.createHistoricalTerritoryCache(clipper);
  const first=module.adjustHistoricalTerritories(rows,rules,clipper,cache);
  const result=first.candidates.find(r=>r.entityId==='parent');
  const geometry=part==='result'?result.geometry:rows[part==='ancestor'?0:1].geometry;
  assert.equal(Object.isFrozen(geometry),false,'do not freeze caller inputs');
  geometry.coordinates[0][1][0]+=.125;
  if(!reuseCache)cache.operations.clear();
  assert.throws(()=>module.adjustHistoricalTerritories([result,rows[1]],policy,clipper,cache),error=>{
   assert.equal(error.cause.message,'Unable to complete output ring');
   assert.match(error.recoveryRejected,/mutated/);return true;
  });
 }
});

test('subtraction witness captures operands before a difference that mutates its source',()=>{
 const {rows,rules,clipper}=subtractionWitnessFixture(),difference=clipper.difference;
 clipper.difference=(...args)=>{
  const raw=difference(...args);rows[0].geometry.coordinates[0][1][0]+=.125;return raw;
 };
 assert.throws(()=>module.adjustHistoricalTerritories(rows,rules,clipper),error=>{
  assert.equal(error.cause.message,'Unable to complete output ring');assert.match(error.recoveryRejected,/mutated/);return true;
 });
});

test('subtraction witness rejects forged, cyclic and uncertain public cache certificates',()=>{
 for(const makeCertificate of [(result,cutter)=>({left:result,right:cutter}),(_result,cutter)=>({left:null,right:cutter}),(_result,cutter)=>({right:cutter})]){
  const {rows,clipper}=subtractionWitnessFixture(),cache=module.createHistoricalTerritoryCache(clipper);
  const derived={...rows[0],geometry:box(0,4)};
  cache.subtractions??=new WeakMap();
  cache.subtractions.set(derived.geometry,makeCertificate(derived.geometry,rows[1].geometry));
  assert.throws(()=>module.adjustHistoricalTerritories([derived,rows[1]],policy,clipper,cache),/Unable to complete output ring/);
 }
});

test('subtraction witness rejects a recovered cache key reassigned to a different operand object',()=>{
 const {rows,rules,clipper}=subtractionWitnessFixture(),cache=module.createHistoricalTerritoryCache(clipper);
 const first=module.adjustHistoricalTerritories(rows,rules,clipper,cache);
 const derived=first.candidates.find(r=>r.entityId==='parent');
 const different={...derived,geometry:box(0,8)};
 cache.keys.set(different.geometry,cache.keys.get(derived.geometry));
 assert.throws(()=>module.adjustHistoricalTerritories([different,rows[1]],policy,clipper,cache),error=>{
  assert.equal(error.cause.message,'Unable to complete output ring');assert.match(error.recoveryRejected,/uncertain/);return true;
 });
});

test('subtraction witness rejects malformed empty ancestors and budget errors without changing their causes',()=>{
 const budget=Object.assign(new Error('Unable to complete output ring'),{code:'HISTORICAL_CLIP_PRECISION_BUDGET_EXCEEDED'});
 for(const options of [{external:[20,22],witness:'malformed'},{external:[20,22],witness:'empty-string'},{error:budget}]){
  const {rows,rules,clipper}=subtractionWitnessFixture(options);
  assert.throws(()=>module.adjustHistoricalTerritories(rows,rules,clipper),error=>{
   assert.equal(error.cause.message,'Unable to complete output ring');
   if(options.error)assert.strictEqual(error.cause,budget);
   return true;
  });
 }
});

test('subtraction witness stops an over-depth chain without erasing the native error',()=>{
 const rows=[candidate('parent',0,80)],rules={...policy,replacements:[]};
 for(let i=0;i<65;i++){
  const id='cutter-'+String(i).padStart(2,'0');
  rows.push({...candidate(id,79-i,80-i),currentSnapshot:true});
  rules.replacements.push({targetEntityId:'parent',priorityEntityId:id,validFrom:'1991-01-01',validTo:'1992-01-01'});
 }
 const range=value=>{const xs=value.flat(2).map(p=>p[0]);return [Math.min(...xs),Math.max(...xs)];};
 const clipper={...module.historicalWorldClipper,intersection:(a,b)=>{
  const ranges=[a,b].map(range).map(x=>x.join(','));
  if(ranges.includes('0,15')&&ranges.includes('79,80'))throw Error('Unable to complete output ring');
  return module.historicalWorldClipper.intersection(a,b);
 }};
 assert.throws(()=>module.adjustHistoricalTerritories(rows,rules,clipper),error=>{
  assert.equal(error.cause.message,'Unable to complete output ring');assert.match(error.recoveryRejected,/depth/);return true;
 });
});
test('native difference terminates for a shared near-collinear historical triangle', () => {
  const a = [[[[9.758080569987348,47.03701035412004],[9.857982,47.015478],[9.856328,47.004083],[9.758080569987348,47.03701035412004]]]];
  const b = [[[[9.84987981578944,47.01722431233553],[9.838242,47.0120742],[9.807049969632736,47.026455685842755],[9.84987981578944,47.01722431233553]]]];
  const original = structuredClone([a, b]);
  const expected = globalThis.polygonClipping.difference(a, b);
  const actual = module.historicalWorldClipper.difference(a, b);
  assert.deepEqual([a, b], original, 'source coordinates must remain unchanged');
  assert.deepEqual(globalThis.polygonClipping.xor(actual, expected), []);
});
test('native difference closes the ring at near-collinear historical intersections', () => {
  const a = [[[[11.682573,47.58335],[11.638958,47.589241],[11.620458,47.589654],[11.682573,47.58335]]]];
  const b = [[[[11.6353339,47.5940318],[11.660654577711517,47.58631048207501],[11.634505346399656,47.58934040248308],[11.6353339,47.5940318]]]];
  const original = structuredClone([a, b]);
  const expected = globalThis.polygonClipping.difference(a, b);
  const actual = module.historicalWorldClipper.difference(a, b);
  assert.deepEqual([a, b], original, 'source coordinates must remain unchanged');
  assert.deepEqual(globalThis.polygonClipping.xor(actual, expected), []);
});
function adjust(rows, rules = policy, clipper = globalThis.polygonClipping) {
  assert.equal(typeof module.adjustHistoricalTerritories, 'function');
  return module.adjustHistoricalTerritories(rows, rules, clipper);
}
function owns(result, id, x) {
  const row = result.candidates.find(item => item.entityId === id);
  if (!row) return false;
  return globalThis.polygonClipping.intersection(row.geometry.type === 'Polygon' ? [row.geometry.coordinates] : row.geometry.coordinates, [box(x - .01, x + .01).coordinates]).length > 0;
}
test('historical production clipping uses the shared native Core without coordinate rounding or JS fallback',()=>{
  const rows=[candidate('east',0,6),candidate('west',4,10)];
  const before=JSON.stringify(rows);
  const native=module.adjustHistoricalTerritories(rows,policy);
  const baseline=module.adjustHistoricalTerritories(rows,policy,globalThis.polygonClipping);
  const multi=geometry=>geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.coordinates||[];
  assert.deepEqual(native.candidates.map(row=>row.entityId),baseline.candidates.map(row=>row.entityId));
  for(const row of native.candidates){
    const reference=baseline.candidates.find(item=>item.entityId===row.entityId);
    assert.deepEqual(globalThis.polygonClipping.xor(multi(row.geometry),multi(reference.geometry)),[]);
  }
  assert.equal(JSON.stringify(rows),before,'native compilation cannot mutate source geometry');
  assert.notEqual(module.historicalWorldClipper,globalThis.polygonClipping,
    'production must not use the numerically unstable JavaScript sweep line');
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

test('peer overlap must be significant to both the small and large country',()=>{
 const rows=[candidate('large',-80,80),candidate('small',0,1e-8)],before=structuredClone(rows);
 const clipper={...module.historicalWorldClipper,
  union:()=>assert.fail('an overlap below either peer threshold must not become a cutter'),
  difference:()=>assert.fail('asymmetric significance must not remove either country'),
 };
 const result=module.adjustHistoricalTerritories(rows,policy,clipper);
 assert.deepEqual(result.candidates,rows);
 assert.deepEqual(result.adjustments,[]);
 assert.deepEqual(rows,before);
});

test('a failed original-peer union stops before subtraction without an alternate path',()=>{
 const rows=[candidate('a',0,6),candidate('b',4,10)],before=structuredClone(rows);
 let unions=0,differences=0;
 const clipper={...module.historicalWorldClipper,
  union:()=>{unions++;throw new Error('Unable to complete output ring');},
  difference:()=>{differences++;assert.fail('failed union cannot become a subtraction operand');},
 };
 assert.throws(()=>module.adjustHistoricalTerritories(rows,policy,clipper),error=>{
  assert.match(error.message,/HISTORICAL_CLIP_BOOLEAN_FAILED: original-peer-union a/);
  assert.equal(error.cause.message,'Unable to complete output ring');
  return true;
 });
 assert.equal(unions,1);assert.equal(differences,0);
 assert.deepEqual(rows,before);
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
  }), error=>{
    assert.match(error.message,/HISTORICAL_CLIP_BOOLEAN_FAILED/);
    assert.match(error.message,/operandComponents=1,1/);
    assert.match(error.message,/clipping failure/);
    assert.match(error.cause.message,/clipping failure/);
    return true;
  });
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
 assert.deepEqual(reused,module.adjustHistoricalTerritories(later,policy,clipper));
 assert.equal(reused.candidates[0].validFrom,'2000-01-01');
 assert.deepEqual(reused.adjustments,first.adjustments);
 const edited=[{...later[0],geometry:box(0,3)},later[1]];
 assert.deepEqual(module.adjustHistoricalTerritories(edited,policy,clipper,cache),module.adjustHistoricalTerritories(edited,policy,clipper));
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
 for(let run=0;run<2;run++)assert.throws(()=>module.adjustHistoricalTerritories(many,policy,clipper,budget),error=>{
   assert.equal(error.code,'HISTORICAL_CLIP_PRECISION_BUDGET_EXCEEDED');
   assert.match(error.message,/count=\d+, areaM2=/);
   assert.doesNotMatch(error.message,/HISTORICAL_CLIP_INVALID/,'an audit limit is not malformed source geometry');
   return true;
 });
});

// Source geometry and immutable snapshots are necessary: subtracting the
// intersection fragments first can introduce near-coincident shared edges.
test('unknown peers subtract their original union instead of generated intersection fragments',()=>{
  const rows=[candidate('a',0,12),candidate('b',3,15),candidate('c',6,18)];
  const calls=[],clipper={...globalThis.polygonClipping,
    union:(...operands)=>{calls.push(['union',...operands.map(x=>x.length)]);if(calls.length===1){
      assert.equal(Math.max(...operands.flat(3).map(point=>point[0])),18,
        'the first cutter union uses original peers, not intersections truncated at the subject boundary');
    }return globalThis.polygonClipping.union(...operands);},
    difference:(...operands)=>{calls.push(['difference',...operands.map(x=>x.length)]);return globalThis.polygonClipping.difference(...operands);}};
  const before=structuredClone(rows);
  const result=module.adjustHistoricalTerritories(rows,policy,clipper);
  const baseline=globalThis.polygonClipping.difference(rows[0].geometry.coordinates,rows[1].geometry.coordinates,rows[2].geometry.coordinates);
  const shape=result.candidates.find(row=>row.entityId==='a')?.geometry;
  const multi=shape?.type==='Polygon'?[shape.coordinates]:shape?.coordinates||[];
  assert.deepEqual(globalThis.polygonClipping.xor(multi,baseline),[]);
  assert.ok(calls.some(args=>args[0]==='union'&&args.length===3),
    'the two significant original peers form the cutter union for A');
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

// Regression for the sub-millidegree shared-border segment that previously
// made a large historical Germany sweep lose its active tree entry.
test('native historical subtraction retains exact near-collinear source vertices',()=>{
  const p=[12.09703138349695,50.25690418331658],q=[12.102393,50.259156];
  const subject={...candidate('DEU',0,1),geometry:{type:'Polygon',coordinates:[[
    [12.08,50.24],[12.16,50.24],[12.16,50.31],[12.08,50.31],[12.08,50.24],
  ]]}};
  const peer={...candidate('border-peer',0,1),geometry:{type:'Polygon',coordinates:[[
    p,q,[12.11,50.263],[12.095,50.266],p,
  ]]}};
  const input=[subject,peer],snapshot=structuredClone(input);
  const result=module.adjustHistoricalTerritories(input,policy);
  const wrap=geometry=>geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.coordinates||[];
  const expected=globalThis.polygonClipping.difference(wrap(subject.geometry),wrap(peer.geometry));
  const rebuilt=result.candidates.find(row=>row.entityId==='DEU');
  assert.ok(rebuilt,'the surrounding country geometry must survive');
  assert.deepEqual(globalThis.polygonClipping.xor(wrap(rebuilt.geometry),expected),[]);
  assert.deepEqual(input,snapshot,'compilation must not perturb the exact source vertices');
  assert.deepEqual(result,module.adjustHistoricalTerritories([...input].reverse(),policy));
});

test('disjoint historical islands bypass the Boolean engine without any coordinate copy',()=>{
  const boxAt=(west,east)=>[[[west,0],[east,0],[east,2],[west,2],[west,0]]];
  const pieces=Array.from({length:18},(_,i)=>boxAt(i*10,i*10+5));
  const subject={...candidate('subject',0,1),geometry:{type:'MultiPolygon',coordinates:pieces}};
  const cutter={...candidate('cutter',0,1),geometry:{type:'Polygon',coordinates:boxAt(0.5,1.5)}};
  const rules={...policy,replacements:[{targetEntityId:'subject',priorityEntityId:'cutter',
    validFrom:'1991-01-01',validTo:'1992-01-01'}]};
  let calls=0;
  const clipper={...globalThis.polygonClipping,difference:(...args)=>{calls++;return globalThis.polygonClipping.difference(...args);}};
  const result=module.adjustHistoricalTerritories([subject,cutter],rules,clipper);
  const updated=result.candidates.find(row=>row.entityId==='subject').geometry;
  const multi=updated.type==='Polygon'?[updated.coordinates]:updated.coordinates;
  assert.equal(calls,1,'only the mainland intersection reaches the Boolean sweep');
  for(const island of pieces.slice(1))assert.ok(multi.some(row=>JSON.stringify(row)===JSON.stringify(island)),
    'unrelated islands must remain exactly unchanged');
});

test('independent cutter islands stay separated through large historical differences',()=>{
  const boxAt=(w,e,s,n)=>[[[w,s],[e,s],[e,n],[w,n],[w,s]]];
  const subject={...candidate('subject',0,1),geometry:{type:'Polygon',coordinates:boxAt(0,80,0,10)}};
  const cutters=Array.from({length:16},(_,i)=>boxAt(2+i*4.5,3+i*4.5,3,5));
  const peer={...candidate('peer',0,1),geometry:{type:'MultiPolygon',coordinates:cutters}};
  const rules={...policy,replacements:[{targetEntityId:'subject',priorityEntityId:'peer',
    validFrom:'1991-01-01',validTo:'1992-01-01'}]};
  const calls=[],clipper={...globalThis.polygonClipping,
    difference:(...args)=>{calls.push(args.map(item=>item.length));return globalThis.polygonClipping.difference(...args);}};
  const result=module.adjustHistoricalTerritories([subject,peer],rules,clipper);
  const actual=result.candidates.find(row=>row.entityId==='subject').geometry;
  const multi=geometry=>geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.coordinates||[];
  const expected=globalThis.polygonClipping.difference(multi(subject.geometry),multi(peer.geometry));
  assert.deepEqual(globalThis.polygonClipping.xor(multi(actual),expected),[]);
  assert.equal(calls.length,16,'independent cutter islands must be subtracted independently');
  assert.ok(calls.every(args=>args.length===2&&args[0]===1&&args[1]===1),
    'each sweep handles one subject and one original cutter');
  assert.deepEqual(module.adjustHistoricalTerritories([peer,subject],rules,clipper),result);
});

test('eleven independent cutters never share a sweep with one historical mainland',()=>{
  const ring=(w,e,s,n)=>[[[w,s],[e,s],[e,n],[w,n],[w,s]]];
  const subject={...candidate('CHE',0,1),geometry:{type:'Polygon',coordinates:ring(0,70,0,10)}};
  const peer={...candidate('peer',0,1),geometry:{type:'MultiPolygon',
    coordinates:Array.from({length:11},(_,i)=>ring(i*6+1,i*6+3,2,8))}};
  const rules={...policy,replacements:[{targetEntityId:'CHE',priorityEntityId:'peer',
    validFrom:'1991-01-01',validTo:'1992-01-01'}]};
  const calls=[],clipper={...globalThis.polygonClipping,
    difference:(...operands)=>{calls.push(operands.map(x=>x.length));return globalThis.polygonClipping.difference(...operands);}};
  const result=module.adjustHistoricalTerritories([subject,peer],rules,clipper);
  const geometry=result.candidates.find(row=>row.entityId==='CHE').geometry;
  const multi=value=>value.type==='Polygon'?[value.coordinates]:value.coordinates;
  assert.deepEqual(globalThis.polygonClipping.xor(multi(geometry),
    globalThis.polygonClipping.difference(multi(subject.geometry),multi(peer.geometry))),[]);
  assert.equal(calls.length,11);
  assert.ok(calls.every(([left,right])=>left===1&&right===1));
});

test('connected cutters are normalized between exact historical differences',()=>{
  const boxAt=(w,e,s,n)=>[[[w,s],[e,s],[e,n],[w,n],[w,s]]];
  const subject={...candidate('main',0,1),geometry:{type:'Polygon',coordinates:boxAt(0,70,0,10)}};
  const cutters=Array.from({length:16},(_,i)=>boxAt(i*4+1,i*4+3,3,7));
  const peer={...candidate('peer',0,1),geometry:{type:'MultiPolygon',coordinates:cutters}};
  const rules={...policy,replacements:[{targetEntityId:'main',priorityEntityId:'peer',
    validFrom:'1991-01-01',validTo:'1992-01-01'}]};
  const operations=[],clipper={...globalThis.polygonClipping,
    difference:(...operands)=>{operations.push(operands.map(x=>x.length));return globalThis.polygonClipping.difference(...operands);}};
  const result=module.adjustHistoricalTerritories([subject,peer],rules,clipper);
  const geometry=result.candidates.find(row=>row.entityId==='main').geometry;
  const multi=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.coordinates||[];
  assert.deepEqual(globalThis.polygonClipping.xor(multi,
    globalThis.polygonClipping.difference([subject.geometry.coordinates],peer.geometry.coordinates)),[]);
  assert.equal(operations.length,16);
  assert.ok(operations.every(([left,right])=>left===1&&right===1),
    'the second sweep can only receive one already normalized subject and one original cutter');
});

const wrap=geometry=>geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.coordinates||[];

test('original peer operands avoid generated-edge ring failures without changing triple-overlap gaps or source coordinates',()=>{
 const rows=[candidate('a',0,12),candidate('b',3,15),candidate('c',6,18)],before=structuredClone(rows);
 let generatedEdgeFailures=0;
 const clipper={...module.historicalWorldClipper,difference:(left,right)=>{
  const xs=value=>value.flat(2).map(point=>point[0]);
  if((Math.min(...xs(left))===0&&Math.max(...xs(left))===12&&Math.max(...xs(right))===12)
    || (Math.min(...xs(left))===6&&Math.max(...xs(left))===18&&Math.min(...xs(right))===6))
   {generatedEdgeFailures++;throw new Error('Unable to complete output ring');}
  return module.historicalWorldClipper.difference(left,right);
 }};
 const result=module.adjustHistoricalTerritories(rows,policy,clipper);
 assert.deepEqual(result.candidates.map(row=>row.entityId),['a','c']);
 assert.deepEqual(globalThis.polygonClipping.xor(wrap(result.candidates[0].geometry),[box(0,3).coordinates]),[]);
 assert.deepEqual(globalThis.polygonClipping.xor(wrap(result.candidates[1].geometry),[box(15,18).coordinates]),[]);
 assert.deepEqual(rows,before,'the original peer snapshots remain immutable');
 assert.deepEqual(module.adjustHistoricalTerritories([...rows].reverse(),policy,clipper),result);
 assert.equal(generatedEdgeFailures,0,'generated intersection boundaries must never enter subtraction');
});

test('a failed peer subtraction cannot erase precision evidence or retry another path',()=>{
 const artifact=[[46.798053,39.097382],[46.803617228283514,39.10088708625098],
  [46.80361722811995,39.10088708614795],[46.798053,39.097382]];
 const rows=[candidate('a',0,20),{...candidate('b',0,1),geometry:{type:'MultiPolygon',coordinates:[box(3,5).coordinates,box(10,12).coordinates]}}];
 let calls=0;
 const clipper={...module.historicalWorldClipper,difference:(...args)=>{
  calls++;if(calls===2)throw new Error('Unable to complete output ring');
  const result=module.historicalWorldClipper.difference(...args);
  return calls===1?[...result,[artifact]]:result;
 }};
 assert.throws(()=>module.adjustHistoricalTerritories(rows,policy,clipper),/Unable to complete output ring/);
 assert.equal(calls,2,'a partially audited failed subtraction cannot use another path');
});

test('original peer subtraction does not mask unrelated Boolean failures',()=>{
 const rows=[candidate('a',0,6),candidate('b',4,10)];
 let calls=0;
 const clipper={...module.historicalWorldClipper,difference:()=>{calls++;throw new Error('unrelated clipping failure');}};
 assert.throws(()=>module.adjustHistoricalTerritories(rows,policy,clipper),/unrelated clipping failure/);
 assert.equal(calls,1);
});


test('a failed original peer subtraction retains the native error without an alternate attempt',()=>{
 const rows=[candidate('a',0,6),candidate('b',4,10)];
 let calls=0;
 const clipper={...module.historicalWorldClipper,difference:()=>{
  calls++;throw new Error(calls===1?'Unable to complete output ring':'recovery rejected');
 }};
 assert.throws(()=>module.adjustHistoricalTerritories(rows,policy,clipper),error=>{
  assert.match(error.message,/HISTORICAL_CLIP_BOOLEAN_FAILED/);
  assert.equal(error.cause.message,'Unable to complete output ring');
  assert.equal(error.originalFailure,undefined);
  return true;
 });
 assert.equal(calls,1);
});

test('explicit replacements never retry a failed Boolean operation',()=>{
 const rows=[candidate('a',0,6),candidate('b',4,10)];
 let calls=0;
 const clipper={...module.historicalWorldClipper,difference:()=>{calls++;throw new Error('Unable to complete output ring');}};
 const rules={...policy,replacements:[{targetEntityId:'a',priorityEntityId:'b',validFrom:'1991-01-01',validTo:'1992-01-01'}]};
 assert.throws(()=>module.adjustHistoricalTerritories(rows,rules,clipper),/Unable to complete output ring/);
 assert.equal(calls,1);
});

test('cached original peer subtraction replays precision evidence across later intervals',()=>{
 const artifact=[[46.798053,39.097382],[46.803617228283514,39.10088708625098],
  [46.80361722811995,39.10088708614795],[46.798053,39.097382]];
 const rows=[candidate('a',0,12),candidate('b',3,15),candidate('c',6,18)];
 const xs=value=>value.flat(2).map(point=>point[0]);
 let failures=0,nativeCalls=0;
 const clipper=Object.fromEntries(['union','intersection','difference'].map(name=>[name,(...operands)=>{
  if(name==='difference'&&Math.min(...xs(operands[0]))===0
      &&Math.max(...xs(operands[0]))===12&&Math.max(...xs(operands[1]))===12){
   failures++;throw new Error('Unable to complete output ring');
  }
  nativeCalls++;
  const result=module.historicalWorldClipper[name](...operands);
  const peerExtent=operands.flatMap(xs);
  return name==='union'&&Math.min(...peerExtent)===3&&Math.max(...peerExtent)===18
   ? [...result,[artifact]]:result;
 }]));
 const cache=module.createHistoricalTerritoryCache(clipper);
 const first=module.adjustHistoricalTerritories(rows,policy,clipper,cache),initialCalls=nativeCalls;
 const later=rows.map(row=>({...row,validFrom:'2000-01-01',validTo:'2001-12-31'}));
 const reused=module.adjustHistoricalTerritories(later,policy,clipper,cache);
 assert.equal(failures,0,'neither interval subtracts generated intersection boundaries');
 assert.equal(nativeCalls,initialCalls,'the original-peer result is reused without new native work');
 assert.deepEqual(reused.adjustments,first.adjustments,'cached subtraction must replay its precision audit');
 assert.equal(reused.adjustments.filter(row=>row.kind==='certified-clipping-precision-artifact').length,1);
 assert.deepEqual(reused.candidates.map(row=>[row.entityId,row.validFrom,row.validTo]),[
  ['a','2000-01-01','2001-12-31'],['c','2000-01-01','2001-12-31'],
 ]);
 assert.deepEqual(globalThis.polygonClipping.xor(wrap(reused.candidates[0].geometry),[box(0,3).coordinates]),[]);
 assert.deepEqual(globalThis.polygonClipping.xor(wrap(reused.candidates[1].geometry),[box(15,18).coordinates]),[]);
});

// Exercise the canonical local component sweep with its actual normalizer.
// Extracting the local closure avoids exporting a second geometry API for tests.
async function componentBoundsFixture() {
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../../tools/historical-world-territories.mjs',import.meta.url),'utf8');
 const start=source.indexOf('  const envelope='),end=source.indexOf('  const evaluate=',start);
 assert.ok(start>=0&&end>start);
 const code=source.slice(start,end).replace('let west=','counter.scans++;let west=');
 const counters={scans:0},calls=[],precision=[];
 const clipper={difference:(a,b)=>{calls.push(structuredClone([a,b]));return module.historicalWorldClipper.difference(a,b);}};
 const shape=(value,operation)=>!value.length?null:globalThis.PandoLabPolygonGeometry.normalizeClippedPolygonGeometry(value,{
  onPrecisionDiscard:row=>precision.push({...row,operation}),
 });
 const run=new Function('clipper','shape','counter',code+'return componentDifference;')(clipper,shape,counters);
 return {run,clipper,counters,calls,precision};
}

test('component bounds scan each untouched part once across many cutters',async()=>{
 const {run,counters,calls}=await componentBoundsFixture();
 const left=Array.from({length:30},(_,i)=>box(i*3,i*3+1).coordinates);
 const right=Array.from({length:50},(_,i)=>box(500+i*3,501+i*3).coordinates);
 const result=run(left,right,'difference subject / cutter');
 assert.deepEqual(result,left);assert.ok(result.every((part,i)=>part===left[i]));
 assert.equal(calls.length,0);assert.equal(counters.scans,80);
});

test('component bounds preserve exact ordered native split results and precision trace',async()=>{
 const {run,clipper,calls,precision}=await componentBoundsFixture();
 const left=[box(0,10).coordinates,box(20,22).coordinates,box(40,45).coordinates];
 const right=[box(3,4).coordinates,box(6,7).coordinates,box(20,22).coordinates,box(100,101).coordinates];
 const artifact=[[46.798053,39.097382],[46.803617228283514,39.10088708625098],[46.80361722811995,39.10088708614795],[46.798053,39.097382]];
 const difference=clipper.difference;
 clipper.difference=(a,b)=>[...difference(a,b),[artifact]];
 const expected=[],expectedCalls=[],expectedPrecision=[];
 // Direct scalar reference preserves the pre-optimization loop and shape order.
 const bounds=p=>p.flat().reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
 for(const polygon of left){let remaining=[polygon];for(const cutter of right){const next=[];for(const part of remaining){
  const a=bounds(part),b=bounds(cutter);if(!(a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1])){next.push(part);continue;}
  expectedCalls.push(structuredClone([[part],[cutter]]));
  const normalized=globalThis.PandoLabPolygonGeometry.normalizeClippedPolygonGeometry([...module.historicalWorldClipper.difference([part],[cutter]),[artifact]],{onPrecisionDiscard:row=>expectedPrecision.push({...row,operation:'difference subject / cutter'})});
  if(normalized)next.push(...(normalized.type==='Polygon'?[normalized.coordinates]:normalized.coordinates));
 }remaining=next;}expected.push(...remaining);}
 assert.deepEqual(run(left,right,'difference subject / cutter'),expected);
 assert.deepEqual(calls,expectedCalls);assert.deepEqual(precision,expectedPrecision);assert.ok(precision.length>0);
});

test('component bounds invalidate retained sibling bounds after injected clipper mutation',async()=>{
 const {calls}=await componentBoundsFixture();
 let call=0,retained;
 const first=box(0,2).coordinates,second=box(4,10).coordinates;
 // Shape normally copies coordinates. Capture the normalized sibling directly
 // through a second local invocation, retaining the production sweep itself.
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../../tools/historical-world-territories.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('  const envelope='),source.indexOf('  const evaluate='));
 const mutationClipper={difference:(a,b)=>{calls.push(structuredClone([a,b]));call++;if(call===1)return [first,second];if(call===2)for(const ring of retained)for(const point of ring)point[0]+=20;return [box(1,2).coordinates];}};
 const shape=value=>{if(call===1)retained=value[1];return {type:'MultiPolygon',coordinates:value};};
 const sweep=new Function('clipper','shape',code+'return componentDifference;')(mutationClipper,shape);
 const result=sweep([box(0,10).coordinates],[box(3,4).coordinates,box(100,101).coordinates,box(0,1).coordinates,box(8,9).coordinates],'difference subject / cutter');
 assert.equal(call,2);assert.deepEqual(result,[box(1,2).coordinates,box(24,30).coordinates]);
});

test('component bounds preserve lazy malformed input and direct clipping errors',async()=>{
 const {run,clipper}=await componentBoundsFixture();
 assert.deepEqual(run([null],[],'difference subject / cutter'),[null]);
 assert.throws(()=>run([null],[box(0,1).coordinates],'difference subject / cutter'),TypeError);
 const failure=new Error('native ring failure');clipper.difference=()=>{throw failure;};
 assert.throws(()=>run([box(0,10).coordinates],[box(1,2).coordinates],'difference subject / cutter'),error=>error===failure);
});
