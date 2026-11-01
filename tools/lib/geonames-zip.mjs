/** Read pinned GeoNames ZIP snapshots without extracting large files into the worktree.
 * Supports single-volume ZIP32/ZIP64 store/deflate with CRC and size checks.
 */
import { createReadStream, promises as fs } from 'node:fs';
import { createInflateRaw, inflateRawSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

const SIG_EOCD = 0x06054b50, SIG_CENTRAL = 0x02014b50, SIG_LOCAL = 0x04034b50;
const TOO_LARGE = 0xffffffff;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let bit = 0; bit < 8; bit++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
  return c >>> 0;
});
const crcStep = (crc, data) => {
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)) >>> 0;
  return crc >>> 0;
};
const requireBuffer = (buffer, at, length, context) => {
  if (at < 0 || length < 0 || at + length > buffer.length)
    throw Error('Truncated ZIP ' + context);
};
const uint64 = (buffer, at, context) => {
  requireBuffer(buffer,at,8,context);const value=buffer.readBigUInt64LE(at);
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('ZIP64 value exceeds safe range: '+context);
  return Number(value);
};
const readExact = async (fd, size, at) => {
  const result = Buffer.alloc(size);
  let consumed = 0;
  while (consumed < size) {
    const { bytesRead } = await fd.read(result, consumed, size - consumed, at + consumed);
    if (!bytesRead) throw Error('Truncated ZIP at offset ' + (at + consumed));
    consumed += bytesRead;
  }
  return result;
};
async function readZipMembers(fd, size, {lazy=false,maxCentral=Infinity}={}) {
    const tailSize = Math.min(size, 65557);
    const tail = await readExact(fd, tailSize, size - tailSize);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD &&
          i + 22 + tail.readUInt16LE(i + 20) === tail.length) {
        eocd = i; break;
      }
    }
    if (eocd < 0) throw Error('ZIP end-of-central-directory missing');
    if (tail.readUInt16LE(eocd + 4) !== 0 || tail.readUInt16LE(eocd + 6) !== 0 ||
        tail.readUInt16LE(eocd + 8) !== tail.readUInt16LE(eocd + 10))
      throw Error('Split ZIP not supported');
    let count = tail.readUInt16LE(eocd + 10), centralBytes = tail.readUInt32LE(eocd + 12),
      centralStart = tail.readUInt32LE(eocd + 16), directoryEnd = size - tailSize + eocd;
    if (count === 65535 || centralBytes === TOO_LARGE || centralStart === TOO_LARGE) {
      const locatorAt=directoryEnd-20;if(locatorAt<0)throw Error('ZIP64 locator missing');
      const locator=await readExact(fd,20,locatorAt);
      if(locator.readUInt32LE(0)!==0x07064b50||locator.readUInt32LE(4)!==0||locator.readUInt32LE(16)!==1)
        throw Error('Invalid ZIP64 locator or split ZIP');
      const recordAt=uint64(locator,8,'directory offset');
      if(recordAt+56>locatorAt)throw Error('Invalid ZIP64 directory offset');
      const record=await readExact(fd,56,recordAt);
      if(record.readUInt32LE(0)!==0x06064b50)throw Error('Invalid ZIP64 directory signature');
      const recordSize=uint64(record,4,'directory record size');
      if(recordSize<44||recordAt+12+recordSize>locatorAt||record.readUInt32LE(16)!==0||record.readUInt32LE(20)!==0)
        throw Error('Invalid or split ZIP64 directory');
      const diskCount=uint64(record,24,'disk entry count');count=uint64(record,32,'entry count');
      if(diskCount!==count)throw Error('Split ZIP64 not supported');
      centralBytes=uint64(record,40,'directory size');centralStart=uint64(record,48,'directory start');directoryEnd=recordAt;
    }
    if (centralBytes > maxCentral) throw Error('ZIP central directory exceeds byte budget');
    if (centralStart + centralBytes > directoryEnd || count>Math.floor(centralBytes/46))
      throw Error('ZIP central directory is out of bounds');
    const central = await readExact(fd, centralBytes, centralStart);
    const members = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      requireBuffer(central, p, 46, 'central directory');
      if (central.readUInt32LE(p) !== SIG_CENTRAL) throw Error('Invalid ZIP central signature');
      const flag = central.readUInt16LE(p + 8), method = central.readUInt16LE(p + 10),
        time = central.readUInt16LE(p + 12), date = central.readUInt16LE(p + 14),
        crc32 = central.readUInt32LE(p + 16),
        n = central.readUInt16LE(p + 28), extra = central.readUInt16LE(p + 30),
        comment = central.readUInt16LE(p + 32);
      let compressed=central.readUInt32LE(p+20),uncompressed=central.readUInt32LE(p+24),
        disk=central.readUInt16LE(p+34),offset=central.readUInt32LE(p+42);
      requireBuffer(central, p + 46, n + extra + comment, 'central entry');
      const name = central.toString('utf8', p + 46, p + 46 + n);
      if(compressed===TOO_LARGE||uncompressed===TOO_LARGE||offset===TOO_LARGE||disk===65535){
        const extraEnd=p+46+n+extra;let at=p+46+n,zip64=null;
        while(at<extraEnd){requireBuffer(central,at,4,'ZIP64 extra header');const id=central.readUInt16LE(at),length=central.readUInt16LE(at+2);at+=4;
          if(at+length>extraEnd)throw Error('Truncated ZIP64 extra field');
          if(id===1){if(zip64)throw Error('Duplicate ZIP64 extra field');zip64=central.subarray(at,at+length);}at+=length;}
        if(!zip64)throw Error('ZIP64 extra field missing');let cursor=0;
        const next=()=>{const value=uint64(zip64,cursor,'entry extra');cursor+=8;return value;};
        if(uncompressed===TOO_LARGE)uncompressed=next();if(compressed===TOO_LARGE)compressed=next();if(offset===TOO_LARGE)offset=next();
        if(disk===65535){requireBuffer(zip64,cursor,4,'ZIP64 disk');disk=zip64.readUInt32LE(cursor);}
      }
      if ((flag & 1) || disk !== 0 || ![0, 8].includes(method))
        throw Error('Unsupported or encrypted ZIP entry: ' + name);
      if (!name || name.startsWith('/') || name.includes('\\') ||
          name.split('/').some(x => x === '..')) throw Error('Unsafe ZIP entry: ' + name);
      let dataAt;
      if (!lazy) {
        const local = await readExact(fd, 30, offset);
        if (local.readUInt32LE(0) !== SIG_LOCAL || local.readUInt16LE(8) !== method)
          throw Error('ZIP local header mismatch: ' + name);
        const lname = local.readUInt16LE(26), lextra = local.readUInt16LE(28);
        dataAt = offset + 30 + lname + lextra;
        if (dataAt + compressed > centralStart) throw Error('ZIP data outside content region: ' + name);
      } else if (offset + 30 > centralStart) throw Error('ZIP local header outside content region: ' + name);
      const timeISO = [
        1980 + ((date >>> 9) & 127),
        String((date >>> 5) & 15).padStart(2, '0'),
        String(date & 31).padStart(2, '0'),
      ].join('-') + 'T' + [
        String((time >>> 11) & 31).padStart(2, '0'),
        String((time >>> 5) & 63).padStart(2, '0'),
        String((time & 31) * 2).padStart(2, '0'),
      ].join(':');
      members.push({ name, method, compressed, uncompressed, crc32, ...(lazy?{localOffset:offset,centralStart}:{dataAt}), timeISO });
      p += 46 + n + extra + comment;
    }
    if (p !== centralBytes) throw Error('Unexpected ZIP central directory trailing bytes');
    return members;
}
export async function zipMembers(zipPath) {
  const fd = await fs.open(zipPath, 'r');
  try {const {size}=await fd.stat();return await readZipMembers(fd,size);}
  finally { await fd.close(); }
}
async function exactRange(readRange,start,length){
  if(!length)return Buffer.alloc(0);
  const bytes=await readRange(start,start+length-1);
  if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw Error('Truncated ZIP range at offset '+start);
  return Buffer.from(bytes);
}
export async function zipRangeMembers({size,readRange}){
  if(!Number.isSafeInteger(size)||size<22||typeof readRange!=='function')throw Error('Invalid bounded ZIP source');
  const fd={read:async(buffer,offset,length,position)=>{const bytes=await exactRange(readRange,position,length);bytes.copy(buffer,offset);return {bytesRead:length};}};
  return readZipMembers(fd,size,{lazy:true,maxCentral:8*1024*1024});
}
export async function readZipRangeMember({entry,readRange,maxCompressed=8*1024*1024,maxUncompressed=16*1024*1024}){
  if(!entry||typeof entry.name!=='string'||![0,8].includes(entry.method)||typeof readRange!=='function'||
    !Number.isSafeInteger(maxCompressed)||maxCompressed<0||maxCompressed>256*1024*1024||
    !Number.isSafeInteger(maxUncompressed)||maxUncompressed<0||maxUncompressed>256*1024*1024||
    ![entry.localOffset,entry.centralStart,entry.compressed,entry.uncompressed,entry.crc32].every(Number.isSafeInteger)||
    entry.localOffset<0||entry.centralStart<entry.localOffset+30||entry.compressed<0||entry.compressed>maxCompressed||
    entry.uncompressed<0||entry.uncompressed>maxUncompressed)throw Error('Invalid bounded ZIP member');
  const local=await exactRange(readRange,entry.localOffset,30);
  if(local.readUInt32LE(0)!==SIG_LOCAL||(local.readUInt16LE(6)&1)||local.readUInt16LE(8)!==entry.method)throw Error('ZIP local header mismatch: '+entry.name);
  const nameLength=local.readUInt16LE(26),extraLength=local.readUInt16LE(28),dataAt=entry.localOffset+30+nameLength+extraLength;
  if(dataAt+entry.compressed>entry.centralStart)throw Error('ZIP data outside content region: '+entry.name);
  const name=await exactRange(readRange,entry.localOffset+30,nameLength);
  if(name.toString('utf8')!==entry.name)throw Error('ZIP local member name mismatch: '+entry.name);
  const compressed=await exactRange(readRange,dataAt,entry.compressed);
  const bytes=entry.method===8?inflateRawSync(compressed,{maxOutputLength:Math.max(1,entry.uncompressed)}):compressed;
  if(bytes.length!==entry.uncompressed||((crcStep(0xffffffff,bytes)^0xffffffff)>>>0)!==entry.crc32)
    throw Error('ZIP CRC/size mismatch: '+entry.name);
  return bytes;
}
export async function* zipMemberChunks(zipPath, member) {
  let length = 0, crc = 0xffffffff;
  const source = member.compressed > 0
    ? createReadStream(zipPath, { start: member.dataAt, end: member.dataAt + member.compressed - 1 })
    : Readable.from([]);
  const stream = member.method === 8 ? source.pipe(createInflateRaw()) : source;
  for await (const part of stream) {
    length += part.length;
    if (length > member.uncompressed) throw Error('ZIP decompressed size overrun: ' + member.name);
    crc = crcStep(crc, part);
    yield part;
  }
  if (length !== member.uncompressed || ((crc ^ 0xffffffff) >>> 0) !== member.crc32)
    throw Error('ZIP CRC/size mismatch: ' + member.name);
}
export async function verifyZip(zipPath, expected) {
  const entries = await zipMembers(zipPath);
  if (entries.filter(e => e.name === expected).length !== 1)
    throw Error('Expected exactly one ZIP member: ' + expected);
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    for await (const chunk of zipMemberChunks(zipPath, entry)) { void chunk; /* verifies CRC */ }
  }
  return entries.find(e => e.name === expected);
}
export async function* zipTextLines(zipPath, memberName) {
  const entries = await zipMembers(zipPath);
  const matches = entries.filter(x => x.name === memberName);
  if (matches.length !== 1) throw Error('ZIP member missing or duplicated: ' + memberName);
  const lines = createInterface({ input: Readable.from(zipMemberChunks(zipPath, matches[0])),
    crlfDelay: Infinity });
  for await (const line of lines) yield line;
}
