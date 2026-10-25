/** Read pinned GeoNames ZIP snapshots without extracting large files into the worktree.
 * Supports ZIP32/store/deflate with central-directory CRC and size checks; fails closed on ZIP64.
 */
import { createReadStream, promises as fs } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
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
export async function zipMembers(zipPath) {
  const fd = await fs.open(zipPath, 'r');
  try {
    const { size } = await fd.stat();
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
    const count = tail.readUInt16LE(eocd + 10), centralBytes = tail.readUInt32LE(eocd + 12),
      centralStart = tail.readUInt32LE(eocd + 16);
    if (count === 65535 || centralBytes === TOO_LARGE || centralStart === TOO_LARGE)
      throw Error('ZIP64 requires an approved ZIP library');
    if (centralStart + centralBytes > size - tailSize + eocd)
      throw Error('ZIP central directory is out of bounds');
    const central = await readExact(fd, centralBytes, centralStart);
    const members = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      requireBuffer(central, p, 46, 'central directory');
      if (central.readUInt32LE(p) !== SIG_CENTRAL) throw Error('Invalid ZIP central signature');
      const flag = central.readUInt16LE(p + 8), method = central.readUInt16LE(p + 10),
        time = central.readUInt16LE(p + 12), date = central.readUInt16LE(p + 14),
        crc32 = central.readUInt32LE(p + 16), compressed = central.readUInt32LE(p + 20),
        uncompressed = central.readUInt32LE(p + 24),
        n = central.readUInt16LE(p + 28), extra = central.readUInt16LE(p + 30),
        comment = central.readUInt16LE(p + 32), disk = central.readUInt16LE(p + 34),
        offset = central.readUInt32LE(p + 42);
      requireBuffer(central, p + 46, n + extra + comment, 'central entry');
      const name = central.toString('utf8', p + 46, p + 46 + n);
      if ((flag & 1) || disk !== 0 || ![0, 8].includes(method) ||
          [compressed, uncompressed, offset].includes(TOO_LARGE))
        throw Error('Unsupported or encrypted ZIP entry: ' + name);
      if (!name || name.startsWith('/') || name.includes('\\') ||
          name.split('/').some(x => x === '..')) throw Error('Unsafe ZIP entry: ' + name);
      const local = await readExact(fd, 30, offset);
      if (local.readUInt32LE(0) !== SIG_LOCAL || local.readUInt16LE(8) !== method)
        throw Error('ZIP local header mismatch: ' + name);
      const lname = local.readUInt16LE(26), lextra = local.readUInt16LE(28);
      const dataAt = offset + 30 + lname + lextra;
      if (dataAt + compressed > centralStart) throw Error('ZIP data outside content region: ' + name);
      const timeISO = [
        1980 + ((date >>> 9) & 127),
        String((date >>> 5) & 15).padStart(2, '0'),
        String(date & 31).padStart(2, '0'),
      ].join('-') + 'T' + [
        String((time >>> 11) & 31).padStart(2, '0'),
        String((time >>> 5) & 63).padStart(2, '0'),
        String((time & 31) * 2).padStart(2, '0'),
      ].join(':');
      members.push({ name, method, compressed, uncompressed, crc32, dataAt, timeISO });
      p += 46 + n + extra + comment;
    }
    if (p !== centralBytes) throw Error('Unexpected ZIP central directory trailing bytes');
    return members;
  } finally { await fd.close(); }
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
