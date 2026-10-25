import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {REFERENCE_OCR_LANGUAGES} from '../plugins/pando-map-tools/lib/analysis/ocr-catalog.mjs';
import {withLibraryOutputs} from './library-data.mjs';

// The plugin reuses installed Node runtimes. Only the shared, pinned language
// files are prepared here; browser Worker/ORT bundles are no longer generated.
const root=fileURLToPath(new URL('../',import.meta.url));
const data=resolve(root,'assets/data/reference-analysis/v1/ocr');
const commit='87416418657359cb625c412a48b6e1d6d41c29bd';
const check=process.argv.includes('--check');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const languages={};
for(const language of ['osd',...REFERENCE_OCR_LANGUAGES]) {
  const name=language+'.traineddata.gz',path=join(data,name);let bytes;
  try {bytes=await readFile(path);}
  catch(error) {
    if(check||error.code!=='ENOENT')throw error;
    const response=await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${commit}/${language}.traineddata`);
    if(!response.ok)throw new Error(`Pinned OCR language download failed: ${language} HTTP ${response.status}`,{cause:error});
    const {gzipSync}=await import('node:zlib');bytes=gzipSync(Buffer.from(await response.arrayBuffer()));
    await withLibraryOutputs({paths:[path]},async()=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);});
  }
  languages[language]={url:name,sha256:hash(bytes),bytes:bytes.length};
}
const manifestPath=join(data,'manifest.json');
const manifest=JSON.stringify({schemaVersion:1,source:`https://github.com/tesseract-ocr/tessdata_fast/tree/${commit}`,languages},null,2)+'\n';
if(check){if(hash(await readFile(manifestPath))!==hash(Buffer.from(manifest)))throw new Error('Shared OCR manifest or language bytes changed.');}
else await withLibraryOutputs({paths:[manifestPath]},()=>writeFile(manifestPath,manifest));
console.log(`Plugin OCR language files ${check?'verified':'prepared'}: ${Object.keys(languages).length}; existing Node runtimes reused.`);
