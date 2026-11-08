export const preparedMeshDeltaLayout='prepared-mesh-delta-v1';
const MAGIC=0x50444d31;

/** Exact byte reuse of a previously approved mesh, including every floating
 * point bit and triangle index. This format never performs triangulation. */
export function applyPreparedMeshDelta(base,delta,{decodedBytes}){
 const fail=()=>{throw Object.assign(Error('Invalid prepared mesh delta'),{code:'PL-MESH-ASSET'});};
 if(!(base instanceof ArrayBuffer)||!(delta instanceof ArrayBuffer)||delta.byteLength<20)fail();
 const view=new DataView(delta),word=offset=>view.getUint32(offset,true),length=word(12),count=word(16);
 if(word(0)!==MAGIC||word(4)!==1||word(8)!==base.byteLength||length!==decodedBytes||!Number.isSafeInteger(decodedBytes)
  ||decodedBytes<1||count>(delta.byteLength-20)/8)fail();
 const result=new Uint8Array(length),original=new Uint8Array(base),bytes=new Uint8Array(delta);let position=20,written=0;
 for(let i=0;i<count;i++){
  if(position+8>bytes.length)fail();const kind=word(position),first=word(position+4);position+=8;
  if(kind===0){
   if(position+4>bytes.length)fail();const size=word(position);position+=4;
   if(size<1||first+size>original.length||written+size>result.length)fail();
   result.set(original.subarray(first,first+size),written);written+=size;
  }else if(kind===1){
   if(first<1||position+first>bytes.length||written+first>result.length)fail();
   result.set(bytes.subarray(position,position+first),written);position+=first;written+=first;
  }else fail();
 }
 if(position!==bytes.length||written!==result.length)fail();return result.buffer;
}
