import { createBoundarySpatialIndex } from '../geometry/boundary-spatial-index.js';

const RENDER_LOD_LEVELS = Object.freeze({
  COARSE: 'coarse',
  MEDIUM: 'medium',
  HIGH: 'high',
});

function finiteCoordinate(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function cloneCoordinate(value) {
  return [Number(value[0]), Number(value[1])];
}

function hasDatelineJump(coordinates) {
  for (let index = 1; index < coordinates.length; index += 1) {
    if (Math.abs(Number(coordinates[index][0]) - Number(coordinates[index - 1][0])) > 180) return true;
  }
  return false;
}

function distanceToSegmentSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  const x = start[0] + ratio * dx;
  const y = start[1] + ratio * dy;
  return (point[0] - x) ** 2 + (point[1] - y) ** 2;
}

function simplifyOpenLine(coordinates, tolerance) {
  if (coordinates.length <= 2 || tolerance <= 0 || hasDatelineJump(coordinates)) return coordinates.map(cloneCoordinate);
  const threshold = tolerance * tolerance;
  const keep = new Uint8Array(coordinates.length);
  keep[0] = keep[coordinates.length - 1] = 1;
  const stack = [[0, coordinates.length - 1]];
  while (stack.length) {
    const [startIndex, endIndex] = stack.pop();
    let furthest = -1;
    let maximum = threshold;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = distanceToSegmentSquared(coordinates[index], coordinates[startIndex], coordinates[endIndex]);
      if (distance > maximum) {
        maximum = distance;
        furthest = index;
      }
    }
    if (furthest < 0) continue;
    keep[furthest] = 1;
    stack.push([startIndex, furthest], [furthest, endIndex]);
  }
  return coordinates.filter((_coordinate, index) => keep[index]).map(cloneCoordinate);
}

function densifyLine(coordinates, maxEdgeDegrees) {
  if (!(maxEdgeDegrees > 0) || coordinates.length < 2) return coordinates;
  const result = [cloneCoordinate(coordinates[0])];
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    let deltaLongitude = Number(end[0]) - Number(start[0]);
    while (deltaLongitude > 180) deltaLongitude -= 360;
    while (deltaLongitude < -180) deltaLongitude += 360;
    const deltaLatitude = Number(end[1]) - Number(start[1]);
    const steps = Math.max(1, Math.ceil(Math.hypot(deltaLongitude, deltaLatitude) / maxEdgeDegrees));
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      let longitude = Number(start[0]) + deltaLongitude * ratio;
      while (longitude > 180) longitude -= 360;
      while (longitude < -180) longitude += 360;
      result.push([longitude, Number(start[1]) + deltaLatitude * ratio]);
    }
  }
  return result;
}

function simplifyLine(coordinates, tolerance, { maxEdgeDegrees = 0 } = {}) {
  const source = (coordinates || []).filter(finiteCoordinate).map(cloneCoordinate);
  if (!source.length) return [];
  return densifyLine(simplifyOpenLine(source, tolerance), maxEdgeDegrees);
}

export function resolveRenderLod({ requested = 'high', policy = 'exact', protected: protectedGeometry = false } = {}) {
  if (protectedGeometry || policy !== 'independent') return RENDER_LOD_LEVELS.HIGH;
  return Object.values(RENDER_LOD_LEVELS).includes(requested) ? requested : RENDER_LOD_LEVELS.HIGH;
}

export function simplifyRenderGeometry(geometry, {
  lod = RENDER_LOD_LEVELS.HIGH,
  policy = 'exact',
  projection = 'flat',
} = {}) {
  const level = resolveRenderLod({ requested: lod, policy });
  if (!geometry || level === RENDER_LOD_LEVELS.HIGH || policy !== 'independent') return geometry;
  // Independent ring reduction can move holes outside their shell or create crossings.
  // Preserve polygon topology; the common mesh engine refines its interior edges.
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return geometry;
  const tolerance = level === RENDER_LOD_LEVELS.COARSE ? 0.075 : 0.018;
  const maxEdgeDegrees = projection === 'globe' ? (level === RENDER_LOD_LEVELS.COARSE ? 4 : 2.5) : 0;
  const line = coordinates => simplifyLine(coordinates, tolerance, { maxEdgeDegrees });
  if (geometry.type === 'LineString') return { type: 'LineString', coordinates: line(geometry.coordinates) };
  if (geometry.type === 'MultiLineString') return {
    type: 'MultiLineString', coordinates: (geometry.coordinates || []).map(line).filter(part => part.length >= 2),
  };
  return geometry;
}


/**
 * A display-only, source-revision-owned shared arc index. Matching reverse
 * country borders reuse one vertex-importance sequence. The screen error is
 * conservatively bounded in both flat and orthographic globe projections.
 */
