import { sharedCalculationCore } from './temporal.js';
import { selectCountryContactRows } from './country-contact-row-pruning.js';

// C++ owns geographic edge intersections, topology and split ordering.
// This module only selects conservative indexed source rows and restores the
// original source references after native index positions are compacted.
if (typeof sharedCalculationCore?.countryContactPairsBatch !== 'function') {
  throw Object.assign(new Error('Compiled country contact calculation is unavailable.'),
    { code: 'PL-CORE-WASM-CAPABILITY' });
}
const invalid = detail => {
  throw Object.assign(new Error('Invalid compiled country contact result: ' + detail),
    { code: 'PL-COUNTRY-CONTACT' });
};
const encodedRows = rows => rows.map(row =>
  [row.a,row.b,row.polygonIndex,row.ringIndex,row.segmentIndex]);

/** Batch only C++-owned contact calculations for source-exact feature pairs. */
export function computeCountrySharedContacts(pairs = [], profile, { unpruned=false, verifyParity=false } = {}) {
  const trace=typeof profile==='function'?profile:null;
  const empty=pairs.map(()=>[]);
  if(!pairs.length)return empty;
  const features=[],identities=new Map(),active=[],positions=[];
  const indexOf=prepared=>{
    if(!prepared||!Array.isArray(prepared.segments))invalid('missing prepared feature');
    if(!identities.has(prepared)){
      identities.set(prepared,features.length);
      features.push(prepared);
    }
    return identities.get(prepared);
  };
  pairs.forEach((pair,index)=>{
    if(!Array.isArray(pair)||pair.length!==2)invalid('invalid feature pair');
    const [left,right]=pair;
    if(!left||!right||!Array.isArray(left.segments)||!Array.isArray(right.segments))
      invalid('missing prepared feature');
    if(String(left.id)===String(right.id)||!left.segments.length||!right.segments.length)
      return;
    active.push([indexOf(left),indexOf(right)]);
    positions.push(index);
  });
  if(!active.length)return empty;
  let started=trace?performance.now():0;
  const subset=unpruned?{
    rows:features.map(feature=>feature.segments),
    stats:{sourceEdges:features.reduce((sum,f)=>sum+f.segments.length,0),unpruned:true},
  }:selectCountryContactRows(features,active);
  if(trace)trace('contact-select-source',performance.now()-started,subset.stats);
  started=trace?performance.now():0;
  const preparedRows=subset.rows.map(encodedRows);
  if(trace)trace('contact-encode',performance.now()-started,{
    preparedFeatures:features.length,candidatePairs:active.length,
    encodedEdges:preparedRows.reduce((sum,rows)=>sum+rows.length,0),
    originalEdges:subset.stats.sourceEdges});
  started=trace?performance.now():0;
  const compiled=sharedCalculationCore.countryContactPairsBatch(preparedRows,active);
  if(trace)trace('contact-native-bridge',performance.now()-started,{
    preparedFeatures:features.length,candidatePairs:active.length});
  const decode=(results,sourceRows)=>{
    if(!Array.isArray(results)||results.length!==active.length)invalid('missing pair outputs');
    const output=pairs.map(()=>[]);
    results.forEach((pairResult,index)=>{
      if(!Array.isArray(pairResult)||pairResult.length!==2||!Array.isArray(pairResult[1]))
        invalid('malformed pair output');
      const [left,right]=pairs[positions[index]];
      const ownerIds=[String(left.id),String(right.id)].sort();
      output[positions[index]]=pairResult[1].map(row=>{
        if(!Array.isArray(row)||row.length!==3||!Array.isArray(row[2]))
          invalid('malformed shared segment');
        const [start,end,rawReferences]=row;
        const refs=rawReferences.map(ref=>{
          if(!Array.isArray(ref)||ref.length!==4)invalid('malformed source reference');
          const [owner,sourceIndex,startT,endT]=ref;
          const original=owner===0?left:owner===1?right:null;
          const index=identities.get(original);
          const sourceRow=sourceRows[index]?.[sourceIndex];
          if(!sourceRow||String(sourceRow.featureId)!==String(original.id)
            ||!Number.isFinite(startT)||!Number.isFinite(endT))
            invalid('missing source segment');
          // Restore references to the *current* immutable prepared rows, not
          // compacted native array positions or stale prior document entries.
          return {...sourceRow,featureId:sourceRow.featureId,
            polygonIndex:sourceRow.polygonIndex,ringIndex:sourceRow.ringIndex,
            interiorSide:sourceRow.interiorSide,startT,endT};
        });
        return {start,end,ownerIds:[...ownerIds],refs};
      });
    });
    return output;
  };
  started=trace?performance.now():0;
  const output=decode(compiled,subset.rows);
  if(trace)trace('contact-decode',performance.now()-started,{
    candidatePairs:active.length,
    sharedSegments:output.reduce((sum,rows)=>sum+rows.length,0)});
  // CI-only exact witness: run the authoritative original full-input C++ path
  // on the same prepared source, then compare every decoded endpoint, owner,
  // order and source-reference value. Production never pays for this branch.
  if(verifyParity&&!unpruned) {
    const fullStarted=performance.now();
    const originalRows=features.map(feature=>feature.segments);
    const full=sharedCalculationCore.countryContactPairsBatch(originalRows.map(encodedRows),active);
    const reference=decode(full,originalRows);
    if(JSON.stringify(output)!==JSON.stringify(reference))
      invalid('pruned source differs from full C++ contact output');
    if(trace)trace('contact-parity-full',performance.now()-fullStarted,
      {candidatePairs:active.length,matched:true});
  }
  return output;
}
