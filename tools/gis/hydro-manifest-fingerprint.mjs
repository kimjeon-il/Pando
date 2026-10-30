// Preserve the existing sorted, ASCII-escaped Hydro manifest fingerprint contract.
import {createHash} from 'node:crypto';

class NumberToken{constructor(source){this.source=source;}}
function quote(value){return JSON.stringify(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));}
function compareCodePoints(a,b){const x=Array.from(a,char=>char.codePointAt(0)),y=Array.from(b,char=>char.codePointAt(0));
  for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;}
function floatText(value){
  if(Number.isNaN(value))return 'NaN';if(value===Infinity)return 'Infinity';if(value===-Infinity)return '-Infinity';
  if(Object.is(value,-0))return '-0.0';if(value===0)return '0.0';
  const negative=value<0,representation=Math.abs(value).toExponential(),[mantissa,exponentText]=representation.split('e');
  const exponent=Number(exponentText),sign=negative?'-':'';
  if(exponent<-4||exponent>=16){const suffix=(exponent<0?'-':'+')+String(Math.abs(exponent)).padStart(2,'0');return sign+mantissa+'e'+suffix;}
  const digits=mantissa.replace('.',''),point=exponent+1;
  if(point<=0)return sign+'0.'+'0'.repeat(-point)+digits;
  if(point>=digits.length)return sign+digits+'0'.repeat(point-digits.length)+'.0';
  return sign+digits.slice(0,point)+'.'+digits.slice(point);
}
function encode(value,compact=true){
  if(value instanceof NumberToken)return /[.eE]/.test(value.source)?floatText(Number(value.source)):BigInt(value.source).toString();
  if(value===null)return 'null';if(value===true)return 'true';if(value===false)return 'false';if(typeof value==='string')return quote(value);
  if(Array.isArray(value))return '['+value.map(item=>encode(item,compact)).join(compact?',':', ')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort(compareCodePoints)
    .map(key=>quote(key)+(compact?':':': ')+encode(value[key],compact)).join(compact?',':', ')+'}';
  throw Error('Unsupported Hydro manifest value');
}
function parse(source){
  if(typeof source!=='string')throw Error('Hydro manifest JSON text required');
  return JSON.parse(source,(key,item,context)=>typeof item==='number'?new NumberToken(context.source):item);
}
export function canonicalHydroManifest(source){return encode(parse(source));}
export function hydroBaselineFingerprint(source){return createHash('sha256').update(canonicalHydroManifest(source),'utf8').digest('hex');}
function manifestFromDocument(source){
  if(typeof source!=='string')throw Error('Hydro baseline JSON text required');let position=0,manifest=null;
  const whitespace=()=>{while(/[\x20\t\r\n]/.test(source[position]||'\0'))position++;};
  function stringEnd(){if(source[position++]!=='"')throw Error('Invalid Hydro baseline JSON');
    while(position<source.length){const character=source[position++];if(character==='"')return;if(character==='\\')position++;}
    throw Error('Invalid Hydro baseline JSON string');}
  function valueEnd(){const first=source[position];if(first==='"'){stringEnd();return;}
    if(first==='{'||first==='['){const stack=[];
      while(position<source.length){const character=source[position];if(character==='"'){stringEnd();continue;}position++;
        if(character==='{'||character==='[')stack.push(character);else if(character==='}'||character===']'){
          if(stack.pop()!==(character==='}'?'{':'['))throw Error('Invalid Hydro baseline JSON');if(!stack.length)return;}}
      throw Error('Invalid Hydro baseline JSON');}
    while(position<source.length&&!/[\s,}\]]/.test(source[position]))position++;
  }
  whitespace();if(source[position++]!=='{')throw Error('Hydro baseline object required');whitespace();
  while(source[position]!=='}'){
    const keyStart=position;stringEnd();const key=JSON.parse(source.slice(keyStart,position));whitespace();
    if(source[position++]!==':')throw Error('Invalid Hydro baseline JSON');whitespace();const start=position;valueEnd();
    if(position===start)throw Error('Invalid Hydro baseline JSON');if(key==='manifest')manifest=source.slice(start,position);whitespace();
    if(source[position]===','){position++;whitespace();continue;}if(source[position]!=='}')throw Error('Invalid Hydro baseline JSON');
  }
  position++;whitespace();if(position!==source.length)throw Error('Invalid Hydro baseline JSON');
  if(!manifest||!manifest.startsWith('{'))throw Error('Hydro baseline manifest required');return manifest;
}
export function hydroBaselineFingerprintFromDocument(source){return hydroBaselineFingerprint(manifestFromDocument(source));}
export function hydroBaselineAuditFingerprintFromDocument(source){const manifest=manifestFromDocument(source);
  return createHash('sha256').update(encode(parse(manifest),false),'utf8').digest('hex');}
