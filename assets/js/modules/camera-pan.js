/** Mutates only the supplied presentation camera; no document or persistence access. */
export function panCameraView(view, projection, dx, dy, {scale, latitudeLimit = 85} = {}) {
  if(dx===0&&dy===0)return false;
  const coordinates=projection==='globe'?view.globeRotation:view.flatCenter;
  const previous=coordinates.slice();
  if(projection==='globe'){
    const sensitivity=0.22/Math.max(0.75,Math.sqrt(view.globeZoom));
    coordinates[0]+=dx*sensitivity;
    coordinates[1]=Math.max(-89,Math.min(89,coordinates[1]-dy*sensitivity));
  }else{
    coordinates[0]-=dx*180/(Math.PI*scale);
    coordinates[1]=Math.max(-latitudeLimit,Math.min(latitudeLimit,coordinates[1]+dy*180/(Math.PI*scale)));
    coordinates[0]=((coordinates[0]+540)%360)-180;
  }
  return previous.some((value,index)=>Math.abs(value-coordinates[index])>1e-9);
}