const RADIANS_PER_LOD_DEGREE = Math.PI / 180;
export const MAX_MAP_GEOMETRY_ERROR_PX = 0.5;

function lodNodeKey(coordinate) {
  // Numeric source identity, not a spatial snapping tolerance. In particular,
  // distinct sub-decimal vertices may bound real islands or narrow holes.
  return `${Number(coordinate[0])},${Number(coordinate[1])}`;
}
function lodCartesian([longitude, latitude]) {
  const lon = longitude * RADIANS_PER_LOD_DEGREE;
  const lat = latitude * RADIANS_PER_LOD_DEGREE;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}
function lodPointSegmentSquared(point, start, end) {
  const dx=end[0]-start[0],dy=end[1]-start[1],dz=end[2]-start[2];
  const px=point[0]-start[0],py=point[1]-start[1],pz=point[2]-start[2];
  const length=dx*dx+dy*dy+dz*dz;
  const t=length?Math.max(0,Math.min(1,(dx*px+dy*py+dz*pz)/length)):0;
  return (px-t*dx)**2+(py-t*dy)**2+(pz-t*dz)**2;
}
function lodVertexImportance(points) {
  const importance = new Float64Array(points.length);
  importance[0] = importance[points.length - 1] = Infinity;
  const unit = points.map(lodCartesian);
  const stack = [[0, points.length - 1, Infinity]];
  while (stack.length) {
    const [first, last, cap] = stack.pop();
    let maximum = 0, furthest = -1;
    for (let index = first + 1; index < last; index += 1) {
      const flat = distanceToSegmentSquared(points[index], points[first], points[last])
        * RADIANS_PER_LOD_DEGREE ** 2;
      const globe = lodPointSegmentSquared(unit[index], unit[first], unit[last]);
      const candidate = Math.sqrt(Math.max(flat, globe));
      if (candidate > maximum) { maximum = candidate; furthest = index; }
    }
    if (furthest < 0 || !maximum) continue;
    const significance = Math.min(cap, maximum);
    importance[furthest] = significance;
    stack.push([first, furthest, significance], [furthest, last, significance]);
  }
  return importance;
}
function lodSignedArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index], b = points[(index + 1) % points.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

// Contract the shared graph once, in a monotone order. Every admitted removal
// preserves the active graph and accounts for all original points along its
// replacement chord. Selecting a tolerance therefore selects a prefix of this
// certified contraction sequence, rather than independently repairing rings.
function protectLodHierarchy(nodes, edges, rings, protectedRings, onProgress) {
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const on = (a,b,p) => cross(a,b,p)===0 && p[0]>=Math.min(a[0],b[0])
    && p[0]<=Math.max(a[0],b[0]) && p[1]>=Math.min(a[1],b[1]) && p[1]<=Math.max(a[1],b[1]);
  const intersects = (a,b,c,d) => {
    const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
    return Math.sign(abC)*Math.sign(abD)<0 && Math.sign(cdA)*Math.sign(cdB)<0
      || abC===0&&on(a,b,c) || abD===0&&on(a,b,d) || cdA===0&&on(c,d,a) || cdB===0&&on(c,d,b);
  };
  const insideTriangle = (p,a,b,c) => {
    const ab=cross(a,b,p),bc=cross(b,c,p),ca=cross(c,a,p);
    return ab>=0&&bc>=0&&ca>=0||ab<=0&&bc<=0&&ca<=0;
  };
  const graph=new Map(),grid=new Map(),pointGrid=new Map(),overflow=new Set();
  const keyFor=(a,b)=>a<b?`${a}|${b}`:`${b}|${a}`;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const node of nodes.values()){
    minX=Math.min(minX,node.point[0]);maxX=Math.max(maxX,node.point[0]);
    minY=Math.min(minY,node.point[1]);maxY=Math.max(maxY,node.point[1]);
  }
  // A five-degree bucket degenerates to an all-pairs check on a dense coast.
  // Fit the spatial index to source density; this changes candidate lookup,
  // never the exact-coordinate identity or the admissible simplification.
  const cellSize=Math.max(1e-7,Math.min(.25,
    Math.sqrt(Math.max(1e-14,(maxX-minX)*(maxY-minY))/Math.max(1,nodes.size))*2));
  const cells=points=>{
    const west=Math.floor(Math.min(...points.map(p=>p[0]))/cellSize),east=Math.floor(Math.max(...points.map(p=>p[0]))/cellSize);
    const south=Math.floor(Math.min(...points.map(p=>p[1]))/cellSize),north=Math.floor(Math.max(...points.map(p=>p[1]))/cellSize);
    if((east-west+1)*(north-south+1)>4096)return null;
    const result=[];for(let x=west;x<=east;x++)for(let y=south;y<=north;y++)result.push(`${x}:${y}`);
    return result;
  };
  for(const [key,node] of nodes){
    node.active=true;node.rank=node.sourceProtected?Infinity:0;node.finalRank=Infinity;node.refs=[];
    node.unit=lodCartesian(node.point);
    node.links=new Map();
    const cell=cells([node.point])[0];if(!pointGrid.has(cell))pointGrid.set(cell,new Set());pointGrid.get(cell).add(key);
  }
  for(const ring of rings){
    ring.remaining=ring.points.length;ring.currentArea=ring.originalArea;
    ring.previous=ring.points.map((_,i)=>(i+ring.points.length-1)%ring.points.length);
    ring.next=ring.points.map((_,i)=>(i+1)%ring.points.length);
    const repeated=new Set();
    ring.keys.forEach((key,index)=>{
      const node=nodes.get(key);node.rank=Math.max(node.rank,ring.importance[index]);
      if(ring.points.length<=4||repeated.has(key))node.rank=Infinity;
      node.refs.push({ring,index});repeated.add(key);
    });
  }
  const addEdge=(a,b,sources,signature)=>{
    const key=keyFor(a,b),entry={key,a,b,sources,signature,cells:cells([nodes.get(a).point,nodes.get(b).point])};
    graph.set(key,entry);nodes.get(a).links.set(b,entry);nodes.get(b).links.set(a,entry);
    if(entry.cells)for(const cell of entry.cells){if(!grid.has(cell))grid.set(cell,new Set());grid.get(cell).add(entry);}
    else overflow.add(entry);
  };
  const removeEdge=entry=>{
    graph.delete(entry.key);nodes.get(entry.a).links.delete(entry.b);nodes.get(entry.b).links.delete(entry.a);
    if(entry.cells)for(const cell of entry.cells)grid.get(cell).delete(entry);else overflow.delete(entry);
  };
  for(const [key,edge] of edges){const [a,b]=key.split('|');addEdge(a,b,[nodes.get(a),nodes.get(b)],edge.signature);}
  let threshold=0,protectedCount=0;
  const candidates=[...nodes.entries()].filter(([,node])=>Number.isFinite(node.rank))
    .sort((a,b)=>a[1].rank-b[1].rank||a[0].localeCompare(b[0]));
  const fixedEdges=[];
  const fixedIndex=createBoundarySpatialIndex();
  if(candidates.length&&protectedRings.length){
    const boxes=[];
    for(const ring of protectedRings)for(let i=0;i<ring.points.length;i++){
      const a=ring.points[i],b=ring.points[(i+1)%ring.points.length];
      fixedEdges.push({a,b});
      boxes.push([Math.min(a[0],b[0])*4,Math.min(a[1],b[1])*4,
        Math.max(a[0],b[0])*4,Math.max(a[1],b[1])*4]);
    }
    fixedIndex.loadPacked(fixedEdges,boxes);
  }
  const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  for(let candidateIndex=0;candidateIndex<candidates.length;candidateIndex++){
    if(candidateIndex%4096===0)onProgress({phase:'topology-progress',completed:candidateIndex,total:candidates.length});
    const [key,node]=candidates[candidateIndex];
    if(node.links.size!==2){protectedCount++;continue;}
    const [a,b]=[...node.links.keys()],first=node.links.get(a),second=node.links.get(b);
    const pa=nodes.get(a).point,pb=nodes.get(b).point,p=node.point;
    if(first.signature!==second.signature||graph.has(keyFor(a,b))){protectedCount++;continue;}
    const changes=node.refs.map(({ring,index})=>{
      const previous=ring.previous[index],next=ring.next[index],before=ring.points[previous],after=ring.points[next];
      return {ring,index,previous,next,area:ring.currentArea-cross(before,p,after)};
    });
    if(changes.some(change=>change.ring.remaining<=3||Math.sign(change.area)!==Math.sign(change.ring.originalArea))){protectedCount++;continue;}
    const occupied=cells([pa,p,pb]);
    let safe=true;
    const visitEdge=edge=>{
      if(edge.visited===candidateIndex+1||edge===first||edge===second)return;
      edge.visited=candidateIndex+1;
      const c=nodes.get(edge.a).point,d=nodes.get(edge.b).point;
      if(Math.max(c[0],d[0])<Math.min(pa[0],pb[0])||Math.min(c[0],d[0])>Math.max(pa[0],pb[0])
        ||Math.max(c[1],d[1])<Math.min(pa[1],pb[1])||Math.min(c[1],d[1])>Math.max(pa[1],pb[1])
        ||!intersects(pa,pb,c,d))return;
      // Existing endpoint adjacency is legal; new overlap or a T contact is not.
      const shared=edge.a===a||edge.a===b||edge.b===a||edge.b===b;
      if(!shared || cross(pa,pb,c)===0&&cross(pa,pb,d)===0)safe=false;
    };
    if(occupied){
      for(const edge of overflow){visitEdge(edge);if(!safe)break;}
      for(const cell of occupied){
        if(!safe)break;
        for(const edge of grid.get(cell)||[]){visitEdge(edge);if(!safe)break;}
      }
    }else{
      for(const edge of graph.values()){visitEdge(edge);if(!safe)break;}
    }
    if(safe&&fixedEdges.length){
      const bounds=[Math.min(pa[0],p[0],pb[0])*4,Math.min(pa[1],p[1],pb[1])*4,
        Math.max(pa[0],p[0],pb[0])*4,Math.max(pa[1],p[1],pb[1])*4];
      for(const {a:c,b:d} of fixedIndex.query(bounds)){
        const shared=same(c,pa)||same(c,pb)||same(d,pa)||same(d,pb);
        if(intersects(pa,pb,c,d)&&(!shared||cross(pa,pb,c)===0&&cross(pa,pb,d)===0)){
          safe=false;break;
        }
        if(cross(pa,p,pb)!==0&&[c,d].some(point=>!same(point,pa)&&!same(point,pb)
          &&insideTriangle(point,pa,p,pb))){safe=false;break;}
      }
    }
    if(safe&&cross(pa,p,pb)!==0){
      const visitPoint=other=>{
        if(other!==key&&other!==a&&other!==b&&nodes.get(other).active
          &&insideTriangle(nodes.get(other).point,pa,p,pb))safe=false;
      };
      if(occupied)for(const cell of occupied){
        if(!safe)break;
        for(const other of pointGrid.get(cell)||[]){visitPoint(other);if(!safe)break;}
      }
      else for(const other of nodes.keys()){visitPoint(other);if(!safe)break;}
    }
    if(!safe){protectedCount++;continue;}
    const sources=[...first.sources,...second.sources],unitA=nodes.get(a).unit,unitB=nodes.get(b).unit;
    let deviation=0;
    for(const source of sources)deviation=Math.max(deviation,
      Math.sqrt(distanceToSegmentSquared(source.point,pa,pb))*RADIANS_PER_LOD_DEGREE,
      Math.sqrt(lodPointSegmentSquared(source.unit,unitA,unitB)));
    threshold=Math.max(threshold,node.rank,deviation);node.finalRank=threshold;
    for(const change of changes){change.ring.currentArea=change.area;change.ring.remaining--;
      change.ring.next[change.previous]=change.next;change.ring.previous[change.next]=change.previous;}
    node.active=false;
    pointGrid.get(cells([p])[0]).delete(key);
    removeEdge(first);removeEdge(second);addEdge(a,b,sources,first.signature);
  }
  for(const ring of rings)ring.keys.forEach((key,index)=>{ring.importance[index]=nodes.get(key).finalRank;});
  return protectedCount;
}

