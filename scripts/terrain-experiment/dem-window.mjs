// The native reader bounds each request; stitch exact Float32 bytes by rows.
export async function readDemWindowTiled(reader,box,maxWidth=4096){
  if(!reader||typeof reader.read!=='function'||!Array.isArray(box)||box.length!==4||
    box.some(value=>!Number.isSafeInteger(value))||!Number.isSafeInteger(maxWidth)||maxWidth<1||maxWidth>5000)
    throw new TypeError('Invalid bounded DEM window');
  const [x0,y0,x1,y1]=box,width=x1-x0,height=y1-y0;
  if(width<1||height<1||height>5000||width*height>16777216)throw new RangeError('DEM window exceeds experiment bounds');
  const result=Buffer.allocUnsafe(width*height*4);
  for(let x=x0;x<x1;x+=maxWidth){
    const count=Math.min(maxWidth,x1-x),part=await reader.read([x,y0,x+count,y1]);
    if(!Buffer.isBuffer(part)||part.length!==count*height*4)throw Error('DEM reader returned an invalid byte count');
    for(let y=0;y<height;y++)part.copy(result,(y*width+x-x0)*4,y*count*4,(y+1)*count*4);
  }
  return result;
}
