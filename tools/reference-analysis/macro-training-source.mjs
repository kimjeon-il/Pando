// Resolve and verify a source-derived macro sheet without admitting it as review truth.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {resolveCorpusPath} from './corpus-path.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {validateSourceLanguage} from './source-language.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertMacroMetadata(metadata,annotation,sheet,{requireTraining=false}={}){
  if(metadata.sha256!==annotation.sourceSha256||['id','familyId','editionId','duplicateGroup','geographicScope','scopeEvidence']
    .some(key=>!isDeepStrictEqual(metadata[key],sheet[key]))||metadata.url!==sheet.source?.url||metadata.license!==sheet.source?.license||
    requireTraining&&(metadata.rightsReviewed!==true||!metadata.license||metadata.materialKind!=='published-macro-pdf'))
    throw Error(requireTraining?'Verified macro source provenance required':'Verified macro source and geographic scope required');
}
export async function verifiedMacroTrainingSource(root,corpus,sourceId){
  if(corpus?.schemaVersion!==1||corpus.trainingOnly!==true||!Array.isArray(corpus.sheets))throw Error('Explicit private training-only corpus required');
  const rows=corpus.sheets.filter(row=>row.id===sourceId);if(rows.length!==1)throw Error('Unique training source identity required');const sheet=rows[0];
  if(sheet.split!=='train'||!['world','continent','country'].includes(sheet.geographicScope)||!sheet.scopeEvidence||
    !/^[a-f0-9]{64}$/.test(sheet.sha256||'')||['familyId','editionId','duplicateGroup'].some(key=>typeof sheet[key]!=='string'||!sheet[key])||!sheet.source?.url||!sheet.source?.license)
    throw Error('Verified macro training source required');
  validateSourceLanguage(sheet);if(!['color','monochrome'].includes(sheet.mapKind))throw Error('Training mapKind must be color or monochrome');
  const annotationPath=await resolveCorpusPath(root,sheet.annotations),annotationBytes=readTrainingBounded(annotationPath,64*1024*1024);
  const annotationSha256=sha(annotationBytes),annotation=JSON.parse(annotationBytes);
  if(annotation.origin!=='macro-vector-supervision'||annotation.reviewed!==false||annotation.supervisionQuality!=='source-derived-weak'||
    ![annotation.sourceSha256,annotation.raster?.sha256,annotation.validRaster?.sha256].every(value=>/^[a-f0-9]{64}$/.test(value||'')))
    throw Error('Source-derived macro training evidence differs');
  const metadataPath=await resolveCorpusPath(root,annotation.sourceMetadata),metadataBytes=readTrainingBounded(metadataPath,1024*1024);
  if(sha(metadataBytes)!==annotation.sourceMetadataSha256)throw Error('Training source metadata hash changed');const metadata=JSON.parse(metadataBytes);
  assertMacroMetadata(metadata,annotation,sheet,{requireTraining:true});
  const sourcePdf=await resolveCorpusPath(root,annotation.sourcePdf);if(trainingFileIdentity(sourcePdf)!==annotation.sourceSha256)throw Error('Training source PDF hash changed');
  const imagePath=await resolveCorpusPath(root,sheet.image),maskPath=await resolveCorpusPath(root,annotation.raster.path),validPath=await resolveCorpusPath(root,annotation.validRaster.path);
  return {sheet,annotation,annotationSha256,checks:[[sourcePdf,annotation.sourceSha256],[metadataPath,annotation.sourceMetadataSha256],
    [annotationPath,annotationSha256],[imagePath,sheet.sha256],[maskPath,annotation.raster.sha256],[validPath,annotation.validRaster.sha256]]};
}
export function recheckMacroTrainingSource(checks){
  for(const [path,expected] of checks)if(trainingFileIdentity(path)!==expected)throw Error('Training source changed during execution');
}
