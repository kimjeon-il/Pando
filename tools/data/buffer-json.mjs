/** JSON-data byte codec: the disk representation remains ordinary JSON.
 * No full-document string is constructed. Buffer and the decoded JS object still
 * need enough memory; this does not claim bounded-memory geometry ownership. */
export function* jsonByteChunks(value,{chunkBytes=1024*1024}={}){
 if(!Number.isSafeInteger(chunkBytes)||chunkBytes<16)throw Error('Invalid JSON chunk size');
 let text='',size=0;const pending=[],ancestors=new Set();
 function emit(s){text+=s;size+=s.length;if(size>=chunkBytes){pending.push(Buffer.from(text));text='';size=0;}}
 function* flush(){while(pending.length)yield pending.shift();}
 function* visit(v,inArray=false){
  if(v===null||typeof v!=='object'){
   if(typeof v==='bigint')throw TypeError('BigInt is not JSON data');
   const s=JSON.stringify(v);if(s===undefined){if(!inArray)throw TypeError('Undefined root JSON value');emit('null');}else emit(s);yield*flush();return;
  }
  if(ancestors.has(v))throw TypeError('Circular JSON data');
  if(typeof v.toJSON==='function')throw TypeError('Plain JSON data without toJSON required');
  if(Object.getPrototypeOf(v)!==Object.prototype&&!Array.isArray(v)&&Object.getPrototypeOf(v)!==null)throw TypeError('Plain JSON data required');
  ancestors.add(v);
  if(Array.isArray(v)){
   // Rings/paths are long arrays of tiny numeric tuples. Native stringify on
   // bounded tuple batches preserves JS number spellings without per-number IO.
   const tuples=v.length>0&&v.every(p=>Array.isArray(p)&&p.length<=4&&p.every(x=>typeof x==='number'));
   emit('[');yield*flush();
   if(tuples){for(let at=0;at<v.length;at+=2048){if(at)emit(',');emit(JSON.stringify(v.slice(at,at+2048)).slice(1,-1));yield*flush();}}
   else for(let i=0;i<v.length;i++){if(i)emit(',');yield*visit(v[i],true);}
   emit(']');
  }else{
   emit('{');let first=true;for(const k of Object.keys(v)){if(['undefined','function','symbol'].includes(typeof v[k]))continue;if(!first)emit(',');first=false;emit(JSON.stringify(k)+':');yield*flush();yield*visit(v[k]);}emit('}');
  }
  ancestors.delete(v);yield*flush();
 }
 yield*visit(value);if(text)yield Buffer.from(text);
}
export function stringifyJsonBuffer(value,options){return Buffer.concat([...jsonByteChunks(value,options)]);}

/** Parse a Buffer by delegating bounded complete values to native JSON.parse.
 * Large containers are split only at lexical JSON value boundaries. Quoted
 * strings are never split; a single string still has the JS engine string limit.
 */
export function parseJsonBuffer(bytes,{sliceBytes=8*1024*1024,maxDepth=512}={}){
 if(!Buffer.isBuffer(bytes)||!Number.isSafeInteger(sliceBytes)||sliceBytes<16||!Number.isSafeInteger(maxDepth)||maxDepth<1)throw Error('Invalid JSON buffer options');
 const ws=c=>c===32||c===9||c===10||c===13;
 const trim=(a,b)=>{while(a<b&&ws(bytes[a]))a++;while(b>a&&ws(bytes[b-1]))b--;return[a,b];};
 const native=(a,b)=>JSON.parse(bytes.toString('utf8',a,b));
 function endValue(a,b){
  const first=bytes[a];if(first===34){let escaped=false;for(let i=a+1;i<b;i++){const c=bytes[i];if(escaped){escaped=false;continue;}if(c===92){escaped=true;continue;}if(c===34)return i+1;}throw SyntaxError('Unterminated JSON string');}
  if(first===91||first===123){let level=0,string=false,escaped=false;for(let i=a;i<b;i++){const c=bytes[i];if(string){if(escaped)escaped=false;else if(c===92)escaped=true;else if(c===34)string=false;continue;}if(c===34){string=true;continue;}if(c===91||c===123)level++;else if(c===93||c===125){if(--level===0)return i+1;}}throw SyntaxError('Unterminated JSON container');}
  let i=a;while(i<b&&!ws(bytes[i])&&![44,93,125].includes(bytes[i]))i++;if(i===a)throw SyntaxError('Missing JSON value');return i;
 }
 function parse(a,b,depth){
  [a,b]=trim(a,b);if(depth>maxDepth)throw SyntaxError('JSON nesting limit');if(b-a<=sliceBytes)return native(a,b);
  const array=bytes[a]===91,object=bytes[a]===123;if(!array&&!object)return native(a,b);const close=array?93:125;if(bytes[b-1]!==close)throw SyntaxError('Invalid JSON container');const out=array?[]:{};let pos=a+1,first=true;
  while(true){while(pos<b-1&&ws(bytes[pos]))pos++;if(pos===b-1){if(!first)throw SyntaxError('Trailing JSON comma');return out;}let key;
   if(object){if(bytes[pos]!==34)throw SyntaxError('JSON object key required');const end=endValue(pos,b-1);key=native(pos,end);pos=end;while(pos<b-1&&ws(bytes[pos]))pos++;if(bytes[pos++]!==58)throw SyntaxError('JSON colon required');while(pos<b-1&&ws(bytes[pos]))pos++;}
   const end=endValue(pos,b-1),value=parse(pos,end,depth+1);if(array)out.push(value);else Object.defineProperty(out,key,{value,writable:true,configurable:true,enumerable:true});pos=end;first=false;while(pos<b-1&&ws(bytes[pos]))pos++;if(pos===b-1)return out;if(bytes[pos++]!==44)throw SyntaxError('JSON comma required');
  }
 }
 return parse(0,bytes.length,0);
}


/** Preserve the legacy CRLF-to-LF source hash rule without a giant JS string. */
export function normalizeJsonBufferNewlines(bytes) {
 if(!Buffer.isBuffer(bytes))throw TypeError('Expected source JSON bytes');
 const separator=Buffer.from('\r\n');
 let index=bytes.indexOf(separator);
 if(index<0)return bytes;
 const chunks=[];let offset=0,replacements=0;
 while(index>=0){
  chunks.push(bytes.subarray(offset,index),Buffer.from('\n'));
  replacements++;offset=index+2;index=bytes.indexOf(separator,offset);
 }
 chunks.push(bytes.subarray(offset));
 return Buffer.concat(chunks,bytes.length-replacements);
}
