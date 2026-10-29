// Search-only names: never approves a city label, historical existence or ownership.
import {createHash} from 'node:crypto';
import {normalizeReferenceImagePlaceText as normalize,referenceImagePlaceNameSimilarity as similarity} from './place-text.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
const indexPath=key=>'names/'+hash(key).slice(0,3)+'.json';
const recordPath=id=>'records/'+hash(id).slice(0,2)+'.json';
const compact=value=>[...normalize(value).replace(/\s+/gu,'')];
const grams=value=>{const chars=compact(value),result=[];for(let i=0;i+2<chars.length;i++)result.push(chars.slice(i,i+3).join(''));return [...new Set(result)];};

export function buildGazetteerFiles(records,source) {
  if(!/^[a-f0-9]{64}$/.test(source?.sha256||'')||!source.license)throw Error('Verified gazetteer source hash/license required');
  const buckets=new Map(),names=new Map(),ids=new Set();let aliases=0;
  const bucket=(map,key)=>{if(!map.has(key))map.set(key,new Map());return map.get(key);};
  function posting(key,name,id){const values=bucket(names,key);if(!values.has(name))values.set(name,new Set());values.get(name).add(id);}
  for(const input of records) {
    if(typeof input.id!=='string'||!input.id||ids.has(input.id))throw Error('Missing or duplicate gazetteer identity');ids.add(input.id);
    if(!Array.isArray(input.coordinates)||input.coordinates.length!==2||input.coordinates.some((v,i)=>!Number.isFinite(v)||Math.abs(v)>(i?90:180)))throw Error('Invalid gazetteer coordinates');
    if(typeof input.name!=='string'||!input.name.trim()||!Array.isArray(input.aliases)||input.aliases.some(v=>typeof v!=='string'))throw Error('Explicit original names and aliases required');
    const row={...input,aliases:[...new Set(input.aliases.filter(v=>v.trim()))]};
    bucket(buckets,recordPath(row.id)).set(row.id,row);
    const unique=new Set([row.name,...row.aliases].map(normalize).filter(Boolean));aliases+=unique.size;
    for(const name of unique) {
      posting('e:'+name,name,row.id);
      const chars=compact(name);if(chars.length>=2)posting('p:'+chars.slice(0,2).join(''),name,row.id);
      const parts=grams(name);for(const part of new Set([parts[0],parts.at(-1)].filter(Boolean)))posting('g:'+part,name,row.id);
    }
  }
  for(const [key,values]of names)bucket(buckets,indexPath(key)).set(key,[...values].sort(([a],[b])=>a.localeCompare(b)).map(([name,values])=>[name,[...values].sort()]));
  const files=new Map([...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([path,values])=>[path,json(Object.fromEntries([...values].sort(([a],[b])=>a.localeCompare(b))))]));
  const specs=Object.fromEntries([...files].map(([path,bytes])=>[path,{path,bytes:bytes.length,sha256:hash(bytes)}]));
  const revision=hash(json({source,files:specs}));
  return {manifest:{schemaVersion:1,kind:'analysis-gazetteer',revision,sources:[source],recordCount:ids.size,aliasCount:aliases,files:specs},files};
}

export function createGazetteer({manifest,fetchBytes,cacheBytes=24*1024*1024}) {
  if(manifest?.schemaVersion!==1||manifest.kind!=='analysis-gazetteer'||!/^[a-f0-9]{64}$/.test(manifest.revision||'')||typeof fetchBytes!=='function')throw Error('Current analysis gazetteer manifest required');
  const cache=new Map(),pending=new Map();let used=0;
  for(const [path,spec]of Object.entries(manifest.files))if(!/^(names\/[a-f0-9]{3}|records\/[a-f0-9]{2})\.json$/.test(path)||spec.path!==path||!/^[a-f0-9]{64}$/.test(spec.sha256)||!Number.isSafeInteger(spec.bytes)||spec.bytes<2||spec.bytes>8*1024*1024)throw Error('Invalid gazetteer shard identity or size');
  async function read(path,signal) {
    signal?.throwIfAborted();if(!manifest.files[path])return {};
    if(cache.has(path)){const value=cache.get(path);cache.delete(path);cache.set(path,value);return value.value;}
    if(pending.has(path)){const value=await pending.get(path);signal?.throwIfAborted();return value;}
    const spec=manifest.files[path];
    const request=(async()=>{const bytes=Buffer.from(await fetchBytes(spec,{signal}));signal?.throwIfAborted();
      if(bytes.length!==spec.bytes||hash(bytes)!==spec.sha256)throw Error('Gazetteer shard size/hash mismatch: '+path);
      const value=JSON.parse(bytes.toString('utf8'));
      if(spec.bytes<=cacheBytes){while(used+spec.bytes>cacheBytes&&cache.size){const oldest=cache.keys().next().value;used-=cache.get(oldest).bytes;cache.delete(oldest);}cache.set(path,{value,bytes:spec.bytes});used+=spec.bytes;}
      return value;
    })();pending.set(path,request);try{return await request;}finally{pending.delete(path);}
  }
  return {revision:manifest.revision,async search(query,{signal,limit=50}={}) {
    signal?.throwIfAborted();const name=normalize(query);if([...name].length<2)return {records:[]};
    const exactKey='e:'+name,exact=(await read(indexPath(exactKey),signal))[exactKey]||[];
    let postings=exact;
    if(!postings.length){const chars=compact(name),keys=chars.length===2?['p:'+chars.join('')]:grams(name).map(v=>'g:'+v);
      for(const key of keys)postings=postings.concat((await read(indexPath(key),signal))[key]||[]);
    }
    const scores=new Map();
    for(const [alias,ids]of postings){const score=similarity(query,alias);if(score<.65)continue;for(const id of ids)scores.set(id,Math.max(scores.get(id)||0,score));}
    const rows=[];
    for(const [id,score]of scores){signal?.throwIfAborted();const row=(await read(recordPath(id),signal))[id];if(!row)throw Error('Gazetteer posting refers to a missing record');rows.push({...row,searchScore:score});}
    rows.sort((a,b)=>b.searchScore-a.searchScore||(b.population||0)-(a.population||0)||a.id.localeCompare(b.id));
    // Keep geographical alternatives rather than filling every slot with one country's homonyms.
    const kept=[],countries=new Map();
    for(const row of rows){const n=countries.get(row.countryCode)||0;if(n>=8)continue;countries.set(row.countryCode,n+1);kept.push(row);if(kept.length>=Math.min(200,Math.max(1,limit)))break;}
    return {records:kept,totalCandidates:rows.length,truncated:kept.length<rows.length};
  }};
}
