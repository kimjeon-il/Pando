import {REFERENCE_OCR_LANGUAGES} from '../../plugins/pando-map-tools/lib/analysis/ocr-catalog.mjs';

export function validateSourceLanguage(source){
  if(!/^[a-z]{3}(?:_[a-z0-9]+)*$/.test(source.language||'')||!source.script)throw Error('Explicit source language and script required');
  const packs=Object.hasOwn(source,'ocrLanguages')?source.ocrLanguages:[];
  if(!Array.isArray(packs)||new Set(packs).size!==packs.length||packs.some(pack=>!REFERENCE_OCR_LANGUAGES.includes(pack)))
    throw Error('OCR languages must refer to the installed runtime catalog');
}
