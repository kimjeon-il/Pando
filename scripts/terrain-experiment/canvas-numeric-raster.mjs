// Experimental CPU raster: never registered as a Viewer backend.
export function createTerrainLookupSampler({api,dem,width,height,theme='light'}) {
  if(!api||dem?.length!==width*height*4||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)
    throw new TypeError('Invalid terrain lookup input');
  const palette=new Uint8Array(6501*3),point=new Uint8ClampedArray(4),pixel=new Uint8ClampedArray(4);
  const sample=api.createInterpolatedSampler({dem:point,width:1,height:1,theme,channel:'land'});
  point[2]=212;point[3]=255;
  for(let h=0;h<=6500;h++){const n=h+12000;point[0]=n>>8;point[1]=n&255;sample(0,0,pixel);palette.set(pixel.subarray(0,3),h*3);}
  const flat=.27+.73*Math.SQRT1_2;
  const factor=shade=>{const illumination=Math.max(0,(shade/255-.42)/.58);
    return Math.max(.38,Math.min(1.3,Math.max(.16,Math.min(1,flat+((.27+.73*illumination)-flat)*1.3))/flat));};
  const baseline=factor(212);
  return (x,y,out,offset=0)=>{
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const x0=Math.max(0,Math.min(width-1,ix)),x1=Math.max(0,Math.min(width-1,ix+1));
    const y0=Math.max(0,Math.min(height-1,iy)),y1=Math.max(0,Math.min(height-1,iy+1));
    const a=(y0*width+x0)*4,b=(y0*width+x1)*4,c=(y1*width+x0)*4,d=(y1*width+x1)*4;
    const h0=Math.max(0,dem[a]*256+dem[a+1]-12000),h1=Math.max(0,dem[b]*256+dem[b+1]-12000);
    const h2=Math.max(0,dem[c]*256+dem[c+1]-12000),h3=Math.max(0,dem[d]*256+dem[d+1]-12000);
    const h=Math.max(0,Math.min(6500,(h0+(h1-h0)*fx)*(1-fy)+(h2+(h3-h2)*fx)*fy));
    const light=(dem[a+2]+(dem[b+2]-dem[a+2])*fx)*(1-fy)+(dem[c+2]+(dem[d+2]-dem[c+2])*fx)*fy;
    const lo=Math.floor(h),hi=Math.min(6500,lo+1),part=h-lo,multiplier=factor(light)/baseline;
    for(let channel=0;channel<3;channel++)out[offset+channel]=Math.max(0,Math.min(255,Math.round((palette[lo*3+channel]*(1-part)+palette[hi*3+channel]*part)*multiplier)));
    out[offset+3]=255;return out;
  };
}
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
