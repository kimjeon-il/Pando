// Select the most informative known tile without treating training data as evaluation.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {REFERENCE_BOUNDARY_CHANNELS,referenceImageTilePlan} from '../../plugins/pando-map-tools/lib/analysis/tiles.mjs';
import {countNativeDiagnosticTiles} from '../map-image/native-resample.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {reviewMasks} from './review-masks.mjs';
import {readTrainingBounded} from './training-evidence.mjs';
import {isRasterTrainingAnnotation} from './training-tiles.mjs';

export async function selectDiagnosticTile({root,annotation},{signal,workspace,imageDirectory,reviewDirectory}={}){
  signal?.throwIfAborted();const {width,height}=annotation||{};
  if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=65535)||width*height>600000000)throw Error('Bounded diagnostic source dimensions required');
  const tiles=referenceImageTilePlan(width,height);let scores;
  if(isRasterTrainingAnnotation(annotation)){
    if(!root)throw Error('Raster diagnostic corpus root required');
    const read=async field=>{const spec=annotation[field];if(!spec||typeof spec.path!=='string')throw Error('Source-bound diagnostic raster required');
      const path=await resolveCorpusPath(root,spec.path);signal?.throwIfAborted();return {bytes:readTrainingBounded(path,300*1024*1024),sha256:spec.sha256};};
    const [target,known]=await Promise.all([read('raster'),read('validRaster')]);
    const result=await countNativeDiagnosticTiles(target,known,{signal,workspace,directory:imageDirectory});
    if(result.width!==width||result.height!==height||result.tiles.length!==tiles.length)throw Error('Diagnostic raster dimensions differ from original');
    scores=result.tiles;
  }else{
    scores=[];
    for(const tile of tiles){signal?.throwIfAborted();
      const masks=await reviewMasks(annotation,{window:[tile.x,tile.y,512,512],fullSheetCoordinates:true,signal,workspace,directory:reviewDirectory});
      const counts=Array(7).fill(0);let active=false;
      for(let i=0;i<masks.knownBits.length;i++){const known=masks.knownBits[i];if(known){active=true;const positive=known&masks.targetBits[i];
        if(positive)for(let c=0;c<7;c++)if(positive&(1<<c))counts[c]++;}}
      scores.push({active,counts});
    }
  }
  const channel=REFERENCE_BOUNDARY_CHANNELS.findIndex((_,c)=>scores.some(row=>row.counts[c]>0));
  const selectedChannel=channel<0?3:channel;let best=null,index=0;
  for(let i=0;i<tiles.length;i++)if(scores[i].active){const positivePixels=scores[i].counts[selectedChannel];
    if(best===null||positivePixels>best.positivePixels)best={index,x:tiles[i].x,y:tiles[i].y,channel:selectedChannel,positivePixels};index++;}
  return best;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--select')throw Error('Expected --select');
    const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;if(length>64*1024*1024)throw Error('Diagnostic request exceeds budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,length).toString('utf8'));
    process.stdout.write(JSON.stringify(await selectDiagnosticTile(request))+'\n');
  }catch(error){console.error('diagnostic-selection: '+error.message);process.exitCode=1;}
}
