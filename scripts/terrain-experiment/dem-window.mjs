// The native reader bounds each request; stitch exact Float32 bytes by rows.
export async function readDemWindowTiled(reader,box,maxWidth=4096,maxPixels=16777216){
  if(!reader||typeof reader.read!=='function'||!Array.isArray(box)||box.length!==4||
    box.some(value=>!Number.isSafeInteger(value))||!Number.isSafeInteger(maxWidth)||maxWidth<1||maxWidth>5000||
    !Number.isSafeInteger(maxPixels)||maxPixels<maxWidth||maxPixels>16777216)
    throw new TypeError('Invalid bounded DEM window');
  const [x0,y0,x1,y1]=box,width=x1-x0,height=y1-y0;
  if(width<1||height<1||height>6500||width*height>32000000)throw new RangeError('DEM window exceeds experiment bounds');
  const result=Buffer.allocUnsafe(width*height*4);
  for(let x=x0;x<x1;x+=maxWidth){
    const count=Math.min(maxWidth,x1-x),step=Math.min(5000,Math.floor(maxPixels/count));
    for(let y=y0;y<y1;y+=step){
      const rows=Math.min(step,y1-y),part=await reader.read([x,y,x+count,y+rows]);
      if(!Buffer.isBuffer(part)||part.length!==count*rows*4)throw Error('DEM reader returned an invalid byte count');
      for(let row=0;row<rows;row++)part.copy(result,((y-y0+row)*width+x-x0)*4,row*count*4,(row+1)*count*4);
    }
  }
  return result;
}
