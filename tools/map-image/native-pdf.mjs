import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,createReadStream,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';
import {resizeNativeRgba} from './native-resample.mjs';

export const mapPdfSourceFiles=Object.freeze(['tools/cpp/map-pdf/CMakeLists.txt','tools/cpp/map-pdf/pdf-read.c','tools/cpp/map-pdf/MUPDF-COPYING']);
const root=fileURLToPath(new URL('../../',import.meta.url));
const runtimes={
  win32:{executable:'pando-map-pdf.exe',library:'mupdfcpp64.dll',sha256:'b1ba5816e64d2b321b2a21f89c3a9aa39a493f97519ffbeec3b1e30708a32184'},
  linux:{executable:'pando-map-pdf',library:'libmupdf.so.26.11',sha256:'2802c2bfedc5b2f4381d93dc2367c9987fa307fabc45c7a041d819c950cc5791'},
};
function checkedArtifact(workspace,directory,platform){
  const spec=runtimes[platform];if(!spec)throw Error('Unsupported PDF runtime platform');
  const result=verifyNativeTool({root:workspace,directory,target:'map-pdf',executable:spec.executable,sourceFiles:mapPdfSourceFiles,platform,architecture:'x64'});
  const library=readFileSync(resolve(directory,spec.library));
  if(createHash('sha256').update(library).digest('hex')!==spec.sha256)throw Error('MuPDF runtime hash mismatch');
  return {...result,library,spec};
}
export function collectMapPdfArtifacts({workspace=root,revision,
  linuxDirectory=process.env.PANDO_MAP_PDF_LINUX_ARTIFACT||resolve(workspace,'build-native/map-pdf/linux-x64'),
  windowsDirectory=process.env.PANDO_MAP_PDF_WINDOWS_ARTIFACT||resolve(workspace,'build-native/map-pdf/win32-x64')}={}){
  if(revision!==undefined&&!/^[a-f0-9]{40}$/.test(revision))throw Error('A full pinned source revision is required');
  const entries=[];
  for(const [platform,directory] of [['linux',linuxDirectory],['win32',windowsDirectory]]){
    const {binary,manifest,library,spec}=checkedArtifact(workspace,directory,platform);
    if(revision)for(const file of manifest.sourceFiles){
      const source=execFileSync('git',['show',revision+':'+file.path],{cwd:workspace,encoding:'utf8',maxBuffer:16*1024*1024});
      if(createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex')!==file.sha256)throw Error('Native PDF artifact differs from pinned source: '+file.path);
    }
    const prefix=`build-native/map-pdf/${platform}-x64/`;
    entries.push({path:prefix+'native-tool.manifest.json',data:readFileSync(resolve(directory,'native-tool.manifest.json'))},
      {path:prefix+spec.executable,data:readFileSync(binary)},{path:prefix+spec.library,data:library});
  }
  return entries;
}
function projection(wkt){
  const prime=[...wkt.matchAll(/PRIMEM\["[^"]+",([\d.eE+-]+)\]/gi)],units=[...wkt.matchAll(/UNIT\["([^"]+)",([\d.eE+-]+)\]/gi)];
  if(prime.length!==1||Number(prime[0][1])!==0||units.length!==2||!['degree','degrees'].includes(units[0][1].toLowerCase())||
     Math.abs(Number(units[0][2])-Math.PI/180)>1e-16||/AXIS\[|TOWGS84\[/i.test(wkt))return null;
  const method=/PROJECTION\["([^"]+)"\]/i.exec(wkt),spheroid=/SPHEROID\["[^"]+",([\d.eE+-]+),([\d.eE+-]+)\]/i.exec(wkt);
  if(!method||!spheroid||!/UNIT\["(?:Meter|Metre)",1(?:\.0*)?\]\]$/i.test(wkt))return null;
  const kind={lambert_conformal_conic:'lcc',mercator:'merc',mercator_1sp:'merc',azimuthal_equidistant:'aeqd',
    lambert_azimuthal_equal_area:'laea',polar_stereographic:'stere',robinson:'robin',equirectangular:'eqc'}[method[1].toLowerCase()];
  if(!kind)return null;
  const radius=Number(spheroid[1]),inverse=Number(spheroid[2]);if(!Number.isFinite(radius)||radius<=0)return null;
  let result;if(inverse===0)result={kind,ellipsoid:'sphere',radius};
  else if(Math.abs(radius-6378137)<.00001&&Math.abs(inverse-298.257222101)<1e-8)result={kind,ellipsoid:'GRS80'};
  else if(Math.abs(radius-6378137)<.00001&&Math.abs(inverse-298.257223563)<1e-8)result={kind,ellipsoid:'WGS84'};
  else return null;
  if(['eqc','aeqd','laea','robin'].includes(kind)&&result.ellipsoid!=='sphere')return null;
  const keys={central_meridian:'lon0',latitude_of_origin:'lat0',standard_parallel_1:'lat1',standard_parallel_2:'lat2',scale_factor:'k0',false_easting:'x0',false_northing:'y0'};
  for(const [,name,value] of wkt.matchAll(/PARAMETER\["([^"]+)",([\d.eE+-]+)\]/gi)){
    const key=keys[name.toLowerCase()],number=Number(value);if(!key||!Number.isFinite(number))return null;result[key]=number;
  }
  return result;
}
function georeference(raw,resolved,header){
  if(header.viewportTooLarge)return {diagnostic:'geopdf-viewport-exceeds-budget'};
  if(!raw)return null;
  const refs=[...raw.matchAll(/(\d+)\s+\d+\s+R/g)];
  if(refs.length&&!raw.includes('/BBox')){
    if(refs.length!==1)return {diagnostic:'multiple-geopdf-viewports-need-selection'};
    raw=resolved;
  }
  if((raw.match(/\/BBox/g)||[]).length!==1)return {diagnostic:'multiple-or-unsupported-geopdf-viewports'};
  const numbers=key=>{const found=new RegExp('/'+key+'\\s*\\[([\\d.eE+\\s-]+)\\]').exec(raw);return found?found[1].trim().split(/\s+/).map(Number):[];};
  const bounds=numbers('BBox'),geographic=numbers('GPTS'),local=numbers('LPTS'),wkt=/\/WKT\s*\((.*?)\)\s*>>/.exec(raw),p=wkt&&projection(wkt[1]);
  if(!p||bounds.length!==4||geographic.length!==local.length||local.length<6||local.length%2)return {diagnostic:'unsupported-geopdf-crs-or-control-layout'};
  if([...bounds,...geographic,...local].some(x=>!Number.isFinite(x))||bounds[2]<=bounds[0]||bounds[3]<=bounds[1])return {diagnostic:'invalid-geopdf-control-layout'};
  let matrix=header.transform;
  if(header.rotation)matrix=[1,0,0,-1,0,header.cropHeight];
  const rotate=header.rotation===90?[0,1,-1,0,header.cropHeight,0]:header.rotation===180?[-1,0,0,-1,header.cropWidth,header.cropHeight]:
    header.rotation===270?[0,-1,1,0,0,header.cropWidth]:[1,0,0,1,0,0];
  const point=(x,y,m)=>[Math.fround(Math.fround(Math.fround(x)*m[0])+Math.fround(Math.fround(y)*m[2])+m[4]),
    Math.fround(Math.fround(Math.fround(x)*m[1])+Math.fround(Math.fround(y)*m[3])+m[5])];
  const controlPoints=[];
  for(let i=0;i<local.length;i+=2){
    const [x,y]=point(...point(bounds[0]+local[i]*(bounds[2]-bounds[0]),bounds[1]+local[i+1]*(bounds[3]-bounds[1]),matrix),rotate);
    const image=[x/header.pageWidth,y/header.pageHeight],coordinate=[geographic[i+1],geographic[i]];
    if(image.some(v=>v<0||v>1)||Math.abs(coordinate[0])>180||Math.abs(coordinate[1])>90)return {diagnostic:'geopdf-controls-outside-page'};
    controlPoints.push({id:'geopdf-'+i/2,image,coordinate});
  }
  return {projection:p,controlPoints,wkt:wkt[1],independentChecks:false,coordinateEvidence:'embedded-publisher-metadata',datumTransformation:'not-performed'};
}
function run(binary,page,input,signal){
  return new Promise((accept,reject)=>{
    const child=spawn(binary,[String(page)],{stdio:['pipe','pipe','pipe'],windowsHide:true,signal:signal||undefined});
    const chunks=[],errors=[];let length=0,errorBytes=0,overflow=false,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):accept(value);};
    const timer=setTimeout(()=>{child.kill();finish(Error('Native PDF operation timed out'));},120000);
    child.on('error',e=>finish(e));child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>16*1024*1024*3+4*1024*1024){overflow=true;child.kill();}else chunks.push(chunk);});
    child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<=65536)errors.push(chunk);});
    child.on('close',(code,reason)=>code!==0||reason||overflow?finish(Error('Native PDF operation failed: '+Buffer.concat(errors).toString('utf8'))):finish(null,Buffer.concat(chunks,length)));
    child.stdin.end(input);
  });
}
export async function readNativePdf(spec,{signal,workspace=root,directory=process.env.PANDO_MAP_PDF_ARTIFACT||
  resolve(workspace,'build-native/map-pdf',existsSync(resolve(workspace,'.map-runtime.json'))?`${process.platform}-${process.arch}`:'artifact')}={}){
  signal?.throwIfAborted();const page=spec.page==null?0:spec.page,maxPixels=spec.maxPixels??4000000;
  if(!Number.isInteger(page)||page<0||page>1000000||(spec.page!=null&&page===0))throw Error('Invalid PDF page');
  if(!Number.isInteger(maxPixels)||maxPixels<256||maxPixels>16777216)throw Error('Pixel budget must be 256..16777216');
  const {binary}=checkedArtifact(workspace,directory,process.platform);
  if(process.platform!=='win32'&&!process.env.PANDO_MAP_PDF_ARTIFACT&&existsSync(resolve(workspace,'.map-runtime.json')))chmodSync(binary,0o755);
  const chunks=[];let bytes=0;
  for await(const chunk of createReadStream(spec.path,{signal:signal||undefined})){
    bytes+=chunk.length;if(bytes>300*1024*1024)throw Error('PDF input exceeds encoded byte budget');chunks.push(chunk);
  }
  signal?.throwIfAborted();const input=Buffer.concat(chunks,bytes);
  const output=await run(binary,page,input,signal),split=output.indexOf(10);if(split<0||split>4096)throw Error('Invalid native PDF header');
  const h=JSON.parse(output.subarray(0,split));const start=split+1,raw=output.subarray(start,start+h.rawBytes).toString('utf8');
  const resolved=output.subarray(start+h.rawBytes,start+h.rawBytes+h.resolvedBytes).toString('utf8');
  const pixels=output.subarray(start+h.rawBytes+h.resolvedBytes);
  if(!Number.isInteger(h.width)||!Number.isInteger(h.height)||h.width<2||h.height<2||h.width*h.height>16777216||pixels.length!==h.width*h.height*3)
    throw Error('Invalid native PDF pixel receipt');
  const rect=spec.rect||{x:0,y:0,width:h.width,height:h.height};
  if(['x','y','width','height'].some(k=>!Number.isInteger(rect[k]))||rect.x<0||rect.y<0||rect.width<2||rect.height<2||rect.x+rect.width>h.width||rect.y+rect.height>h.height)
    throw Error('Source rectangle exceeds original pixel bounds');
  const rgba=Buffer.alloc(rect.width*rect.height*4);
  for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){
    const source=((y+rect.y)*h.width+x+rect.x)*3,dest=(y*rect.width+x)*4;
    rgba[dest]=pixels[source];rgba[dest+1]=pixels[source+1];rgba[dest+2]=pixels[source+2];rgba[dest+3]=255;
  }
  const scale=Math.min(1,Math.sqrt(maxPixels/(rect.width*rect.height))),width=Math.max(2,Math.trunc(rect.width*scale)),height=Math.max(2,Math.trunc(rect.height*scale));
  const {data}=await resizeNativeRgba({width:rect.width,height:rect.height,data:rgba},[width,height],{signal,workspace});
  return {width,height,originalWidth:h.width,originalHeight:h.height,mapping:{page:h.page,pdfDpi:144,georeference:georeference(raw,resolved,h),
    rect,analysisSize:[width,height],coordinateSpace:'exif-oriented-original-pixels'},data};
}
