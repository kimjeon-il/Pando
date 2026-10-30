import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeMacroAdjacency,nativeMacroDilate} from '../map-image/native-resample.mjs';

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,widthText,heightText,radiusText,...rest]=process.argv.slice(2);
    if(rest.length||!['adjacency','dilate'].includes(action)||![widthText,heightText,radiusText].every(value=>/^[1-9]\d*$/.test(value||'')))throw Error('Expected macro mask action and dimensions');
    const width=Number(widthText),height=Number(heightText),radius=Number(radiusText),maximum=width*height;
    if(!Number.isSafeInteger(maximum)||maximum>16777216)throw Error('Invalid macro mask dimensions');
    const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;if(length>maximum)throw Error('Macro mask input is too large');chunks.push(chunk);}
    const image={width,height,data:Buffer.concat(chunks,length)};
    if(action==='adjacency'){const result=await nativeMacroAdjacency(image,radius);process.stdout.write(result.target);process.stdout.write(result.known);}
    else process.stdout.write(await nativeMacroDilate(image,radius));
  }catch(error){console.error('macro-masks: '+error.message);process.exitCode=1;}
}
