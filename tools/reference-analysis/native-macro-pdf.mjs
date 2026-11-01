// Source-derived country-fill supervision is weak training data, not review truth.
import {nativeMacroAdjacency,nativeMacroFinish,nativeMacroPalette} from '../map-image/native-resample.mjs';
import {renderMacroPdf} from './native-publisher-pdf.mjs';

export async function deriveMacroFill({path,metadata,maximumDimension},{signal,workspace,pdfDirectory,imageDirectory}={}){
  signal?.throwIfAborted();
  if(!metadata||!['world','continent','country'].includes(metadata.geographicScope)||!metadata.scopeEvidence||
    metadata.materialKind!=='published-macro-pdf'||metadata.rightsReviewed!==true||!metadata.license)
    throw Error('Verified whole-map macro scope and rights required');
  const specification=metadata.supervision;
  if(specification?.strategy!=='country-fill-adjacency')throw Error('Explicit macro fill supervision strategy required');
  if(!Number.isInteger(specification.radiusPixels)||specification.radiusPixels<1||specification.radiusPixels>4)
    throw Error('Bounded macro fill radius required');
  const raster=await renderMacroPdf({path,maximumDimension},{signal,workspace,directory:pdfDirectory});
  const image={width:raster.width,height:raster.height,data:raster.rgb},options={signal,workspace,directory:imageDirectory};
  const labels=await nativeMacroPalette(image,specification.countryFillColors,options);
  const {target,known}=await nativeMacroAdjacency({width:image.width,height:image.height,data:labels},specification.radiusPixels,options);
  for(let i=0;i<target.length;i++)if(raster.textMask[i])target[i]=known[i]=0;
  const width=[90,270].includes(raster.rotation)?image.height:image.width,height=[90,270].includes(raster.rotation)?image.width:image.height;
  if(metadata.excludedRegionsNormalized!==undefined&&!Array.isArray(metadata.excludedRegionsNormalized))throw Error('Explicit macro exclusion rectangles required');
  const exclusions=(metadata.excludedRegionsNormalized||[]).map(rect=>{
    if(!Array.isArray(rect)||rect.length!==4||rect.some(value=>typeof value!=='number'||!Number.isFinite(value))||
      rect[0]<0||rect[1]<0||rect[2]>1||rect[3]>1||rect[0]>=rect[2]||rect[1]>=rect[3])
      throw Error('Bounded explicit macro exclusion rectangle required');
    return [Math.floor(rect[0]*width),Math.floor(rect[1]*height),Math.ceil(rect[2]*width),Math.ceil(rect[3]*height)];
  });
  const result=await nativeMacroFinish(image,target,known,{rotation:raster.rotation,glyphs:[],exclusions},options);
  if(result.target.reduce((count,value)=>count+(value!==0),0)<20||result.known.reduce((count,value)=>count+(value!==0),0)<100)
    throw Error('Insufficient actual macro boundary supervision');
  return {...result,credits:raster.credits,sourceSha256:raster.sourceSha256};
}
