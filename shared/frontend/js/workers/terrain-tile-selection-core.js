'use strict';
// Shared, stateless geographic tile math. Works in the classic Canvas Worker
// and in the GPU module without a second implementation or transport.
(typeof self === 'undefined' ? globalThis : self).PandoLabTerrainTileSelection = (() => {
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
  return Object.freeze({tileSpec,neighbours,visible});
})();
