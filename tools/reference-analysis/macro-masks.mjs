import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeMacroAdjacency,nativeMacroDilate,nativeMacroPalette,nativeMacroVisible} from '../map-image/native-resample.mjs';

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,widthText,heightText,radiusText,...rest]=process.argv.slice(2);
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
  }catch(error){console.error('macro-masks: '+error.message);process.exitCode=1;}
}
