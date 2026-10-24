import { sharedCalculationCore } from './temporal.js';

// The Worker retains live feature, ring and cache identity. Shared C++ owns
// geographic edge candidate discovery, split topology and display seam pieces.
if (typeof sharedCalculationCore?.countryContactPairsBatch !== 'function') {
  throw Object.assign(new Error('Compiled country contact calculation is unavailable.'),
    { code: 'PL-CORE-WASM-CAPABILITY' });
}
const invalid = detail => {
  throw Object.assign(new Error('Invalid compiled country contact result: ' + detail),
    { code: 'PL-COUNTRY-CONTACT' });
};

// Encode each prepared feature once per synchronous C++ contact batch.
// Persisting the encoding in a Worker-wide WeakMap held 519,900 nested arrays
// (~23.81MiB in the isolated OBJ-093 Chromium attribution), although these
// arrays are derivable from prepared.segments. The batch's unique features[]
// list already prevents duplicate encodings within a call. Keep the source
// rows and all source-ref identities; never retain their wire copy after use.
function encodedRows(prepared) {
  return prepared.segments.map(row=>[row.a,row.b,row.polygonIndex,row.ringIndex,row.segmentIndex]);
}

/** One C++ crossing for all touched pairs, retaining patch/cached identities. */
export function computeCountrySharedContacts(pairs = []) {
  const output=pairs.map(()=>[]);
  if (!pairs.length)return output;
  const features=[],identities=new Map(),active=[],positions=[];
  const indexOf=prepared=>{
    if (!prepared||!Array.isArray(prepared.segments))invalid('missing prepared feature');
    if (!identities.has(prepared)){
      identities.set(prepared,features.length);
      features.push(prepared);
    }
    return identities.get(prepared);
  };
  pairs.forEach((pair,index)=>{
    if (!Array.isArray(pair)||pair.length!==2)invalid('invalid feature pair');
    const [left,right]=pair;
    if (!left||!right||!Array.isArray(left.segments)||!Array.isArray(right.segments))
      invalid('missing prepared feature');
    // The original JS topology used owner IDs as Set keys. A country cannot
    // share a border with itself, even if it occurs more than once in a bundle.
    if (String(left.id)===String(right.id)||!left.segments.length||!right.segments.length)
      return;
    active.push([indexOf(left),indexOf(right)]);
    positions.push(index);
  });
  if (!active.length)return output;
  const compiled=sharedCalculationCore.countryContactPairsBatch(features.map(encodedRows),active);
  if (!Array.isArray(compiled)||compiled.length!==active.length)invalid('missing pair outputs');
  compiled.forEach((pairResult,index)=>{
    if (!Array.isArray(pairResult)||pairResult.length!==2||!Array.isArray(pairResult[1]))
      invalid('malformed pair output');
    const [left,right]=pairs[positions[index]];
    const ownerIds=[String(left.id),String(right.id)].sort();
    output[positions[index]]=pairResult[1].map(row=>{
      if (!Array.isArray(row)||row.length!==3||!Array.isArray(row[2]))
        invalid('malformed shared segment');
      const [start,end,rawReferences]=row;
      const refs=rawReferences.map(ref=>{
        if (!Array.isArray(ref)||ref.length!==4)invalid('malformed source reference');
        const [owner,sourceIndex,startT,endT]=ref;
        const original=owner===0?left:owner===1?right:null;
        const sourceRow=original?.segments[sourceIndex];
        if (!sourceRow||String(sourceRow.featureId)!==String(original.id)
          ||!Number.isFinite(startT)||!Number.isFinite(endT))
          invalid('missing source segment');
        // Prepared rows may inherit immutable country/ring metadata. C++ source
        // refs must still be complete own-property snapshots for cached seeds,
        // country editing and parity with the original full source records.
        return { ...sourceRow, featureId: sourceRow.featureId,
          polygonIndex: sourceRow.polygonIndex, ringIndex: sourceRow.ringIndex,
          interiorSide: sourceRow.interiorSide, startT, endT };
      });
      return {start,end,ownerIds:[...ownerIds],refs};
    });
  });
  return output;
}
