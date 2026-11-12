// Experimental CPU raster: never registered as a Viewer backend.
export function rasterizeTerrainTriangle({sampler,pixels,width,height,destination,source}) {
  if(typeof sampler!=='function'||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
    pixels?.length!==width*height*4||![destination,source].every(points=>Array.isArray(points)&&points.length===3&&
      points.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite))))
    throw new TypeError('Invalid numerical terrain triangle.');
  const [a,b,c]=destination,[u,v,w]=source,det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(Math.abs(det)<1e-10)return 0;
  const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),maxX=Math.min(width,Math.ceil(Math.max(a[0],b[0],c[0])));
  const minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),maxY=Math.min(height,Math.ceil(Math.max(a[1],b[1],c[1])));
  let count=0;
  for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
    const dx=x+.5-a[0],dy=y+.5-a[1];
    const q=(dx*(c[1]-a[1])-dy*(c[0]-a[0]))/det,r=((b[0]-a[0])*dy-(b[1]-a[1])*dx)/det;
    if(q<0||r<0||q+r>1)continue;
    sampler(u[0]+q*(v[0]-u[0])+r*(w[0]-u[0]),u[1]+q*(v[1]-u[1])+r*(w[1]-u[1]),pixels,(y*width+x)*4);
    count++;
  }
  return count;
}
