'use strict';
// Shared geographic tile math with a per-backend visibility-cache factory.
// No shared mutable cache or duplicated CPU tile-selection implementation.
(typeof self === 'undefined' ? globalThis : self).PandoLabTerrainTileSelection = (() => {
  // All backends admit the same visible numerical source set. The footprint
  // covers three RGBA color planes; device caches may retain additional tiles.
  const demVisiblePolicy = Object.freeze({ byteBudget: 96 * 1024 * 1024, bytesPerPixel: 12 });
  function tileSpec(level,column,row,numericLevel=false) {
    const x0=column*level.tileSize,y0=row*level.tileSize;
    const x1=Math.min(level.width,x0+level.tileSize),y1=Math.min(level.height,y0+level.tileSize);
    return {
      key:`${level.id}/${column}-${row}`,level:numericLevel?Number(level.id):level.id,column,row,
      pixelWidth:x1-x0,pixelHeight:y1-y0,
      bounds:[-180+x0/level.width*360,90-y0/level.height*180,
        -180+x1/level.width*360,90-y1/level.height*180],
    };
  }
  function neighbours(level,specs,numericLevel=false) {
    const output=[],seen=new Set(specs.map(spec=>spec.key));
    for(const spec of specs)
      for(let row=Math.max(0,spec.row-1);row<=Math.min(level.rows-1,spec.row+1);row++)
        for(let column=Math.max(0,spec.column-1);column<=Math.min(level.columns-1,spec.column+1);column++){
          const candidate=tileSpec(level,column,row,numericLevel);
          if(seen.has(candidate.key))continue;
          seen.add(candidate.key);output.push(candidate);
        }
    return output;
  }
  function visible(level,{includeAll=false,viewport,scale,projection,flatCenter=[0,0],
    globeCenter=[0,0],distance,numericLevel=false}={}) {
    const specs=[],width=Number(viewport[0]),height=Number(viewport[1]);
    const flatHalfLon=width/Math.max(1,scale)*90/Math.PI;
    const flatHalfLat=height/Math.max(1,scale)*90/Math.PI;
    const globeRadius=Math.asin(Math.min(1,Math.hypot(width,height)*0.5/Math.max(1,scale)));
    if (!includeAll && projection === 'flat') {
      // Longitude and latitude inclusion are independent for the flat map.
      // Test each source row/column once, then allocate only visible tiles.
      // Keep the original wrapped-distance predicate and source ordering.
      const columns = [], rows = [];
      for (let column = 0; column < level.columns; column++) {
        const x0 = column * level.tileSize, x1 = Math.min(level.width, x0 + level.tileSize);
        const centerLon = -180 + (x0 + x1) / level.width * 180;
        const halfLon = (x1 - x0) / level.width * 180;
        const deltaLon = Math.abs((((centerLon - flatCenter[0]) + 540) % 360) - 180);
        if (deltaLon <= flatHalfLon + halfLon + 2) columns.push(column);
      }
      for (let row = 0; row < level.rows; row++) {
        const y0 = row * level.tileSize, y1 = Math.min(level.height, y0 + level.tileSize);
        const centerLat = 90 - (y0 + y1) / level.height * 90;
        const halfLat = (y1 - y0) / level.height * 90;
        if (Math.abs(centerLat - flatCenter[1]) <= flatHalfLat + halfLat + 2) rows.push(row);
      }
      for (const row of rows) for (const column of columns)
        specs.push(tileSpec(level, column, row, numericLevel));
      return specs;
    }
    for(let row=0;row<level.rows;row++)for(let column=0;column<level.columns;column++){
      if(includeAll){specs.push(tileSpec(level,column,row,numericLevel));continue;}
      // Derive bounds before allocating a tile descriptor. Most high-LOD
      // tiles are offscreen during a zoomed-in view.
      const x0=column*level.tileSize,y0=row*level.tileSize;
      const x1=Math.min(level.width,x0+level.tileSize),y1=Math.min(level.height,y0+level.tileSize);
      const west=-180+x0/level.width*360,north=90-y0/level.height*180;
      const east=-180+x1/level.width*360,south=90-y1/level.height*180;
      const center=[(west+east)/2,(north+south)/2];
      const halfLon=(east-west)/2,halfLat=(north-south)/2;
      if(projection==='flat'){
        const deltaLon=Math.abs((((center[0]-flatCenter[0])+540)%360)-180);
        if(deltaLon<=flatHalfLon+halfLon+2&&Math.abs(center[1]-flatCenter[1])<=flatHalfLat+halfLat+2)
          specs.push(tileSpec(level,column,row,numericLevel));
      }else if(distance(globeCenter,center)<=globeRadius+Math.hypot(halfLon,halfLat)*Math.PI/180+0.04)
        specs.push(tileSpec(level,column,row,numericLevel));
    }
    return specs;
  }
  function chooseLevel(manifest, desiredWidth) {
    if (!manifest?.levels?.length) return { level: null, resolutionLimited: false };
    const limit = Number(desiredWidth) * 1.12;
    const last = manifest.levels[manifest.levels.length - 1];
    return {
      level: manifest.levels.find(level => level.width >= limit) || last,
      resolutionLimited: last.width < limit,
    };
  }
  function admitVisibleTiles(manifest, desiredWidth, visibleSpecs, policy = demVisiblePolicy) {
    const requested = chooseLevel(manifest, desiredWidth);
    if (!requested.level) return { level: null, specs: [], resolutionLimited: false, bytes: 0 };
    for (let index = manifest.levels.indexOf(requested.level); index >= 0; index -= 1) {
      const level = manifest.levels[index], specs = visibleSpecs(level);
      const gutter = Number(manifest.gutter || 0);
      const bytes = specs.reduce((sum, spec) => sum
        + (spec.pixelWidth + 2 * gutter) * (spec.pixelHeight + 2 * gutter) * policy.bytesPerPixel, 0);
      if (bytes <= policy.byteBudget) return { level, specs, bytes,
        resolutionLimited: requested.resolutionLimited || level !== requested.level };
    }
    throw new Error('Visible numerical DEM exceeds the shared memory admission budget.');
  }
  function createVisibilityCache({ distance, numericLevel = false } = {}) {
    let camera = null;
    const levels = new Map();
    return Object.freeze({
      select(level, { cameraKey, includeAll = false, viewport, scale, projection,
        flatCenter, globeCenter } = {}) {
        if (!camera || camera.length !== cameraKey.length
          || cameraKey.some((value, index) => !Object.is(value, camera[index]))) {
          camera = cameraKey.slice();
          levels.clear();
        }
        let record = levels.get(level);
        if (!record) { record = {}; levels.set(level, record); }
        const kind = includeAll ? 'all' : 'visible';
        if (!record[kind]) {
          record[kind] = visible(level, { includeAll, viewport, scale,
            projection, flatCenter, globeCenter, distance, numericLevel });
        }
        return record[kind];
      },
      clear() { camera = null; levels.clear(); },
    });
  }
  return Object.freeze({ tileSpec, neighbours, visible, chooseLevel, createVisibilityCache, demVisiblePolicy, admitVisibleTiles });
})();