/**
 * Buckets represent an upper bound on cssScale, never the rounded-down scale.
 * Increases take effect immediately; 15% hysteresis applies only to zoom-out.
 */
export function resolveScreenLodBucket({ cssScale, previous = null,
  errorPx = MAX_MAP_GEOMETRY_ERROR_PX, policy = null, sourceHash = '',
  scalePixelsPerMeter = null } = {}) {
  if (!Number.isFinite(cssScale) || cssScale <= 0 || !Number.isFinite(errorPx) || errorPx <= 0)
    throw new TypeError('Screen LOD needs positive CSS scale and pixel error.');
  const step = Math.SQRT2;
  const target = Math.pow(2, Math.ceil(Math.log2(cssScale) * 2) / 2);
  const policyKey = policy ? JSON.stringify(policy) : 'screen';
  const keep = previous?.policyKey === policyKey && previous?.upperScale >= cssScale && cssScale > previous.upperScale / step * 0.85;
  const upperScale = keep ? previous.upperScale : target;
  if (policy !== null) {
    if (!/^[a-f0-9]{64}$/.test(policy.sourceHash) || policy.sourceHash !== sourceHash)
      throw new TypeError('LOD policy source hash does not match the admitted source.');
    if (typeof policy.algorithmVersion !== 'string' || !policy.algorithmVersion
      || ![policy.referenceScale, policy.referenceToleranceMeters, policy.minimumToleranceMeters,
        scalePixelsPerMeter].every(value => Number.isFinite(value) && value > 0)
      || policy.minimumToleranceMeters > policy.referenceToleranceMeters)
      throw new TypeError('Invalid calibrated LOD tolerance policy.');
    const requested = policy.referenceToleranceMeters * policy.referenceScale / scalePixelsPerMeter;
    const toleranceMeters = Math.max(requested, policy.minimumToleranceMeters);
    // The current angular hierarchy has a conservative unit-sphere/flat metric.
    // This conversion is a display policy, not an LSIB AEQD calibration claim.
    const toleranceRadians = toleranceMeters / 6371008.8;
    return Object.freeze({upperScale, policyKey, toleranceMeters, toleranceRadians,
      errorPx: toleranceRadians * upperScale, detailLimited: requested < policy.minimumToleranceMeters,
      capped: true, key: `${policyKey}:${toleranceMeters}`});
  }
  return Object.freeze({ upperScale, errorPx, toleranceRadians: errorPx / upperScale,
    policyKey, capped: false, key: `${upperScale}:${errorPx}` });
}

