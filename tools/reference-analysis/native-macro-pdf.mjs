// Source-derived country-fill supervision is weak training data, not review truth.
import {nativeMacroAdjacency,nativeMacroDilate,nativeMacroFinish,nativeMacroPalette,nativeMacroVisible} from '../map-image/native-resample.mjs';
import {renderMacroPdf,renderMacroStrokes} from './native-publisher-pdf.mjs';

export async function deriveMacroPdf({path,metadata,maximumDimension},{signal,workspace,pdfDirectory,imageDirectory}={}){
  signal?.throwIfAborted();
  if(!metadata||!['world','continent','country'].includes(metadata.geographicScope)||!metadata.scopeEvidence||
    metadata.materialKind!=='published-macro-pdf'||metadata.rightsReviewed!==true||!metadata.license)
    throw Error('Verified whole-map macro scope and rights required');
  const specification=metadata.supervision;
  if(!['country-fill-adjacency','boundary-stroke-signatures'].includes(specification?.strategy))throw Error('Explicit macro supervision strategy required');
  const raster=await renderMacroPdf({path,maximumDimension},{signal,workspace,directory:pdfDirectory});
  const image={width:raster.width,height:raster.height,data:raster.rgb},options={signal,workspace,directory:imageDirectory};
  let target,known;
  if(specification.strategy==='country-fill-adjacency'){
    if(!Number.isInteger(specification.radiusPixels)||specification.radiusPixels<1||specification.radiusPixels>4)
      throw Error('Bounded macro fill radius required');
    const labels=await nativeMacroPalette(image,specification.countryFillColors,options);
    ({target,known}=await nativeMacroAdjacency({width:image.width,height:image.height,data:labels},specification.radiusPixels,options));
  }else{
    const band=specification.knownBandRadiusPixels;
    if(band!==undefined&&(!Number.isInteger(band)||band<1||band>32))throw Error('Bounded known supervision band required');
    if(!specification.channels||typeof specification.channels!=='object'||Array.isArray(specification.channels)||
      Object.keys(specification.channels).some(key=>!['international','administrative'].includes(key)))throw Error('Only catalogued macro boundary strokes supported');
    target=Buffer.alloc(image.width*image.height);known=Buffer.alloc(target.length);
    const strokes=async signatures=>{const result=await renderMacroStrokes({path,maximumDimension,signatures},{signal,workspace,directory:pdfDirectory});
      if(result.sourceSha256!==raster.sourceSha256||result.width!==raster.width||result.height!==raster.height||result.scale!==raster.scale||result.rotation!==raster.rotation)
        throw Error('Macro source changed during stroke extraction');return result.mask;};
    for(const [channel,signatures] of Object.entries(specification.channels)){
      const pixels=await strokes(signatures),visible=await nativeMacroVisible(image,signatures.map(item=>item.color),options),bit=channel==='international'?1:2;
      const observed=Buffer.alloc(target.length);for(let i=0;i<target.length;i++)if(pixels[i]&&visible[i]){observed[i]=1;target[i]|=bit;}
      const knownBand=band===undefined?null:await nativeMacroDilate({width:image.width,height:image.height,data:observed},band,options);
      for(let i=0;i<target.length;i++)if(!knownBand||knownBand[i])known[i]|=bit;
    }
    if(specification.unknownStrokes!==undefined&&!Array.isArray(specification.unknownStrokes))throw Error('Explicit unknown macro strokes required');
    for(const signature of specification.unknownStrokes||[]){const pixels=await strokes([signature]);
      const unknown=await nativeMacroDilate({width:image.width,height:image.height,data:pixels},2,options);
      for(let i=0;i<known.length;i++)if(unknown[i])known[i]=0;
    }
  }
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
