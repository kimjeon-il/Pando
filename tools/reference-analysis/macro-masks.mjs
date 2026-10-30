import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeMacroAdjacency,nativeMacroDilate,nativeMacroPalette,nativeMacroVisible,nativeMacroFinish} from '../map-image/native-resample.mjs';

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,widthText,heightText,radiusText,...rest]=process.argv.slice(2);
    if(action==='finish'){
      if(rest.length!==2||![widthText,heightText].every(value=>/^[1-9]\d*$/.test(value||''))||
        ![radiusText,...rest].every(value=>/^(0|[1-9]\d*)$/.test(value||'')))throw Error('Expected macro finish dimensions, rotation and rectangle counts');
      const width=Number(widthText),height=Number(heightText),rotation=Number(radiusText),glyphCount=Number(rest[0]),exclusionCount=Number(rest[1]);
      const pixels=width*height,count=glyphCount+exclusionCount,maximum=count*16+pixels*5;
      if(!Number.isSafeInteger(maximum)||width>16384||height>16384||pixels>16777216||glyphCount>1000000||exclusionCount>1000000)
        throw Error('Invalid macro finish dimensions');
      const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;if(length>maximum)throw Error('Macro finish input is too large');chunks.push(chunk);}
      const input=Buffer.concat(chunks,length);if(length!==maximum)throw Error('Invalid macro finish input length');
      const rectangles=Array.from({length:count},(_,i)=>Array.from({length:4},(_,c)=>input.readInt32LE((i*4+c)*4)));
      const offset=count*16,image={width,height,data:input.subarray(offset,offset+pixels*3)};
      const target=input.subarray(offset+pixels*3,offset+pixels*4),known=input.subarray(offset+pixels*4);
      const result=await nativeMacroFinish(image,target,known,{rotation,glyphs:rectangles.slice(0,glyphCount),exclusions:rectangles.slice(glyphCount)});
      for(const plane of [result.image,result.target,result.known])process.stdout.write(plane);
    }else{
    if(rest.length||!['adjacency','dilate','palette','visible'].includes(action)||![widthText,heightText,radiusText].every(value=>/^[1-9]\d*$/.test(value||'')))throw Error('Expected macro mask action and dimensions');
    const width=Number(widthText),height=Number(heightText),radius=Number(radiusText),pixels=width*height;
    const colorAction=action==='palette'||action==='visible',maximum=colorAction?pixels*3+radius*24:pixels;
    if(!Number.isSafeInteger(maximum)||pixels>16777216||
      (colorAction&&(!Number.isSafeInteger(radius)||radius<(action==='palette'?2:1)||radius>(action==='palette'?16:1024))))
      throw Error('Invalid macro mask dimensions or color palette');
    const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;if(length>maximum)throw Error('Macro mask input is too large');chunks.push(chunk);}
    const input=Buffer.concat(chunks,length);
    if(colorAction){
      if(length!==maximum)throw Error('Invalid macro color palette input');
      const colors=Array.from({length:radius},(_,i)=>Array.from({length:3},(_,c)=>input.readDoubleLE((i*3+c)*8)));
      const image={width,height,data:input.subarray(radius*24)};
      process.stdout.write(await (action==='palette'?nativeMacroPalette:nativeMacroVisible)(image,colors));
    }else{
      const image={width,height,data:input};
      if(action==='adjacency'){const result=await nativeMacroAdjacency(image,radius);process.stdout.write(result.target);process.stdout.write(result.known);}
      else process.stdout.write(await nativeMacroDilate(image,radius));
    }
    }
  }catch(error){console.error('macro-masks: '+error.message);process.exitCode=1;}
}