/**
 * Bound spherical mesh chord/sagitta deviation independently of boundary DP.
 * Unlike a fixed world-wide 0.499-degree subdivision, this creates fewer
 * interior triangles at small screen scales without changing source geometry.
 */
export function resolveScreenLodEdgeDegrees({
  cssScale, errorPx = MAX_MAP_GEOMETRY_ERROR_PX,
  minDegrees = 0.499, maxDegrees = 8,
} = {}) {
  if (!Number.isFinite(cssScale) || cssScale <= 0 || !Number.isFinite(errorPx)
    || errorPx <= 0 || !Number.isFinite(minDegrees) || minDegrees <= 0
    || !Number.isFinite(maxDegrees) || maxDegrees < minDegrees)
    throw new TypeError('Invalid screen LOD tessellation budget.');
  const permittedSagitta = Math.min(2, errorPx / cssScale);
  const angleRadians = 2 * Math.acos(1 - permittedSagitta);
  return Math.max(minDegrees, Math.min(maxDegrees, angleRadians / RADIANS_PER_LOD_DEGREE));
}

export function createSharedPolygonLodIndex(features, { onProgress = () => {} } = {}) {
  if (!Array.isArray(features))
    throw new TypeError('Shared polygon LOD requires features.');
  const preparationStarted = performance.now();
  const preparationPhases = {};
  let phaseStarted = preparationStarted;
  const phase = name => {
    preparationPhases[name] = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    onProgress({ phase: name, durationMs: preparationPhases[name] });
  };
  const nodes = new Map(), edges = new Map(), allRings = [], sharedArcs = new Map();
  const protectedRings = [];
  const featureIds = new Set();
  function requireNode(coordinate) {
    if (!finiteCoordinate(coordinate)) throw new TypeError('Invalid source polygon coordinate.');
    const key = lodNodeKey(coordinate);
    if (!nodes.has(key)) nodes.set(key, { point: cloneCoordinate(coordinate), neighbors: new Set(), owners: new Set() });
    return key;
  }
  const byFeature = features.map((feature, featureIndex) => {
    const id = String(feature?.id ?? featureIndex), geometry = feature?.geometry;
    if (featureIds.has(id)) throw new TypeError('Shared polygon LOD requires unique source IDs.');
    featureIds.add(id);
    if (geometry && !['Polygon', 'MultiPolygon'].includes(geometry.type))
      throw new TypeError('Country LOD accepts only polygon geometry.');
    const polygons = !geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map((polygon, polygonIndex) => polygon.map((ring, ringIndex) => {
      if (!Array.isArray(ring) || ring.length < 4 || !finiteCoordinate(ring[0])
        || !finiteCoordinate(ring[ring.length - 1])
        || lodNodeKey(ring[0]) !== lodNodeKey(ring.at(-1)))
        throw new TypeError('Country polygon LOD requires closed rings.');
      const points = ring.slice(0, -1);
      const protectedRing=polygon.length>1||ringIndex>0||hasDatelineJump(ring)
        ||points.some(point=>Math.abs(point[1])>=85);
      if(protectedRing){
        const unique=new Set();
        for(let index=0;index<points.length;index++){
          const point=points[index],next=points[(index+1)%points.length];
          if(!finiteCoordinate(point))throw new TypeError('Invalid source polygon coordinate.');
          if(point[0]===next[0]&&point[1]===next[1])throw new TypeError('Duplicated polygon edge.');
          if(unique.size<3)unique.add(lodNodeKey(point));
        }
        if(unique.size<3)throw new TypeError('Invalid polygon ring.');
        const info={id,polygonIndex,ringIndex,points,protected:true};
        protectedRings.push(info);allRings.push(info);return info;
      }
      const keys = points.map(requireNode);
      if (new Set(keys).size < 3) throw new TypeError('Invalid polygon ring.');
      const edgeKeys = keys.map((key, index) => {
        const next = keys[(index + 1) % keys.length];
        if (key === next) throw new TypeError('Duplicated polygon edge.');
        nodes.get(key).owners.add(id);
        nodes.get(key).neighbors.add(next); nodes.get(next).neighbors.add(key);
        const edgeKey = key < next ? `${key}|${next}` : `${next}|${key}`;
        if (!edges.has(edgeKey)) edges.set(edgeKey, { owners: new Set() });
        edges.get(edgeKey).owners.add(id);
        return edgeKey;
      });
      const info = { id, polygonIndex, ringIndex, points, keys, edgeKeys,
        originalArea: lodSignedArea(points), importance: new Float64Array(points.length),
        protected: false };
      allRings.push(info);
      return info;
    }));
  });
  // Immutable protected rings need neither adjacency Sets nor contraction
  // nodes. Only matching mutable source nodes inherit their fixed protection.
  if(nodes.size)for(const ring of protectedRings)for(const point of ring.points){
    const node=nodes.get(lodNodeKey(point));
    if(node)node.sourceProtected=true;
  }
  for (const edge of edges.values()) edge.signature = [...edge.owners].sort().join('|');
  phase('source-graph');
  for (const info of allRings) {
    if(info.protected)continue;
    const { points, keys, edgeKeys, importance } = info;
    const anchors = new Set();
    for (let index = 0; index < keys.length; index += 1) {
      const node = nodes.get(keys[index]);
      const before = edges.get(edgeKeys[(index + keys.length - 1) % keys.length]);
      const after = edges.get(edgeKeys[index]);
      if (node.neighbors.size !== 2 || node.owners.size >= 3 || before.signature !== after.signature)
        anchors.add(index);
    }
    if (anchors.size < 3) {
      // Add anchors on private coastlines first; never split a shared arc on
      // just one side merely to meet the three-vertex ring minimum.
      const candidates = keys.map((key, index) => ({ key, index }))
        .filter(({ index }) => edges.get(edgeKeys[index]).owners.size === 1
          && edges.get(edgeKeys[(index + keys.length - 1) % keys.length]).owners.size === 1)
        .sort((a, b) => a.key.localeCompare(b.key) || a.index - b.index);
      for (const { index } of candidates) {
        anchors.add(index);
        if (anchors.size >= 3) break;
      }
    }
    const ordered = [...anchors].sort((a, b) => a - b);
    if (!ordered.length) { importance.fill(Infinity); continue; }
    for (const index of ordered) importance[index] = Infinity;
    for (let anchor = 0; anchor < ordered.length; anchor += 1) {
      const start = ordered[anchor], end = ordered[(anchor + 1) % ordered.length];
      const path = [start];
      for (let pos = (start + 1) % keys.length; pos !== end; pos = (pos + 1) % keys.length)
        path.push(pos);
      path.push(end);
      if (path.length <= 2) continue;
      const forward = keys[start] < keys[end];
      const canonical = forward ? path : [...path].reverse();
      const arcKey = canonical.map(index => keys[index]).join(';');
      let ranked = sharedArcs.get(arcKey);
      if (!ranked) {
        ranked = lodVertexImportance(canonical.map(index => points[index]));
        sharedArcs.set(arcKey, ranked);
      }
      for (let offset = 1; offset < path.length - 1; offset++) {
        const rank = forward ? offset : path.length - 1 - offset;
        importance[path[offset]] = ranked[rank];
      }
    }
  }
  phase('importance');
  const graphVertexCount=nodes.size;
  // Shared-arc construction has finished with these Sets. Release them before
  // building mutable links instead of retaining two adjacency representations.
  for(const node of nodes.values()){node.neighbors=null;node.owners=null;}
  const topologyProtectedCount=protectLodHierarchy(nodes,edges,allRings.filter(ring=>!ring.protected),protectedRings,onProgress);
  phase('topology');
  const arcCount = sharedArcs.size;
  // Only original-index importance and shared edge ownership are needed during
  // display selection. Release the temporary contraction graph after preparing.
  nodes.clear();
  sharedArcs.clear();
  for (const ring of allRings) {
    delete ring.previous; delete ring.next;
    delete ring.remaining; delete ring.currentArea;
  }
  const preparationMs=performance.now()-preparationStarted;
  function derive({ cssScale, errorPx = MAX_MAP_GEOMETRY_ERROR_PX,
    visibleIds = null, capped = false } = {}) {
    if (!Number.isFinite(cssScale) || cssScale <= 0 || !Number.isFinite(errorPx) || errorPx <= 0)
      throw new TypeError('Invalid LOD screen scale or pixel error.');
    const tolerance = errorPx / cssScale;
    const visibleSet = visibleIds === null ? null : new Set([...visibleIds].map(String));
    let invalid = false, originalVertices = 0, keptVertices = 0;
    const sourceIndices=[];
    const sharedSegments = new Map();
    const output = features.map((feature, index) => {
      const featureId = String(feature?.id ?? index);
      if (visibleSet && !visibleSet.has(featureId)) {
        sourceIndices[index]=null;
        originalVertices += byFeature[index].reduce((count, polygon) =>
          count + polygon.reduce((sum, ring) => sum + ring.points.length, 0), 0);
        return { ...feature, geometry: null };
      }
      sourceIndices[index]=[];
      const polygons = byFeature[index].map((polygon,polygonIndex) => polygon.map((info,ringIndex) => {
        sourceIndices[index][polygonIndex] ||= [];
        originalVertices += info.points.length;
        if(info.protected){
          const indices=info.points.map((_,i)=>i);
          sourceIndices[index][polygonIndex][ringIndex]=[...indices,0];
          keptVertices+=info.points.length;
          return [...info.points.map(cloneCoordinate),cloneCoordinate(info.points[0])];
        }
        const indices = [];
        for (let i = 0; i < info.points.length; i++)
          if (info.importance[i] >= tolerance) indices.push(i);
        // Topology protection was fixed when the hierarchy was prepared.
        // A failure here is not permission to increase detail at runtime.
        const initial = indices.map(i => info.points[i]);
        if (initial.length < 3
          || Math.sign(lodSignedArea(initial)) !== Math.sign(info.originalArea)) {
          throw Object.assign(new Error('Selected ring violates the certified LOD hierarchy.'),
            { code: 'PL-LOD-TOPOLOGY' });
        }
        const selected = indices.map(i => info.points[i]);
        sourceIndices[index][polygonIndex][ringIndex]=[...indices,indices[0]];
        keptVertices += selected.length;
        // A shared source chain must be represented by the same new segment
        // in every country that owns it. Abort the complete derivative if a
        // different ring cut or a protected neighbor causes a seam mismatch.
        for (let j = 0; j < indices.length; j++) {
          const from = indices[j], to = indices[(j + 1) % indices.length];
          const edge = edges.get(info.edgeKeys[from]);
          const owners = [...edge.owners].filter(id => !visibleSet || visibleSet.has(id));
          if (owners.length < 2) continue;
          let current = from, consistent = true;
          do {
            if (edges.get(info.edgeKeys[current]).signature !== edge.signature) {
              consistent = false; break;
            }
            current = (current + 1) % info.points.length;
          } while (current !== to);
          if (!consistent) { invalid = true; continue; }
          const firstKey = info.keys[from], secondKey = info.keys[to];
          const segmentKey = firstKey < secondKey
            ? `${firstKey};${secondKey}` : `${secondKey};${firstKey}`;
          const key = `${edge.signature}:${segmentKey}`;
          if (!sharedSegments.has(key)) sharedSegments.set(key, {
            expected: new Set(owners), actual: new Set(),
          });
          sharedSegments.get(key).actual.add(info.id);
        }
        return [...selected.map(cloneCoordinate), cloneCoordinate(selected[0] || info.points[0])];
      }));
      const type = feature?.geometry?.type;
      return { ...feature, geometry: !type ? null : { type,
        coordinates: type === 'Polygon' ? polygons[0] : polygons } };
    });
    for (const { expected, actual } of sharedSegments.values())
      if (expected.size !== actual.size || [...expected].some(id => !actual.has(id))) {
        invalid = true;
        break;
      }
    // Never restore only one country of a shared arc: fail closed as a frame.
    if(invalid)throw Object.assign(new Error(`No topology-certified ${capped?'capped ':''}LOD satisfies the selected detail policy.`),{code:'PL-LOD-TOPOLOGY'});
    return Object.freeze({ features: output, sourceIndices, fallback: false,
      originalVertices, keptVertices,
      visibleCountryCount: visibleSet ? output.filter(feature => !!feature.geometry).length : features.length,
      scoped: !!visibleSet });
  }
  return Object.freeze({ derive, stats: () => Object.freeze({
    featureCount: features.length, ringCount: allRings.length,
    vertexCount: allRings.reduce((sum, ring) => sum + ring.points.length, 0),
    sharedEdgeCount: [...edges.values()].filter(edge => edge.owners.size > 1).length,
    arcCount,
    topologyProtectedCount,
    graphVertexCount,
    immutableProtectedVertexCount:protectedRings.reduce((sum,ring)=>sum+ring.points.length,0),
    preparationMs,
    preparationPhases: Object.freeze({ ...preparationPhases }),
  }) });
}


