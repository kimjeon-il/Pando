import { referenceImageTilePlan, createReferenceTileAccumulator } from './tiles.mjs';

// One tensor/tile implementation for browser and Node raster adapters.
export async function inferReferenceBoundaries({ width, height, overview, tileRaster, ort, bytes, context, observedChannels = null }) {
  const tensor = raster => {
    const values=new Float32Array(3*raster.width*raster.height), mean=[.485,.456,.406], deviation=[.229,.224,.225];
    for(let i=0;i<raster.width*raster.height;i++) for(let c=0;c<3;c++) values[c*raster.width*raster.height+i]=(raster.data[4*i+c]/255-mean[c])/deviation[c];
    return new ort.Tensor('float32',values,[1,3,raster.height,raster.width]);
  };
  context.throwIfCancelled();
  const session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});
  let overviewTensor;
  try {
    overviewTensor=tensor(await overview());
    const accumulator=createReferenceTileAccumulator(width,height,observedChannels ? { confidenceChannels: observedChannels.filter(c=>c<3) } : {}), plan=referenceImageTilePlan(width,height);
    let currentY=0;
    for(let i=0;i<plan.length;i++) {
      context.throwIfCancelled();const tile=plan[i];
      if(tile.y!==currentY) {accumulator.finishRow(currentY,tile.y);currentY=tile.y;}
      const input=tensor(await tileRaster(tile));
      const position=new ort.Tensor('float32',Float32Array.from([tile.x/width,tile.y/height,tile.width/width,tile.height/height]),[1,4]);
      let output;
      try {
        output=await session.run({tile:input,overview:overviewTensor,position});context.throwIfCancelled();
        if(!output.logits || JSON.stringify(output.logits.dims)!=='[1,7,512,512]') throw new Error('Invalid boundary model output dimensions.');
        accumulator.add(tile,output.logits.data);
      } finally {input.dispose();position.dispose();for(const value of Object.values(output || {})) value.dispose();}
      context.emitEvent('reference.analysis-progress',{phase:'boundaries',completed:i+1,total:plan.length});
    }
    accumulator.finishRow(currentY,height);
    const mask=accumulator.result();
    if(observedChannels) {
      const known=observedChannels.reduce((bits,c)=>bits|(1<<c),0);
      for(let i=0;i<mask.labels.length;i++) mask.labels[i]&=known;
    }
    return mask;
  } finally {overviewTensor?.dispose();await session.release();}
}
