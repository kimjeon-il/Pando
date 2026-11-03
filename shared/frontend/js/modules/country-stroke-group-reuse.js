// Exact, bounded reuse of compiled owner-group strokes across adjacent dates.
// The existing C++ assembler still owns chaining, seams, subdivision and
// phases. Only a group with identical ordered Double coordinates, owner list
// and quality can reuse its last verified native packet. Source order matters.
const DEFAULT_BUDGET = 24 * 1024 * 1024;
const signature = owners => JSON.stringify(owners);
const ownerKey = owners => owners.join('|');
const error = reason => Object.assign(new Error('Invalid grouped boundary packet: ' + reason),
  {code:'PL-BOUNDARY-PACKET'});

function groupsFor(ordered) {
  const groups = [], byKey = new Map();
  let ambiguous = false;
  for (const row of ordered) {
    const key = ownerKey(row.ownerIds), names = signature(row.ownerIds);
    let group = byKey.get(key);
    if (!group) {
      group = {key, names, owners: row.ownerIds, rows: []};
      groups.push(group);
      byKey.set(key, group);
    } else if (group.names !== names) ambiguous = true;
    group.rows.push(row);
  }
  return {groups, ambiguous};
}
function snapshot(group) {
  const coordinates = new Float64Array(group.rows.length * 4);
  let at = 0;
  if (!group.owners.length || group.owners.length > 100 ||
    group.owners.some(id => typeof id !== 'string')) return null;
  for (const row of group.rows) {
    for (const value of [row.start[0], row.start[1], row.end[0], row.end[1]]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      coordinates[at++] = value;
    }
  }
  return coordinates;
}
function equalCoordinates(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (!Object.is(left[i], right[i])) return false;
  return true;
}
function groupChunk(packet, group) {
  const range = packet.ownerRanges[group.key];
  if (range === undefined) return {segments: [], startsEnds:new Float32Array(),
    chainPhase:new Float32Array(), count:0};
  if (!Number.isInteger(range.first) || !Number.isInteger(range.count) ||
    range.first < 0 || range.count < 0 || range.first + range.count > packet.segments.length)
    throw error('invalid native owner range');
  const first = range.first, end = first + range.count;
  return {count:range.count, segments:packet.segments.slice(first,end),
    startsEnds:packet.startsEnds.slice(first*4,end*4),
    chainPhase:packet.chainPhase.slice(first,end)};
}
function cacheEntry(group, coords, chunk) {
  return {names:group.names, coords, chunk,
    bytes:coords.byteLength + chunk.startsEnds.byteLength + chunk.chainPhase.byteLength
      + chunk.count * 160 + group.key.length * 2 + 96};
}
function compose(groups) {
  let total=0;
  for (const group of groups) total += group.chunk.count;
  const packet={segments:new Array(total),startsEnds:new Float32Array(total*4),
    chainPhase:new Float32Array(total),ownerRanges:{},ownerIds:[]};
  const seen=new Set();
  let at=0;
  for (const group of groups) {
    const chunk=group.chunk;
    if (!chunk.count) continue;
    packet.ownerRanges[group.key]={first:at,count:chunk.count};
    for(const id of group.owners) if(!seen.has(id)) {
      seen.add(id);
      packet.ownerIds.push(id);
    }
    for(let index=0;index<chunk.count;index++)packet.segments[at+index]=chunk.segments[index];
    packet.startsEnds.set(chunk.startsEnds,at*4);
    packet.chainPhase.set(chunk.chainPhase,at);
    at += chunk.count;
  }
  return packet;
}

/**
 * @param {Array} ordered Sorted source strokes (unchanged from original path).
 * @param {number} quality Canonical stroke subdivision angle.
 * @param {Function} nativeAssemble Verified C++/WASM boundary assembler.
 * @param {object|null} prior Only the previous Worker prepared-store cache.
 * @param {Function|null} profile Optional per-stage non-mutating callback.
 */
export function assembleStrokeWithGroupReuse(ordered,quality,nativeAssemble,prior=null,profile=null) {
  const native = rows => nativeAssemble(rows, quality);
  const toSource = rows => rows.map(row=>[row.start,row.end,row.ownerIds]);
  const measure = (name,run,details) => {
    if (typeof profile !== 'function') return run();
    const started=performance.now();
    try {return run();}
    finally {profile(name,performance.now()-started,details);}
  };
  const {groups,ambiguous}=groupsFor(ordered);
  // Keep C++ as the sole validator for malformed or collision-prone sources.
  // An empty input, duplicate native owner key or excess segment count must
  // retain exactly the original validation and return contract.
  if (!ordered.length || ambiguous || ordered.length > 1_000_000) {
    return {packet:measure('wasm-bridge',()=>native(toSource(ordered)),
      {inputSegments:ordered.length}), cache:null, reusedGroups:0,assembledGroups:groups.length};
  }
  const previous=prior?.quality===quality ? prior.groups : null;
  const changed=[];
  for (const group of groups) {
    group.coords=snapshot(group);
    const old=group.coords && previous?.get(group.key);
    if (old && old.names === group.names && equalCoordinates(old.coords,group.coords)) {
      group.chunk=old.chunk;
    } else changed.push(group);
  }
  const reusedGroups=groups.length-changed.length;
  const source=changed.flatMap(group=>toSource(group.rows));
  const assembled=measure('wasm-bridge',()=>changed.length?native(source):null,
    {inputSegments:source.length, reusedGroups, assembledGroups:changed.length});
  if (assembled) for (const group of changed) group.chunk=groupChunk(assembled,group);
  const packet=!reusedGroups ? assembled : measure('join-group-chunks',()=>compose(groups),
    {segments:groups.reduce((sum,group)=>sum+group.chunk.count,0),groups:groups.length});
  // Retain at most one immediately previous packet's group fragments, up to
  // the independently bounded budget. Never preserve a growing date history.
  const next=new Map();
  let bytes=0;
  for (const group of groups) {
    if (!group.coords) continue;
    const entry=cacheEntry(group,group.coords,group.chunk);
    if (bytes+entry.bytes > DEFAULT_BUDGET) continue;
    next.set(group.key,entry);
    bytes+=entry.bytes;
  }
  if (typeof profile==='function') profile('group-reuse',0,{
    totalGroups:groups.length,reusedGroups,assembledGroups:changed.length,
    reusedInputSegments:groups.filter(group=>!changed.includes(group))
      .reduce((sum,group)=>sum+group.rows.length,0),
    nativeInputSegments:source.length,retainedBytes:bytes});
  return {packet,cache:{quality,groups:next,bytes},reusedGroups,assembledGroups:changed.length};
}