/**
 * Derive only the visible internal geographic cells of a large country.
 * The supplied intersection capability is the application's compiled
 * polygon engine. Tile boundaries are on a common global integer grid;
 * source geometry, editing and picking never consume these derivatives.
 * Any incomplete/invalid clip aborts the derivative (canonical keeps showing).
 *
 * The cache is owned by the existing mesh Worker and keyed by source revision,
 * zoom bucket and tile. Moving the camera reuses unchanged prepared cells.
 */
export function tileLargePolygonLodFeatures(features, visibleTiles, {
  intersection, sourceKey, lodKey, tileDegrees = 5,
  minimumVertices = 4, cache = new Map(), maxCachedTiles = 128,
} = {}) {
  if (!Array.isArray(features) || !Array.isArray(visibleTiles)
    || typeof intersection !== 'function' || !sourceKey || !lodKey
    || !Number.isInteger(180 / tileDegrees) || tileDegrees <= 0)
    throw new TypeError('Screen tile LOD requires source, grid and compiled clipping.');
  const byId = new Map(visibleTiles.map(row => [String(row.id), row.tiles]));
  let tiledCountryCount = 0, tilesPrepared = 0, tilesReused = 0;
  const result = features.map(feature => {
    const tiles = byId.get(String(feature.id));
    const geometry = feature.geometry;
    if (!tiles?.length || !geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type))
      return feature;
    const sourcePolygons = geometry.type === 'Polygon'
      ? [geometry.coordinates] : geometry.coordinates;
    const polygonBounds = sourcePolygons.map(polygon => {
      let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
      let vertices = 0;
      for (const ring of polygon) for (const point of ring) {
        if (!finiteCoordinate(point)) throw new TypeError('Invalid polygon tile coordinate.');
        west = Math.min(west, point[0]); east = Math.max(east, point[0]);
        south = Math.min(south, point[1]); north = Math.max(north, point[1]);
        vertices++;
      }
      return { west, east, south, north, vertices };
    });
    const sourceVertices = polygonBounds.reduce((sum, box) => sum + box.vertices, 0);
    if (sourceVertices < minimumVertices) return feature;
    if (sourcePolygons.some(polygon => polygon.some(ring =>
      hasDatelineJump(ring) || ring.some(point => Math.abs(point[1]) >= 85)))) return feature;
    const parts = [];
    const sorted = [...tiles].sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
    for (const tile of sorted) {
      if (!Array.isArray(tile) || tile.length !== 2
        || !tile.every(Number.isInteger)) throw new TypeError('Invalid geographic tile key.');
      const [x, y] = tile, west = x * tileDegrees, south = y * tileDegrees;
      const east = west + tileDegrees, north = south + tileDegrees;
      if (west < -180 || east > 180 || south < -90 || north > 90)
        throw new TypeError('Geographic tile is outside the legal world bounds.');
      const intersecting = sourcePolygons.filter((_polygon, i) => {
        const box = polygonBounds[i];
        return box.east >= west && box.west <= east
          && box.north >= south && box.south <= north;
      });
      if (!intersecting.length) continue;
      const key = `${sourceKey}:${lodKey}:${String(feature.id)}:${x}:${y}`;
      let clipped = cache.get(key);
      if (clipped) {
        cache.delete(key); cache.set(key, clipped);
        tilesReused++;
      } else {
        const rectangle = [[west, south], [east, south],
          [east, north], [west, north], [west, south]];
        clipped = intersection(intersecting, [[rectangle]]);
        if (!Array.isArray(clipped)) throw new Error('Compiled tile clipping returned no polygon array.');
        for (const polygon of clipped) {
          if (!Array.isArray(polygon) || !polygon.length) throw new Error('Invalid tile polygon.');
          for (const ring of polygon) {
            if (!Array.isArray(ring) || ring.length < 4 || ring.some(point =>
              !finiteCoordinate(point)
              || point[0] < west - 1e-6 || point[0] > east + 1e-6
              || point[1] < south - 1e-6 || point[1] > north + 1e-6)
              || lodNodeKey(ring[0]) !== lodNodeKey(ring.at(-1)))
              throw new Error('Incomplete or out-of-bounds clipped polygon ring.');
          }
        }
        cache.set(key, clipped);
        while (cache.size > maxCachedTiles) cache.delete(cache.keys().next().value);
        tilesPrepared++;
      }
      if (clipped.length) parts.push({
        tileKey: key, geometry: { type: 'MultiPolygon', coordinates: clipped },
      });
    }
    if (!parts.length) {
      // Conservatively preserve the original feature. BVH admission can
      // legitimately include a country outside its exact polygon footprint.
      return feature;
    }
    tiledCountryCount++;
    return { ...feature, geometry: null, lodParts: parts };
  });
  return Object.freeze({
    features: result, tiledCountryCount, tilesPrepared, tilesReused,
  });
}
